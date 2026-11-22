// 命令处理器表:浏览器 Worker 与 Node 测试适配器共用同一业务实现。
// openFn 注入具体的 SQLite 打开方式(opfs:// 或 Node 文件)。
import type { LocalDBCommands } from './protocol';
import {
  initialize, bindAccount, getSyncMeta, getOrders, getOrder, getSettings,
  getSharedSchedules, getContacts, mergeContacts, getGrants, getConflicts, getOutboxOps,
  createOrder, updateOrder, setOrderStatus, deleteOrder, recordPayment, reversePayment,
  assignPartner, grantSchedule, revokeSchedule, updateSettings,
  resolveConflictKeepServer, resolveConflictRetry,
  type DBApi,
} from './repo';
import {
  applyPullPage, markPushResults, installBootstrap, importLegacy, getMigrationMap,
} from './sync-apply';

type Row = Record<string, unknown>;

function nowISO(): string { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

export interface HandlerEnv {
  openDB(name: string): Promise<{ api: DBApi; close(): void }>;
  initEngine?(args: { sqliteUrl?: string }): Promise<void>;
}

export function dbNameFor(args: { env: string; accountId: string | null; demo?: boolean }): string {
  if (args.demo) return 'demo/ledger.sqlite3';
  if (!args.accountId) throw new Error('缺少账号 ID,不能打开工作账本');
  return `accounts/${args.env}/${args.accountId}/ledger.sqlite3`;
}

export function buildHandlers(env: HandlerEnv) {
  let db: DBApi | null = null;
  let closeFn: (() => void) | null = null;
  let quarantined = false;

  const handlers: {
    [K in keyof LocalDBCommands]: (args: LocalDBCommands[K], dbApi: DBApi | null) => unknown | Promise<unknown>;
  } = {
    async open(args) {
      const name = dbNameFor(args);
      quarantined = false;
      // 关闭旧连接再打开:双开会泄漏 OPFS 同步句柄并造成 SQLITE_BUSY。
      if (closeFn) { try { closeFn(); } catch { /* ignore */ } closeFn = null; db = null; }
      await env.initEngine?.(args);
      const opened = await env.openDB(name);
      closeFn = opened.close;
      db = opened.api;
      initialize(db);
      if (args.accountId) {
        db.transaction((tx) => bindAccount(tx, args.accountId!, args.sessionId ?? ''));
      }
      // 持久化能力自检(AC16):写探针立即读回;失败即整体拒绝,不静默退化。
      db.run(`CREATE TABLE IF NOT EXISTS _probe (k TEXT PRIMARY KEY, v TEXT)`);
      const stamp = String(Date.now());
      db.run(`INSERT OR REPLACE INTO _probe (k, v) VALUES ('persist', ?)`, [stamp]);
      const probe = db.get(`SELECT v FROM _probe WHERE k='persist'`) as { v: string };
      if (!probe?.v || probe.v !== stamp) {
        throw new Error('持久化自检失败(写入不可读):已阻止工作账本写入以保护数据');
      }
      return { name, meta: getSyncMeta(db) };
    },
    close() {
      closeFn?.();
      closeFn = null;
      db = null;
      return null;
    },
    meta() { return getSyncMeta(db!); },
    settings() { return getSettings(db!); },
    listOrders(args) { return getOrders(db!, args); },
    getOrder(args) { return getOrder(db!, args.id); },
    createOrder(args) {
      return db!.transaction((tx) => createOrder(tx, args.payload, args.sessionId, crypto.randomUUID()));
    },
    updateOrder(args) {
      return db!.transaction((tx) =>
        updateOrder(tx, args.id, args.changes, args.sessionId, crypto.randomUUID(), args.opType ?? 'order.update'));
    },
    cancelOrder(args) {
      return db!.transaction((tx) => setOrderStatus(tx, args.id, 'cancelled', args.sessionId, crypto.randomUUID(), 'order.cancel'));
    },
    archiveOrder(args) {
      return db!.transaction((tx) => setOrderStatus(tx, args.id, 'archived', args.sessionId, crypto.randomUUID(), 'order.archive'));
    },
    deleteOrder(args) {
      return db!.transaction((tx) => deleteOrder(tx, args.id, args.sessionId, crypto.randomUUID()));
    },
    recordPayment(args) {
      return db!.transaction((tx) =>
        recordPayment(tx, args.id, args.kind, args.method, args.paidAtLocal, args.sessionId, crypto.randomUUID()));
    },
    reversePayment(args) {
      return db!.transaction((tx) => reversePayment(tx, args.id, args.kind, args.sessionId, crypto.randomUUID()));
    },
    assignPartner(args) {
      return db!.transaction((tx) => assignPartner(tx, args.id, args.ref, args.sessionId, crypto.randomUUID()));
    },
    grantSchedule(args) {
      return db!.transaction((tx) =>
        grantSchedule(tx, args.orderId, args.recipientID, args.role, args.sessionId, crypto.randomUUID(), args.aggregateID));
    },
    revokeSchedule(args) {
      return db!.transaction((tx) => revokeSchedule(tx, args.shareId, args.sessionId, crypto.randomUUID(), args.aggregateID));
    },
    updateSettings(args) {
      return db!.transaction((tx) => updateSettings(tx, args.changes, args.sessionId, crypto.randomUUID(), args.accountID));
    },
    applyPullPage(args) {
      return db!.transaction((tx) => applyPullPage(tx, args.events, args.cursor, args.highWater, args.epoch));
    },
    markPushResults(args) {
      return db!.transaction((tx) => markPushResults(tx, args.results));
    },
    nextOutboxBatch(args) {
      return db!.transaction((tx) => {
        const limit = args?.limit ?? 50;
        const rows = tx.all(
          `SELECT * FROM outbox WHERE status='pending' ORDER BY created_at LIMIT ?`,
          [limit],
        ) as Row[];
        const ops = rows.map((r) => {
          const op: Record<string, unknown> = {
            op_id: r.op_id, aggregate_type: r.aggregate_type, aggregate_id: r.aggregate_id,
            type: r.type, payload: JSON.parse(r.payload as string),
          };
          if (r.precondition && r.precondition !== 'null') op.precondition = JSON.parse(r.precondition as string);
          if (r.requires_success) op.requires_success = JSON.parse(r.requires_success as string);
          return op;
        });
        if (rows.length) {
          tx.run(
            `UPDATE outbox SET status='sending', updated_at=? WHERE op_id IN (${rows.map(() => '?').join(',')})`,
            [nowISO(), ...rows.map((r) => r.op_id)],
          );
        }
        return ops;
      });
    },
    installBootstrap(args) {
      installBootstrap(db!, args.pages, args.tail);
      return getSyncMeta(db!);
    },
    listShared() { return getSharedSchedules(db!); },
    listContacts() { return getContacts(db!); },
    mergeContacts(args) {
      mergeContacts(db!, args.contacts);
      return getContacts(db!);
    },
    listGrants(args) { return getGrants(db!, args?.orderId); },
    listConflicts() { return getConflicts(db!); },
    resolveConflictKeepServer(args) {
      resolveConflictKeepServer(db!, args.conflictId);
      return getSyncMeta(db!);
    },
    resolveConflictRetry(args) {
      resolveConflictRetry(db!, args.conflictId);
      return getSyncMeta(db!);
    },
    listOutbox(args) {
      return getOutboxOps(db!, args?.statuses ?? ['pending', 'sending', 'conflict', 'rejected', 'quarantined']);
    },
    requeueSending() {
      db!.run(`UPDATE outbox SET status='pending', updated_at=? WHERE status='sending'`, [nowISO()]);
      return null;
    },
    importLegacy(args) {
      return db!.transaction((tx) => importLegacy(tx, args.sourceDataset, args.items as never[], args.sessionId));
    },
    migrationMap(args) { return getMigrationMap(db!, args.sourceDataset); },
    setQuarantined() {
      quarantined = true;
      db!.run(`UPDATE outbox SET status='quarantined', updated_at=? WHERE status IN ('pending','sending')`, [nowISO()]);
      return null;
    },
  };

  return {
    handlers,
    isQuarantined: () => quarantined,
    db: () => db,
    QUARANTINE_ALLOW: ['open', 'close', 'meta', 'setQuarantined', 'listConflicts', 'listOutbox'],
    WRITE_CMDS: WRITE_CMDS,
  };
}

// 注意:applyPullPage/markPushResults/installBootstrap/requeueSending 属同步自写,
// 由 worker 标记 event='selfsync'(不触发 onChange 唤醒),避免引擎自激风暴。
export const WRITE_CMDS = new Set([
  'createOrder', 'updateOrder', 'cancelOrder', 'archiveOrder', 'deleteOrder',
  'recordPayment', 'reversePayment', 'assignPartner', 'grantSchedule', 'revokeSchedule',
  'updateSettings', 'resolveConflictKeepServer', 'resolveConflictRetry', 'importLegacy', 'setQuarantined',
]);
