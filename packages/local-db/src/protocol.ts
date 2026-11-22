// Worker 协议:主线程 ↔ SQLite Worker 的命令与响应。
export interface WorkerRequest {
  id: number;
  cmd: string;
  args?: unknown;
}

export interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
  /** 数据库事件(打开/关闭/同步写完成),用于主线程刷新视图 */
  event?: 'changed' | 'opened' | 'closed' | 'selfsync';
}

export type LocalDBCommands = {
  open: { env: string; accountId: string | null; sessionId: string | null; demo?: boolean; sqliteUrl?: string };
  close: void;
  meta: void;
  settings: void;
  listOrders: { day?: string; month?: string; search?: string; includeArchived?: boolean };
  getOrder: { id: string };
  createOrder: { payload: Record<string, unknown>; sessionId: string | null };
  updateOrder: { id: string; changes: Record<string, unknown>; sessionId: string | null; opType?: 'order.update' | 'order.reschedule' };
  cancelOrder: { id: string; sessionId: string | null };
  archiveOrder: { id: string; sessionId: string | null };
  deleteOrder: { id: string; sessionId: string | null };
  recordPayment: { id: string; kind: 'deposit' | 'final'; method: string; paidAtLocal: string; sessionId: string | null };
  reversePayment: { id: string; kind: 'deposit' | 'final'; sessionId: string | null };
  assignPartner: { id: string; ref: { type: 'account' | 'external'; user_id?: string; external_name?: string }; sessionId: string | null };
  grantSchedule: { orderId: string; recipientID: string; role: 'partner' | 'viewer'; sessionId: string | null; aggregateID: string };
  revokeSchedule: { shareId: string; sessionId: string | null; aggregateID: string };
  updateSettings: { changes: { collect_threshold_days?: number; timezone?: string }; sessionId: string | null; accountID?: string };
  applyPullPage: { events: import('@tanji/domain').PullEvent[]; cursor: string; highWater: string; epoch: number };
  markPushResults: { results: import('@tanji/domain').OpResult[] };
  nextOutboxBatch: { limit?: number };
  installBootstrap: {
    pages: { orders: import('@tanji/domain').OrderDTO[] }[];
    tail: {
      settings?: { collect_threshold_days?: number; timezone?: string };
      shares?: import('@tanji/domain').ScheduleProjection[];
      epoch: number;
      high_water: string;
      receipts?: { op_id: string; result: string; resulting_version?: string }[];
    };
  };
  listShared: void;
  listContacts: void;
  mergeContacts: { contacts: { contact_id: string; user_id: string; nickname: string; auth_relation_generation: string }[] };
  listGrants: { orderId?: string };
  listConflicts: void;
  resolveConflictKeepServer: { conflictId: string };
  resolveConflictRetry: { conflictId: string };
  listOutbox: { statuses?: string[] };
  requeueSending: void;
  importLegacy: { sourceDataset: string; items: unknown[]; sessionId: string | null };
  migrationMap: { sourceDataset: string };
  setQuarantined: void;
};
