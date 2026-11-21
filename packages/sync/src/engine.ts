// 同步引擎:单实例串行循环 + 触发合并 + 指数退避 + 会话失效隔离(AC06/AC07 客户端侧)。
// 状态机: idle → syncing → idle | offline | conflict | session_invalid | error
import type { ApiClient, ApiError } from '@tanji/api-client';
import type { OpEnvelope, OpResult } from '@tanji/domain';
import { PROTOCOL_VERSION } from '@tanji/domain';

export interface LocalDBAdapter {
  meta(): Promise<Record<string, unknown>>;
  nextOutboxBatch(limit: number): Promise<OpEnvelope[]>;
  markPushResults(results: OpResult[]): Promise<unknown>;
  applyPullPage(args: { events: import('@tanji/domain').PullEvent[]; cursor: string; highWater: string; epoch: number }): Promise<unknown>;
  installBootstrap(args: {
    pages: { orders: import('@tanji/domain').OrderDTO[] }[];
    tail: {
      settings?: { collect_threshold_days?: number; timezone?: string };
      shares?: import('@tanji/domain').ScheduleProjection[];
      epoch: number;
      high_water: string;
      receipts?: { op_id: string; result: string; resulting_version?: string }[];
    };
  }): Promise<unknown>;
  setQuarantined(): Promise<unknown>;
  requeueSending(): Promise<unknown>;
}

export type SyncStatus =
  | 'idle' | 'syncing' | 'offline' | 'error' | 'conflict' | 'session_invalid';

export interface SyncState {
  status: SyncStatus;
  lastError?: string;
  lastSyncAt?: string;
  pendingOps: number;
  openConflicts: number;
  backoffMs: number;
}

const MAX_BACKOFF_MS = 60_000;
const PULL_LIMIT = 200;

export class SyncEngine {
  private running = false;
  private wakeRequested = false;
  private backoffMs = 0;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private state: SyncState = { status: 'idle', pendingOps: 0, openConflicts: 0, backoffMs: 0 };
  private listeners: ((s: SyncState) => void)[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private api: ApiClient,
    private db: LocalDBAdapter,
    private opts: { accountID: string; deviceID: string; pollMs?: number; onSessionInvalid?: () => void } ,
  ) {}

  onState(cb: (s: SyncState) => void): () => void {
    this.listeners.push(cb);
    cb(this.state);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private setState(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  /** 本地事务成功后立即唤醒;短批合并,不打断进行中的一轮。 */
  wake(): void {
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
      this.backoffMs = 0;
    }
    if (this.running) {
      this.wakeRequested = true;
      return;
    }
    void this.runCycle();
  }

  /** 前台轮询兜底(SSE 只是唤醒信号,拉取游标才是事实来源)。 */
  startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.wake(), this.opts.pollMs ?? 30_000);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private scheduleBackoff(error: string): void {
    const jitter = Math.floor(Math.random() * 1000);
    this.backoffMs = Math.min(this.backoffMs ? this.backoffMs * 2 : 2000, MAX_BACKOFF_MS);
    this.setState({ status: 'error', lastError: error, backoffMs: this.backoffMs });
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      void this.runCycle();
    }, this.backoffMs + jitter);
  }

  private async refreshCounters(): Promise<void> {
    const meta = await this.db.meta();
    this.setState({
      pendingOps: Number(meta.pending_ops ?? 0),
      openConflicts: Number(meta.open_conflicts ?? 0),
    });
  }

  /** 一轮完整同步:核验会话 → 不确定回执 → 拉取 → 上传 → 再拉取。 */
  async runCycle(): Promise<void> {
    if (this.running) {
      this.wakeRequested = true;
      return;
    }
    this.running = true;
    try {
      this.setState({ status: 'syncing' });
      await this.refreshCounters();

      // 1. 拉取至本轮 high_water(先对账已有结果,再处理可上传队列)。
      let pushed = false;
      for (let round = 0; round < 50; round++) {
        await this.pullOnce();
        // 2. 上传一批 pending 操作。
        const batch = (await this.db.nextOutboxBatch(50)) as OpEnvelope[];
        if (batch.length === 0) {
          if (!pushed) break; // 无待传也无新下行 → 结束
          continue; // 上传过一轮,再拉一次确认没有新事件
        }
        const resp = await this.api.push({
          protocol_version: PROTOCOL_VERSION,
          account_id: this.opts.accountID,
          device_id: this.opts.deviceID,
          operations: batch,
        });
        await this.db.markPushResults(resp.results);
        await this.refreshCounters();
        pushed = true;
      }

      this.backoffMs = 0;
      this.setState({ status: 'idle', lastSyncAt: new Date().toISOString(), lastError: undefined, backoffMs: 0 });
    } catch (e) {
      const err = e as ApiError;
      if (err?.status === 401) {
        // 会话失效:停止上传,队列隔离(不删除),锁界面。
        await this.db.setQuarantined().catch(() => {});
        this.stopPolling();
        this.setState({ status: 'session_invalid', lastError: err.message });
        this.opts.onSessionInvalid?.();
        return;
      }
      if (err?.status === 410) {
        // cursor_expired → 全量重建。
        try {
          await this.bootstrap();
          this.backoffMs = 0;
          this.setState({ status: 'idle', lastSyncAt: new Date().toISOString(), lastError: undefined, backoffMs: 0 });
        } catch (e2) {
          this.scheduleBackoff(e2 instanceof Error ? e2.message : String(e2));
        }
        return;
      }
      if (err?.status === 429) {
        this.backoffMs = Math.max(this.backoffMs, 5000);
        this.setState({ status: 'error', lastError: '服务繁忙', backoffMs: this.backoffMs });
        this.backoffTimer = setTimeout(() => {
          this.backoffTimer = null;
          void this.runCycle();
        }, this.backoffMs);
        return;
      }
      if (isNetworkError(e)) {
        await this.db.requeueSending().catch(() => {});
        this.setState({ status: 'offline', lastError: '网络不可用,改动已保存在本机' });
        this.backoffMs = Math.min(this.backoffMs ? this.backoffMs * 2 : 2000, MAX_BACKOFF_MS);
        this.backoffTimer = setTimeout(() => {
          this.backoffTimer = null;
          void this.runCycle();
        }, this.backoffMs + Math.floor(Math.random() * 1000));
        return;
      }
      this.scheduleBackoff(err?.message ?? String(e));
    } finally {
      this.running = false;
      if (this.wakeRequested) {
        this.wakeRequested = false;
        // 本轮进行中又有新本地修改:立即再来一轮。
        queueMicrotask(() => this.wake());
      }
    }
  }

  private async pullOnce(): Promise<void> {
    const meta = await this.db.meta();
    const cursor = (meta.cursor as string) || undefined;
    const page = await this.api.pull(cursor, PULL_LIMIT);
    if (page.events.length > 0 || page.next_cursor) {
      await this.db.applyPullPage({
        events: page.events,
        cursor: page.next_cursor,
        highWater: page.high_water,
        epoch: page.stream_epoch,
      });
    }
    if (page.has_more) await this.pullOnce();
  }

  /** cursor_expired 或会话恢复后的全量重建:暂停上传 → 快照 → 校验安装 → 增量核对。 */
  async bootstrap(): Promise<void> {
    this.setState({ status: 'syncing' });
    const meta = await this.db.meta();
    const outstanding = (await this.db.nextOutboxBatch(200)) as OpEnvelope[];
    // nextOutboxBatch 会把状态改为 sending;bootstrap 回执确认它们,未确认的重放。
    let snap: Awaited<ReturnType<ApiClient['bootstrap']>>;
    try {
      snap = await this.api.bootstrap(outstanding.map((o) => o.op_id));
    } catch (e) {
      await this.db.requeueSending().catch(() => {});
      throw e;
    }
    const pages: { orders: import('@tanji/domain').OrderDTO[] }[] = [];
    let tail: Parameters<LocalDBAdapter['installBootstrap']>[0]['tail'] | null = null;
    for (let i = 0; i < snap.pages; i++) {
      const pageResp = await this.api.bootstrapPage(snap.snapshot_id, i);
      const payload = pageResp.payload as {
        orders?: import('@tanji/domain').OrderDTO[];
        tail?: { settings?: { collect_threshold_days?: number; timezone?: string }; shares?: import('@tanji/domain').ScheduleProjection[]; epoch: number; high_water: string; receipts?: { op_id: string; result: string; resulting_version?: string }[] };
      };
      if (payload.orders) pages.push({ orders: payload.orders });
      if (payload.tail) tail = payload.tail;
    }
    if (!tail) throw new Error('bootstrap 快照缺少尾页(settings/shares/epoch)');
    await this.db.installBootstrap({
      pages,
      tail: {
        settings: tail.settings,
        shares: tail.shares ?? [],
        epoch: snap.stream_epoch,
        high_water: snap.high_water,
        receipts: tail.receipts ?? [],
      },
    });
    void meta;
    await this.refreshCounters();
  }

  dispose(): void {
    this.stopPolling();
    if (this.backoffTimer) clearTimeout(this.backoffTimer);
    this.listeners = [];
  }
}

function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError // fetch 网络失败
    || (e instanceof ApiError ? false : String((e as Error)?.message ?? '').includes('fetch'));
}
