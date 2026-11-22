// 会话与账本生命周期:登录 → 打开账号 SQLite(Worker) → 同步引擎;切号/踢出 → 锁定与隔离(AC07)。
import { reactive } from 'vue';
import { ApiClient, ApiError } from '@tanji/api-client';
import { SyncEngine, type SyncState } from '@tanji/sync';
import { connectWorker, type LocalDBClient } from '@tanji/local-db';
import LedgerWorkerURL from '../../workers/ledger.worker.ts?worker&url';
import { uuidV4 } from '@tanji/domain';

export type Phase = 'boot' | 'logged-out' | 'opening' | 'ready' | 'locked';

export interface AppState {
  phase: Phase;
  apiBase: string;
  user: { userID: string; nickname: string; email: string; sessionID: string; csrf?: string } | null;
  sync: SyncState | null;
  lockReason: string;
  runtimeGeneration: number;
  toast: string;
}

export const app = reactive<AppState>({
  phase: 'boot',
  apiBase: '/',
  user: null,
  sync: null,
  lockReason: '',
  runtimeGeneration: 0,
  toast: '',
});

let api: ApiClient;
let ledger: LocalDBClient | null = null;
let engine: SyncEngine | null = null;
let deviceID = localStorage.getItem('tanji_device_id') ?? '';

export function ensureDeviceID(): string {
  if (!deviceID) {
    deviceID = localStorage.getItem('tanji_device_id') ?? uuidV4();
    localStorage.setItem('tanji_device_id', deviceID);
  }
  return deviceID;
}

export function getApi(): ApiClient {
  if (!api) {
    api = new ApiClient({
      baseUrl: app.apiBase,
      csrfToken: () => {
        const m = document.cookie.match(/(?:^|;\s*)tanji_csrf=([^;]+)/);
        return m?.[1];
      },
    });
  }
  return api;
}

export function getLedger(): LocalDBClient {
  if (!ledger) {
    // ?worker&url:Vite 打包 worker 并返回产物 URL;sqliteUrl 随 open 命令传入
    // sqlite3.dir 参数让 opfs VFS 找到同目录的 async-proxy(worker 打包后相对路径会漂移)
    const workerURL = LedgerWorkerURL + (LedgerWorkerURL.includes('?') ? '&' : '?') + 'sqlite3.dir=' + encodeURIComponent('/vendor/');
    ledger = connectWorker(new Worker(workerURL, { type: 'module' }), '/vendor/sqlite3.mjs');
    ledger.onChange(() => {
      void refreshOrders();
      // 本地事务成功 → 立即尝试上传(唤醒单实例同步引擎)
      currentEngine?.wake();
    });
  }
  return ledger;
}

let currentEngine: SyncEngine | null = null;
export function getEngine(): SyncEngine | null { return currentEngine; }

// 离线启动:本机保存"最近已验证会话"的标识(不是授权凭据;联网后必须先核验)。
// PRD FR-03:已初始化且曾成功登录的工作区,离线可查看与编辑。
const LAST_SESSION_KEY = 'tanji_last_session';
interface LastSession { userID: string; nickname: string; email: string; sessionID: string }
function saveLastSession(s: LastSession): void {
  try { localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(s)); } catch { /* 隐私模式下省略 */ }
}
export function loadLastSession(): LastSession | null {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as LastSession;
    return s.userID && s.sessionID ? s : null;
  } catch { return null; }
}
function clearLastSession(): void {
  try { localStorage.removeItem(LAST_SESSION_KEY); } catch { /* ignore */ }
}

export function toast(msg: string): void {
  app.toast = msg;
  window.setTimeout(() => { if (app.toast === msg) app.toast = ''; }, 2200);
}

// ---- 订单视图缓存(由 Worker 'changed' 事件驱动刷新) ----

export const work = reactive<{ orders: Record<string, unknown>[]; settings: Record<string, unknown>; meta: Record<string, unknown> }>({
  orders: [],
  settings: { collect_threshold_days: 15, timezone: 'Asia/Shanghai' },
  meta: {},
});

let refreshSeq = 0;
export async function refreshOrders(filter: { month?: string; day?: string; search?: string } = {}): Promise<void> {
  if (!ledger || app.phase !== 'ready') return;
  const seq = ++refreshSeq;
  const orders = (await ledger.call('listOrders', filter)) as Record<string, unknown>[];
  if (seq !== refreshSeq) return; // 丢弃过期刷新
  work.orders = orders;
  work.settings = (await ledger.call('settings')) as Record<string, unknown>;
  work.meta = (await ledger.call('meta')) as Record<string, unknown>;
}

/** 打开账本并启动同步(登录/恢复后调用)。 */
export async function openWorkspace(session: { user_id: string; nickname: string; email: string; session_id: string }): Promise<void> {
  // 幂等保护:同账号已就绪则跳过(boot 与手动恢复可能并发调用)
  if (app.phase === 'ready' && app.user?.userID === session.user_id) {
    currentEngine?.wake();
    return;
  }
  app.phase = 'opening';
  const generation = ++app.runtimeGeneration;
  const l = getLedger();
  await l.call('open', {
    env: 'prod', accountId: session.user_id, sessionId: session.session_id,
    sqliteUrl: '/vendor/sqlite3.mjs',
  });
  app.user = {
    userID: session.user_id, nickname: session.nickname, email: session.email, session_id: session.session_id,
  };
  saveLastSession({ userID: session.user_id, nickname: session.nickname, email: session.email, sessionID: session.session_id });
  engine = new SyncEngine(getApi(), {
    meta: () => l.call('meta') as Promise<Record<string, unknown>>,
    nextOutboxBatch: (limit: number) => l.call('nextOutboxBatch', { limit }),
    markPushResults: (results) => l.call('markPushResults', { results }),
    applyPullPage: (args) => l.call('applyPullPage', args),
    installBootstrap: (args) => l.call('installBootstrap', args),
    setQuarantined: () => l.call('setQuarantined'),
    requeueSending: () => l.call('requeueSending'),
  }, {
    accountID: session.user_id,
    deviceID: ensureDeviceID(),
    pollMs: 30_000,
    onSessionInvalid: () => lockWorkspace('登录已失效:本机改动已保留在待恢复队列,重新登录后可继续同步'),
  });
  currentEngine = engine;
  engine.onState((s) => { app.sync = s; });
  // PRD FR-04:重新联网 → 先核验会话再自动双向同步
  window.addEventListener('online', () => engine?.wake());
  engine.startPolling();
  app.phase = 'ready';
  if (generation !== app.runtimeGeneration) return; // 已切号
  await refreshOrders();
  engine.wake();
}

/** 会话失效/踢出:锁屏,停止同步,保留待恢复数据。 */
export function lockWorkspace(reason: string): void {
  engine?.dispose();
  engine = null;
  app.sync = null;
  clearLastSession();
  app.phase = 'locked';
  app.lockReason = reason;
}

/** 切换账号:停同步 → 关库 → 清视图 → 新账号新库(AC07)。 */
export async function switchAccount(): Promise<void> {
  engine?.dispose();
  engine = null;
  app.sync = null;
  app.runtimeGeneration++;
  try {
    if (ledger) await ledger.call('close');
  } catch { /* 关闭失败不阻塞切号 */ }
  ledger = null;
  work.orders = [];
  app.user = null;
  clearLastSession();
  app.phase = 'logged-out';
}

export async function logout(): Promise<void> {
  const l = ledger;
  const meta = await l?.call('meta') as Record<string, unknown> | undefined;
  const pending = Number(meta?.pending_ops ?? 0);
  if (pending > 0) {
    const ok = window.confirm(`有 ${pending} 项改动尚未同步到云端。退出后将保留在本机待恢复队列(不会上传),确认退出?`);
    if (!ok) return;
  }
  try { await getApi().logout(); } catch { /* 离线退出:云端会话待联网过期 */ }
  await switchAccount();
}

/** 恢复:同一账号重新登录后,按 op_id 对账回执并继续同步。 */
export async function resumeAfterRelogin(): Promise<void> {
  if (engine) engine.wake();
}

/** 离线启动入口:核验失败(网络)→ 用本机最近会话打开工作区;401 → 拒绝。
 *  独立导出便于测试与 PWA 离线启动复用(与 App.boot 同逻辑)。 */
export async function tryOfflineBoot(): Promise<'online' | 'offline-boot' | 'logged-out' | 'ready' | 'locked'> {
  ensureDeviceID();
  // 同账号工作区已就绪:无需重开(PWA 重载与测试复用同一逻辑)
  if (app.phase === 'ready' && app.user) return 'ready';
  try {
    const s = await getApi().getSession();
    await openWorkspace({ user_id: s.user_id, nickname: s.nickname, email: s.email, session_id: s.session_id });
    return 'online';
  } catch (e) {
    const err = e as { status?: number };
    if (err?.status === 401) return 'logged-out';
    const last = loadLastSession();
    if (last) {
      await openWorkspace(last);
      return 'offline-boot';
    }
    return 'logged-out';
  }
}

export type { SyncState };
export { ApiError };
