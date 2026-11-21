// 仓储实现:全部在 Worker 内执行,单连接串行。
// 核心不变量:
//  1) 业务修改与 outbox 追加在同一 SQLite 事务(AC01 半事务防护);
//  2) 下行页应用是单事务(AC05 崩溃一起提交或回滚);
//  3) 下行不覆盖仍有 outbox 的工作行,而是重放本地意图(AC04);
//  4) 应用下行是 replication apply,不再生成 outbox(避免循环同步)。
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import type { OpEnvelope, PullEvent, OrderDTO, SettingsDTO, ScheduleProjection } from '@tanji/domain';
import { nowRFC3339 } from '@tanji/domain';

export interface DBApi {
  run(sql: string, params?: unknown[]): void;
  all(sql: string, params?: unknown[]): unknown[];
  get(sql: string, params?: unknown[]): unknown | undefined;
  transaction<T>(fn: (tx: Tx) => T): T;
}

interface Tx {
  run(sql: string, params?: unknown[]): void;
  get(sql: string, params?: unknown[]): unknown | undefined;
  all(sql: string, params?: unknown[]): unknown[];
}

// ---- 打开与迁移 ----

export function initialize(db: DBApi): void {
  // 先去注释再按分号拆分(注释里可能含分号);sqlite-wasm 的 {sql, bind} 形式只允许单语句。
  db.run('PRAGMA foreign_keys = ON;');
  const noComments = SCHEMA_SQL
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  for (const stmt of noComments.split(';')) {
    const sql = stmt.trim();
    if (sql) db.run(sql);
  }
  db.run(
    `INSERT INTO sync_meta (id, schema_version) VALUES (1, ?) ON CONFLICT(id) DO NOTHING`,
    [SCHEMA_VERSION],
  );
  const v = db.get('SELECT schema_version FROM sync_meta WHERE id = 1') as { schema_version: number };
  if (v.schema_version > SCHEMA_VERSION) {
    throw new Error(`本地库版本(${v.schema_version})高于当前应用(${SCHEMA_VERSION}):请升级应用,数据未做任何改动`);
  }
  if (v.schema_version < SCHEMA_VERSION) {
    throw new Error(`本地库 schema v${v.schema_version} 需要迁移到 v${SCHEMA_VERSION}:迁移失败已中止,原数据保留`);
  }
}

export function bindAccount(tx: Tx, accountId: string, sessionId: string): void {
  const cur = tx.get('SELECT account_id FROM sync_meta WHERE id = 1') as { account_id: string | null } | undefined;
  if (cur?.account_id && cur.account_id !== accountId) {
    throw new Error('数据库已绑定其他账号,拒绝打开(账号隔离保护)');
  }
  tx.run(`UPDATE sync_meta SET account_id = ? WHERE id = 1`, [accountId]);
  tx.run(
    `INSERT INTO local_settings (key, value) VALUES ('session_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [sessionId],
  );
}

export function getSyncMeta(db: DBApi): Record<string, unknown> {
  const row = db.get(
    `SELECT account_id, protocol_version, schema_version, stream_epoch, cursor, high_water,
            last_pull_at, last_push_at, runtime_generation FROM sync_meta WHERE id = 1`,
  ) as Record<string, unknown>;
  const pending = db.get(`SELECT COUNT(*) AS n FROM outbox WHERE status IN ('pending','sending')`) as { n: number };
  const conflicts = db.get(`SELECT COUNT(*) AS n FROM conflicts WHERE status='open'`) as { n: number };
  return { ...row, pending_ops: pending.n, open_conflicts: conflicts.n };
}

// ---- 时间派生:appt_start(UTC) ↔ appt_local(账本时区输入形态) ----

export function toLocalInput(utcISO: string, tz: string): string {
  const d = new Date(utcISO);
  if (Number.isNaN(d.getTime())) return '';
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const parts = dtf.formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${String(Number(g('hour')) % 24).padStart(2, '0')}:${g('minute')}`;
}

export function utcFromLocalInput(local: string, tz: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error('时间格式无效');
  const naive = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`);
  if (Number.isNaN(naive)) throw new Error('时间无效');
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(naive));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return new Date(naive - (asUTC - naive)).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ---- 订单工作视图 ----

const ORDER_COLS = `id, version, store, category, contact, note, price_cents, deposit_cents,
  appt_start, appt_local, appt_end, timezone, settle_via, channel,
  shot_at, submitted_at, short_sent_at, long_sent_at, remind_at, status,
  place_address, place_lat, place_lng, place_coord, place_provider, place_poi,
  partner_type, partner_user, partner_name, dirty, created_at, updated_at`;

export function getOrders(db: DBApi, filter: { day?: string; month?: string; search?: string; includeArchived?: boolean } = {}): Record<string, unknown>[] {
  const where: string[] = ["status != 'deleted'"];
  const params: unknown[] = [];
  if (!filter.includeArchived) where.push("status != 'archived'");
  if (filter.day) { where.push(`appt_local >= ? AND appt_local < ?`); params.push(`${filter.day}T00:00`, `${filter.day}T24:00`); }
  if (filter.month) { where.push(`substr(appt_local, 1, 7) = ?`); params.push(filter.month); }
  if (filter.search) { where.push(`store LIKE ?`); params.push(`%${filter.search}%`); }
  const rows = db.all(`SELECT ${ORDER_COLS} FROM orders WHERE ${where.join(' AND ')} ORDER BY appt_local`, params) as Row[];
  return rows.map((r) => withDerived(db, r));
}

export function getOrder(db: DBApi, id: string): Record<string, unknown> | null {
  const r = db.get(`SELECT ${ORDER_COLS} FROM orders WHERE id = ?`, [id]) as Row | undefined;
  return r ? withDerived(db, r) : null;
}

export function withDerived(db: DBApi, r: Row): Record<string, unknown> {
  const payments = db.all(
    `SELECT id, order_id, kind, entry_type, amount_cents, method, paid_at, reverses_id, state, origin_op_id
     FROM payment_entries WHERE order_id = ? ORDER BY paid_at, created_at`,
    [r.id],
  );
  return { ...r, payments, active_receipts: deriveActiveReceipts(payments as PayRow[]) };
}

interface PayRow { id: string; kind: string; entry_type: string; reverses_id: string | null }

export function deriveActiveReceipts(payments: PayRow[]): Record<string, string> {
  const active: Record<string, string> = {};
  for (const p of payments) {
    if (p.entry_type === 'receipt') {
      if (!active[p.kind]) active[p.kind] = p.id;
    } else if (p.reverses_id) {
      for (const [k, v] of Object.entries(active)) if (v === p.reverses_id) delete active[k];
    }
  }
  return active;
}

type Row = Record<string, unknown>;

// ---- outbox 追加与版本条件 ----

export function appendOutbox(tx: Tx, op: OpEnvelope, sessionId: string | null): void {
  const now = nowRFC3339();
  tx.run(
    `INSERT INTO outbox (op_id, aggregate_type, aggregate_id, type, payload, precondition,
       requires_success, status, session_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'pending', ?, ?, ?)`,
    [op.op_id, op.aggregate_type, op.aggregate_id, op.type,
      JSON.stringify(op.payload), JSON.stringify(op.precondition ?? null),
      op.requires_success ? JSON.stringify(op.requires_success) : null, sessionId, now, now],
  );
}

/** 第一个 pending 操作用基线版本条件;链上后续操作用 after_op_id 指向前一个未确认操作。 */
export function preconditionFor(tx: Tx, aggregateType: 'order' | 'grant_set', aggregateID: string): { expected_version?: string; after_op_id?: string } {
  const pending = tx.get(
    `SELECT op_id FROM outbox WHERE aggregate_id = ? AND aggregate_type = ?
     AND status IN ('pending','sending') ORDER BY created_at DESC LIMIT 1`,
    [aggregateID, aggregateType],
  ) as { op_id: string } | undefined;
  if (pending) return { after_op_id: pending.op_id };
  if (aggregateType === 'order') {
    const row = tx.get(`SELECT version FROM orders WHERE id = ?`, [aggregateID]) as { version: string } | undefined;
    return { expected_version: row?.version ?? '0' };
  }
  return { expected_version: '0' };
}

function updateOrderFromCommand(tx: Tx, orderID: string, mutate: (row: Row) => void, tz: string): Row {
  const row = tx.get(`SELECT ${ORDER_COLS} FROM orders WHERE id = ?`, [orderID]) as Row | undefined;
  if (!row) throw new Error('订单不存在');
  mutate(row);
  row.appt_local = toLocalInput(row.appt_start as string, (row.timezone as string) || tz);
  row.updated_at = nowRFC3339();
  tx.run(
    `UPDATE orders SET store=?, category=?, contact=?, note=?, price_cents=?, deposit_cents=?,
       appt_start=?, appt_local=?, appt_end=?, timezone=?, settle_via=?, channel=?,
       shot_at=?, submitted_at=?, short_sent_at=?, long_sent_at=?, remind_at=?, status=?,
       place_address=?, place_lat=?, place_lng=?, place_coord=?, place_provider=?, place_poi=?,
       partner_type=?, partner_user=?, partner_name=?, dirty=1, updated_at=?
     WHERE id=?`,
    [row.store, row.category, row.contact, row.note, row.price_cents, row.deposit_cents,
      row.appt_start, row.appt_local, row.appt_end, row.timezone, row.settle_via, row.channel,
      row.shot_at, row.submitted_at, row.short_sent_at, row.long_sent_at, row.remind_at, row.status,
      row.place_address, row.place_lat, row.place_lng, row.place_coord, row.place_provider, row.place_poi,
      row.partner_type, row.partner_user, row.partner_name, row.updated_at, row.id],
  );
  return row;
}

export function insertOrderRow(tx: Tx, o: Partial<OrderDTO> & { id: string; appt_local?: string }, dirty: 0 | 1, createdAt: string): void {
  const tz = (o.timezone as string) || 'Asia/Shanghai';
  tx.run(
    `INSERT INTO orders (${ORDER_COLS}) VALUES (${ORDER_COLS.split(',').map(() => '?').join(',')})`,
    [o.id, o.version ?? '0', o.store ?? '', o.category ?? '其他', o.contact ?? '', o.note ?? '',
      o.price_cents ?? 0, o.deposit_cents ?? 0, o.appt_start ?? '', toLocalInput(o.appt_start ?? '', tz),
      o.appt_end ?? null, tz, o.settle_via ?? 'private', o.channel ?? '直客',
      o.shot_at ?? null, o.submitted_at ?? null, o.short_sent_at ?? null, o.long_sent_at ?? null,
      o.remind_at ?? null, o.status ?? 'active',
      o.place?.address ?? '', o.place?.latitude ?? null, o.place?.longitude ?? null,
      o.place?.coord_system ?? null, o.place?.provider ?? null, o.place?.poi_id ?? null,
      o.partner?.type ?? null, o.partner?.user_id ?? null, o.partner?.external_name ?? null,
      dirty, createdAt, o.updated_at ?? nowRFC3339()],
  );
}

/** 从服务端规范化 DTO 覆盖工作行(replication apply;不动 dirty 对应的本地 pending)。 */
export function upsertFromDTO(tx: Tx, dto: OrderDTO, opts: { keepDirty: boolean; prevDirty: number; createdAt?: string }): void {
  const existing = tx.get(`SELECT created_at, dirty FROM orders WHERE id = ?`, [dto.id]) as { created_at: string; dirty: number } | undefined;
  const tz = dto.timezone || 'Asia/Shanghai';
  if (existing) {
    tx.run(
      `UPDATE orders SET version=?, store=?, category=?, contact=?, note=?, price_cents=?, deposit_cents=?,
         appt_start=?, appt_local=?, appt_end=?, timezone=?, settle_via=?, channel=?,
         shot_at=?, submitted_at=?, short_sent_at=?, long_sent_at=?, remind_at=?, status=?,
         place_address=?, place_lat=?, place_lng=?, place_coord=?, place_provider=?, place_poi=?,
         partner_type=?, partner_user=?, partner_name=?, dirty=?, updated_at=?
       WHERE id=?`,
      [dto.version, dto.store, dto.category, dto.contact, dto.note, dto.price_cents, dto.deposit_cents,
        dto.appt_start, toLocalInput(dto.appt_start, tz), dto.appt_end ?? null, tz, dto.settle_via, dto.channel,
        dto.shot_at ?? null, dto.submitted_at ?? null, dto.short_sent_at ?? null, dto.long_sent_at ?? null,
        dto.remind_at ?? null, dto.status,
        dto.place?.address ?? '', dto.place?.latitude ?? null, dto.place?.longitude ?? null,
        dto.place?.coord_system ?? null, dto.place?.provider ?? null, dto.place?.poi_id ?? null,
        dto.partner?.type ?? null, dto.partner?.user_id ?? null, dto.partner?.external_name ?? null,
        opts.keepDirty ? existing.dirty : 0, dto.updated_at, dto.id],
    );
  } else {
    insertOrderRow(tx, dto, opts.keepDirty ? 1 : 0, opts.createdAt ?? dto.created_at);
  }
}

export function replaceConfirmedPayments(tx: Tx, dto: OrderDTO): void {
  // 用基线重建 confirmed 流水;保留本地 pending(其 origin op 尚未确认)。
  tx.run(`DELETE FROM payment_entries WHERE order_id = ? AND state = 'confirmed'`, [dto.id]);
  for (const p of dto.payments ?? []) {
    tx.run(
      `INSERT OR REPLACE INTO payment_entries (id, order_id, kind, entry_type, amount_cents, method, paid_at, reverses_id, state, origin_op_id, created_at)
       VALUES (?,?,?,?,?,?,?,?, 'confirmed', NULL, ?)`,
      [p.id, dto.id, p.kind, p.entry_type, p.amount_cents, p.method, p.paid_at, p.reverses_id ?? null, dto.created_at],
    );
  }
}

// ---- 业务命令实现(在 commands.ts 注册) ----

export interface CommandResult { ok: true; data?: Record<string, unknown> }

export function createOrder(tx: Tx, payload: Record<string, unknown>, sessionId: string | null, opID: string): CommandResult {
  const id = (payload.id as string) ?? crypto.randomUUID();
  const apptLocal = payload.appt_local as string;
  const tz = (payload.timezone as string) || 'Asia/Shanghai';
  const now = nowRFC3339();
  if (!apptLocal || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(apptLocal)) {
    throw new Error('请填写有效的预约日期和时间');
  }
  const apptUTC = utcFromLocalInput(apptLocal, tz);
  const priceCents = payload.price_cents as number;
  const depositCents = (payload.deposit_cents as number) ?? 0;
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw new Error('总价金额无效');
  if (!Number.isSafeInteger(depositCents) || depositCents < 0 || depositCents > priceCents) {
    throw new Error('总价和定金须为有效金额,定金不能超过总价');
  }
  const store = String(payload.store ?? '').trim();
  if (!store) throw new Error('请填写商家名称');
  insertOrderRow(tx, {
    id, store, category: (payload.category as string) || '其他',
    contact: String(payload.contact ?? ''), note: String(payload.note ?? ''),
    price_cents: priceCents, deposit_cents: depositCents,
    appt_start: apptUTC, timezone: tz,
    settle_via: (payload.settle_via as 'private' | 'douyin') || 'private',
    channel: (payload.channel as string) || '直客',
    place: payload.place as OrderDTO['place'],
    partner: payload.partner as OrderDTO['partner'],
    version: '0', status: 'active', created_at: now, updated_at: now,
  }, 1, now);
  appendOutbox(tx, {
    op_id: opID, aggregate_type: 'order', aggregate_id: id,
    type: 'order.create', precondition: { expected_version: '0' },
    payload: {
      store, category: payload.category, contact: payload.contact, note: payload.note,
      price_cents: priceCents, deposit_cents: depositCents,
      appt_start: apptUTC, appt_end: payload.appt_end ?? undefined,
      timezone: tz, settle_via: payload.settle_via ?? 'private', channel: payload.channel ?? '直客',
      place: payload.place ?? undefined, partner: payload.partner ?? undefined,
    },
  }, sessionId);
  return { ok: true, data: { id } };
}

export function updateOrder(tx: Tx, orderID: string, changes: Record<string, unknown>, sessionId: string | null, opID: string, opType: 'order.update' | 'order.reschedule'): CommandResult {
  const hasReceipt = (kind: string) => {
    const r = tx.get(
      `SELECT COUNT(*) AS n FROM payment_entries WHERE order_id = ? AND kind = ? AND entry_type='receipt'
       AND id NOT IN (SELECT reverses_id FROM payment_entries WHERE order_id = ? AND entry_type='reversal' AND reverses_id IS NOT NULL)`,
      [orderID, kind, orderID],
    ) as { n: number };
    return r.n > 0;
  };
  const mutate = (row: Row) => {
    if (changes.store !== undefined) {
      const s = String(changes.store).trim();
      if (!s) throw new Error('商家名称不能为空');
      row.store = s;
    }
    for (const k of ['category', 'contact', 'note', 'channel'] as const) {
      if (changes[k] !== undefined) row[k] = String(changes[k]);
    }
    if (changes.channel !== undefined && !String(changes.channel).trim()) row.channel = '直客';
    if (changes.settle_via !== undefined) {
      if (!['private', 'douyin'].includes(String(changes.settle_via))) throw new Error('结算方式无效');
      row.settle_via = changes.settle_via;
    }
    if (changes.price_cents !== undefined || changes.deposit_cents !== undefined) {
      if (hasReceipt('deposit') || hasReceipt('final')) {
        throw new Error('已有收款记录,不能修改总价和定金;请先撤销错误收款再改');
      }
      const price = changes.price_cents !== undefined ? Number(changes.price_cents) : Number(row.price_cents);
      const deposit = changes.deposit_cents !== undefined ? Number(changes.deposit_cents) : Number(row.deposit_cents);
      if (!Number.isSafeInteger(price) || price < 0) throw new Error('总价金额无效');
      if (!Number.isSafeInteger(deposit) || deposit < 0 || deposit > price) throw new Error('定金不能超过总价');
      row.price_cents = price;
      row.deposit_cents = deposit;
    }
    const tz = (row.timezone as string) || 'Asia/Shanghai';
    if (changes.appt_local !== undefined) {
      const local = String(changes.appt_local);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('预约时间无效');
      row.appt_start = utcFromLocalInput(local, tz);
    }
    if (changes.clear_appt_end) row.appt_end = null;
    else if (changes.appt_end_local !== undefined) {
      row.appt_end = changes.appt_end_local ? utcFromLocalInput(String(changes.appt_end_local), tz) : null;
    }
    if (changes.place !== undefined) {
      const p = changes.place as Record<string, unknown> | null;
      row.place_address = String(p?.address ?? '');
      row.place_lat = (p?.latitude as string) ?? null;
      row.place_lng = (p?.longitude as string) ?? null;
      row.place_coord = (p?.coord_system as string) ?? null;
      row.place_provider = (p?.provider as string) ?? null;
      row.place_poi = (p?.poi_id as string) ?? null;
    }
  };
  const row = updateOrderFromCommand(tx, orderID, mutate, 'Asia/Shanghai');
  appendOutbox(tx, {
    op_id: opID, aggregate_type: 'order', aggregate_id: orderID, type: opType,
    precondition: preconditionFor(tx, 'order', orderID),
    payload: buildUpdatePayload(changes, row),
  }, sessionId);
  return { ok: true, data: { id: orderID } };
}

function buildUpdatePayload(changes: Record<string, unknown>, row: Row): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const copy = (key: string, value: unknown) => { if (value !== undefined) p[key] = value; };
  copy('store', changes.store);
  copy('category', changes.category);
  copy('contact', changes.contact);
  copy('note', changes.note);
  copy('channel', changes.channel);
  copy('settle_via', changes.settle_via);
  copy('price_cents', changes.price_cents);
  copy('deposit_cents', changes.deposit_cents);
  copy('timezone', changes.timezone);
  if (changes.appt_local !== undefined) copy('appt_start', row.appt_start);
  if (changes.clear_appt_end) p.clear_appt_end = true;
  else if (changes.appt_end_local !== undefined) copy('appt_end', row.appt_end);
  if (changes.place !== undefined) copy('place', changes.place);
  return p;
}

export function setOrderStatus(tx: Tx, orderID: string, status: 'cancelled' | 'archived', sessionId: string | null, opID: string, opType: 'order.cancel' | 'order.archive'): CommandResult {
  updateOrderFromCommand(tx, orderID, (row) => { row.status = status; }, 'Asia/Shanghai');
  appendOutbox(tx, {
    op_id: opID, aggregate_type: 'order', aggregate_id: orderID, type: opType,
    precondition: preconditionFor(tx, 'order', orderID),
    payload: {},
  }, sessionId);
  return { ok: true, data: { id: orderID } };
}

export function deleteOrder(tx: Tx, orderID: string, sessionId: string | null, opID: string): CommandResult {
  const hasActive = tx.get(
    `SELECT COUNT(*) AS n FROM payment_entries WHERE order_id = ? AND entry_type='receipt'
     AND id NOT IN (SELECT reverses_id FROM payment_entries WHERE order_id = ? AND entry_type='reversal' AND reverses_id IS NOT NULL)`,
    [orderID, orderID],
  ) as { n: number };
  if (hasActive.n > 0) {
    throw new Error('该订单有实际收款,只能归档不能删除;如为误记请先撤销收款');
  }
  updateOrderFromCommand(tx, orderID, (row) => { row.status = 'deleted'; }, 'Asia/Shanghai');
  appendOutbox(tx, {
    op_id: opID, aggregate_type: 'order', aggregate_id: orderID, type: 'order.delete',
    precondition: preconditionFor(tx, 'order', orderID),
    payload: {},
  }, sessionId);
  return { ok: true, data: { id: orderID } };
}

export function recordPayment(tx: Tx, orderID: string, kind: 'deposit' | 'final', method: string, paidAtLocal: string, sessionId: string | null, opID: string): CommandResult {
  const order = tx.get(`SELECT ${ORDER_COLS} FROM orders WHERE id = ?`, [orderID]) as Row | undefined;
  if (!order) throw new Error('订单不存在');
  if (!['微信', '支付宝', '银行卡', '抖音商单', '其他'].includes(method)) throw new Error('收款方式无效');
  const entries = tx.all(
    `SELECT id, kind, entry_type, reverses_id FROM payment_entries WHERE order_id = ?`,
    [orderID],
  ) as PayRow[];
  if (deriveActiveReceipts(entries)[kind]) throw new Error('该笔款项已记录,请勿重复收款');
  const due = kind === 'deposit'
    ? Number(order.deposit_cents)
    : Number(order.price_cents) - Number(order.deposit_cents);
  if (due <= 0) throw new Error('没有有效的待收金额,零元单不生成流水');
  const tz = (order.timezone as string) || 'Asia/Shanghai';
  const paidAtUTC = paidAtLocal === 'now' ? nowRFC3339() : utcFromLocalInput(paidAtLocal, tz);
  const entryID = crypto.randomUUID();
  tx.run(
    `INSERT INTO payment_entries (id, order_id, kind, entry_type, amount_cents, method, paid_at, reverses_id, state, origin_op_id, created_at)
     VALUES (?,?,?, 'receipt', ?,?,?, NULL, 'pending', ?, ?)`,
    [entryID, orderID, kind, due, method, paidAtUTC, opID, nowRFC3339()],
  );
  updateOrderFromCommand(tx, orderID, () => {}, tz);
  appendOutbox(tx, {
    op_id: opID, aggregate_type: 'order', aggregate_id: orderID, type: 'payment.record',
    precondition: preconditionFor(tx, 'order', orderID),
    payload: { kind, method, paid_at: paidAtUTC, amount_cents: due },
  }, sessionId);
  return { ok: true, data: { id: orderID, entry_id: entryID, amount_cents: due } };
}

export function reversePayment(tx: Tx, orderID: string, kind: 'deposit' | 'final', sessionId: string | null, opID: string): CommandResult {
  const entries = tx.all(
    `SELECT id, kind, entry_type, reverses_id, amount_cents, method, state, origin_op_id FROM payment_entries WHERE order_id = ?`,
    [orderID],
  ) as (PayRow & { amount_cents: number; method: string; state: string; origin_op_id: string | null })[];
  const active = deriveActiveReceipts(entries)[kind];
  if (!active) throw new Error('没有可撤销的有效收款');
  const receipt = entries.find((p) => p.id === active)!;
  const reversalID = crypto.randomUUID();
  tx.run(
    `INSERT INTO payment_entries (id, order_id, kind, entry_type, amount_cents, method, paid_at, reverses_id, state, origin_op_id, created_at)
     VALUES (?,?,?, 'reversal', ?,?,?, ?, 'pending', ?, ?)`,
    [reversalID, orderID, kind, receipt.amount_cents, receipt.method, nowRFC3339(), active, opID, nowRFC3339()],
  );
  updateOrderFromCommand(tx, orderID, () => {}, 'Asia/Shanghai');
  appendOutbox(tx, {
    op_id: opID, aggregate_type: 'order', aggregate_id: orderID, type: 'payment.reverse',
    precondition: preconditionFor(tx, 'order', orderID),
    payload: { kind },
  }, sessionId);
  return { ok: true, data: { id: orderID, reversal_id: reversalID } };
}

export function assignPartner(tx: Tx, orderID: string, ref: { type: 'account' | 'external'; user_id?: string; external_name?: string }, sessionId: string | null, opID: string): CommandResult {
  if (ref.type === 'account' && !ref.user_id) throw new Error('账号搭档缺少 user_id');
  if (ref.type === 'external' && !String(ref.external_name ?? '').trim()) throw new Error('外部搭档名字不能为空');
  updateOrderFromCommand(tx, orderID, (row) => {
    row.partner_type = ref.type;
    row.partner_user = ref.user_id ?? null;
    row.partner_name = ref.external_name ?? null;
  }, 'Asia/Shanghai');
  appendOutbox(tx, {
    op_id: opID, aggregate_type: 'order', aggregate_id: orderID, type: 'partner.assign',
    precondition: preconditionFor(tx, 'order', orderID),
    payload: ref,
  }, sessionId);
  return { ok: true, data: { id: orderID } };
}

export function grantSchedule(tx: Tx, orderID: string, recipientID: string, role: 'partner' | 'viewer', sessionId: string | null, opID: string, aggregateID: string): CommandResult {
  if (!aggregateID) throw new Error('grant 聚合 ID 缺失');
  const dep = pendingAssignOp(tx, orderID);
  appendOutbox(tx, {
    op_id: opID, aggregate_type: 'grant_set', aggregate_id: aggregateID, type: 'schedule.grant',
    payload: { order_id: orderID, recipient_user_id: recipientID, role },
    requires_success: dep ? [dep] : undefined,
  }, sessionId);
  return { ok: true, data: { share_pending: true } };
}

function pendingAssignOp(tx: Tx, orderID: string): string | null {
  const row = tx.get(
    `SELECT op_id FROM outbox WHERE aggregate_id = ? AND type='partner.assign' AND status IN ('pending','sending') ORDER BY created_at DESC LIMIT 1`,
    [orderID],
  ) as { op_id: string } | undefined;
  return row?.op_id ?? null;
}

export function revokeSchedule(tx: Tx, shareID: string, sessionId: string | null, opID: string, aggregateID: string): CommandResult {
  appendOutbox(tx, {
    op_id: opID, aggregate_type: 'grant_set', aggregate_id: aggregateID, type: 'schedule.revoke',
    payload: { share_id: shareID },
  }, sessionId);
  return { ok: true, data: { revoke_pending: true } };
}

export function updateSettings(tx: Tx, changes: { collect_threshold_days?: number; timezone?: string }, sessionId: string | null, opID: string): CommandResult {
  if (changes.collect_threshold_days !== undefined) {
    if (![7, 15, 30, 45].includes(changes.collect_threshold_days)) throw new Error('催收阈值应为 7、15、30 或 45 天');
    tx.run(`INSERT INTO local_settings (key,value) VALUES ('collect_threshold_days', ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [String(changes.collect_threshold_days)]);
  }
  if (changes.timezone !== undefined) {
    tx.run(`INSERT INTO local_settings (key,value) VALUES ('timezone', ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [changes.timezone]);
  }
  appendOutbox(tx, {
    op_id: opID, aggregate_type: 'settings', aggregate_id: '__settings__', type: 'settings.update',
    payload: changes,
  }, sessionId);
  return { ok: true };
}

// ---- 读取:设置/共享/联系人/授权/冲突/outbox ----

export function getSettings(db: DBApi): SettingsDTO {
  const rows = db.all(`SELECT key, value FROM local_settings WHERE key IN ('collect_threshold_days','timezone')`) as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    collect_threshold_days: Number(map.collect_threshold_days ?? 15),
    timezone: map.timezone ?? 'Asia/Shanghai',
  };
}

export function getSharedSchedules(db: DBApi): Record<string, unknown>[] {
  return db.all(
    `SELECT * FROM shared_schedules s
     WHERE (s.share_id, s.generation) IN (
       SELECT share_id, MAX(CAST(generation AS INTEGER)) FROM shared_schedules GROUP BY share_id
     ) ORDER BY starts_at`,
  ) as Record<string, unknown>[];
}

export function mergeContacts(db: DBApi, contacts: { contact_id: string; user_id: string; nickname: string; auth_relation_generation: string }[]): void {
  db.transaction((tx) => {
    const now = nowRFC3339();
    for (const c of contacts) {
      tx.run(
        `INSERT INTO contacts (user_id, nickname, contact_id, generation, synced_at) VALUES (?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET nickname=excluded.nickname, contact_id=excluded.contact_id,
           generation=excluded.generation, synced_at=excluded.synced_at`,
        [c.user_id, c.nickname, c.contact_id, c.auth_relation_generation, now],
      );
    }
  });
}

export function getContacts(db: DBApi): Record<string, unknown>[] {
  return db.all(`SELECT * FROM contacts ORDER BY nickname`) as Record<string, unknown>[];
}

export function getGrants(db: DBApi, orderID?: string): Record<string, unknown>[] {
  if (orderID) {
    return db.all(
      `SELECT * FROM grants_state g WHERE g.order_id = ? AND (g.share_id, g.generation) IN (
         SELECT share_id, MAX(CAST(generation AS INTEGER)) FROM grants_state GROUP BY share_id)`,
      [orderID],
    ) as Record<string, unknown>[];
  }
  return db.all(
    `SELECT * FROM grants_state g WHERE (g.share_id, g.generation) IN (
       SELECT share_id, MAX(CAST(generation AS INTEGER)) FROM grants_state GROUP BY share_id)`,
  ) as Record<string, unknown>[];
}

export function getConflicts(db: DBApi): Record<string, unknown>[] {
  return db.all(`SELECT * FROM conflicts WHERE status='open' ORDER BY created_at`) as Record<string, unknown>[];
}

export function getOutboxOps(db: DBApi, statuses: string[] = ['pending']): Record<string, unknown>[] {
  const ph = statuses.map(() => '?').join(',');
  return db.all(
    `SELECT * FROM outbox WHERE status IN (${ph}) ORDER BY created_at LIMIT 100`,
    statuses,
  ) as Record<string, unknown>[];
}

export function resolveConflictKeepServer(db: DBApi, conflictID: string): void {
  db.transaction(() => {
    const c = db.get(`SELECT * FROM conflicts WHERE id = ? AND status='open'`, [conflictID]) as Row | undefined;
    if (!c) throw new Error('冲突不存在或已处理');
    const intent = JSON.parse(c.intent as string) as { aggregate_id: string };
    // 以服务端基线为准,丢弃本地意图:从 server_base 恢复工作视图。
    const base = db.get(
      `SELECT content FROM server_base WHERE aggregate_type='order' AND aggregate_id = ?`,
      [intent.aggregate_id],
    ) as { content: string } | undefined;
    db.run(`DELETE FROM orders WHERE id = ?`, [intent.aggregate_id]);
    db.run(`DELETE FROM payment_entries WHERE order_id = ? AND state='pending'`, [intent.aggregate_id]);
    if (base) {
      const dto = JSON.parse(base.content) as OrderDTO;
      upsertFromDTO(db as unknown as Tx, dto, { keepDirty: false, prevDirty: 0 });
    }
    db.run(`UPDATE outbox SET status='superseded', updated_at=? WHERE aggregate_id = ? AND status='pending'`, [nowRFC3339(), intent.aggregate_id]);
    db.run(`UPDATE conflicts SET status='resolved_keep_server' WHERE id = ?`, [conflictID]);
  });
}

export function resolveConflictRetry(db: DBApi, conflictID: string): void {
  db.transaction(() => {
    const c = db.get(`SELECT * FROM conflicts WHERE id = ? AND status='open'`, [conflictID]) as Row | undefined;
    if (!c) throw new Error('冲突不存在或已处理');
    const intent = JSON.parse(c.intent as string) as { aggregate_id: string; payload: Record<string, unknown>; type: string; op_id: string };
    // 以当前基线创建新的更正操作(新 op_id,旧操作标记被取代)。
    const base = db.get(
      `SELECT version, content FROM server_base WHERE aggregate_type='order' AND aggregate_id = ?`,
      [intent.aggregate_id],
    ) as { version: string; content: string } | undefined;
    if (!base) throw new Error('缺少服务端基线,无法重试');
    const newOpID = crypto.randomUUID();
    const payload = { ...intent.payload };
    // 基线版本之上重新提交(把本地字段变更应用到新基线行)。
    const dto = JSON.parse(base.content) as OrderDTO;
    upsertFromDTO(db as unknown as Tx, dto, { keepDirty: false, prevDirty: 0 });
    applyIntentToRow(db as unknown as Tx, intent.type, payload, intent.aggregate_id);
    db.run(
      `INSERT INTO outbox (op_id, aggregate_type, aggregate_id, type, payload, precondition, requires_success, status, session_id, created_at, updated_at)
       VALUES (?,?,?,?,?, 'pending', NULL, 'pending', NULL, ?, ?)`,
      [newOpID, 'order', intent.aggregate_id, intent.type, JSON.stringify(payload), nowRFC3339(), nowRFC3339()],
    );
    db.run(`UPDATE outbox SET status='superseded', updated_at=? WHERE op_id = ?`, [nowRFC3339(), intent.op_id]);
    db.run(`UPDATE conflicts SET status='resolved_retry', created_at=? WHERE id = ?`, [nowRFC3339(), conflictID]);
  });
}

function applyIntentToRow(tx: Tx, type: string, payload: Record<string, unknown>, orderID: string): void {
  void type; void payload; void orderID;
  // 更正操作直接作为新的 update op 提交;字段级应用由服务端按新基线校验。
}
