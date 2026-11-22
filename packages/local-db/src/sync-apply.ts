// 下行应用(replication apply)、推送结果标记、bootstrap 安装、旧数据迁移导入。
import type { PullEvent, OrderDTO, OpResult, ScheduleProjection } from '@tanji/domain';
import { nowRFC3339 } from '@tanji/domain';
import type { Tx, DBApi } from './repo';
import {
  appendOutbox, insertOrderRow, toLocalInput, upsertFromDTO, replaceConfirmedPayments,
} from './repo';

interface Row { [k: string]: unknown }

// ---- 推送结果标记 ----

export function markPushResults(tx: Tx, results: OpResult[]): void {
  for (const r of results) {
    const now = nowRFC3339();
    switch (r.result) {
      case 'applied':
      case 'already_applied':
        tx.run(
          `UPDATE outbox SET status='confirmed', resulting_version=?, updated_at=?, attempts=attempts+1 WHERE op_id=?`,
          [r.resulting_version ?? null, now, r.op_id],
        );
        break;
      case 'conflict': {
        const op = tx.get(`SELECT * FROM outbox WHERE op_id=?`, [r.op_id]) as Row | undefined;
        if (!op) continue;
        tx.run(`UPDATE outbox SET status='conflict', result_code=?, updated_at=? WHERE op_id=?`,
          [r.error_code ?? null, now, r.op_id]);
        tx.run(
          `INSERT INTO conflicts (id, aggregate_id, op_id, intent, server_content, error_code, status, created_at)
           VALUES (?,?,?,?,?, 'version_mismatch', 'open', ?)`,
          [crypto.randomUUID(), op.aggregate_id, r.op_id, op.payload,
            r.payload ? JSON.stringify(r.payload) : null, now],
        );
        // 同聚合的后续 pending 操作暂停(等用户解决冲突后重建链)。
        tx.run(
          `UPDATE outbox SET status='blocked', updated_at=? WHERE aggregate_id=? AND aggregate_type=?
           AND status='pending' AND op_id <> ?`,
          [now, op.aggregate_id, op.aggregate_type, r.op_id],
        );
        break;
      }
      case 'rejected':
        tx.run(`UPDATE outbox SET status='rejected', result_code=?, updated_at=? WHERE op_id=?`,
          [r.error_code ?? null, now, r.op_id]);
        break;
      case 'dependency_pending':
        tx.run(`UPDATE outbox SET status='pending', updated_at=?, attempts=attempts+1 WHERE op_id=?`,
          [now, r.op_id]);
        break;
    }
  }
}

// ---- 下行事件应用(单事务调用方负责) ----

export function applyEvent(tx: Tx, ev: PullEvent): void {
  const now = nowRFC3339();
  switch (ev.event_type) {
    case 'order.changed': {
      const dto = ev.payload as OrderDTO;
      applyOrderChanged(tx, dto, ev.origin_op_id ?? null, now);
      break;
    }
    case 'order.deleted': {
      const p = ev.payload as { id: string; deleted_version: string };
      applyOrderDeleted(tx, p, ev.origin_op_id ?? null, now);
      break;
    }
    case 'settings.changed': {
      const s = ev.payload as { collect_threshold_days?: number; timezone?: string };
      if (s.collect_threshold_days !== undefined) {
        tx.run(`INSERT INTO local_settings (key,value) VALUES ('collect_threshold_days', ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [String(s.collect_threshold_days)]);
      }
      if (s.timezone !== undefined) {
        tx.run(`INSERT INTO local_settings (key,value) VALUES ('timezone', ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [s.timezone]);
      }
      tx.run(
        `INSERT INTO server_base (aggregate_type, aggregate_id, version, content) VALUES ('settings','__settings__','1',?)
         ON CONFLICT(aggregate_type, aggregate_id) DO UPDATE SET version=excluded.version, content=excluded.content`,
        [JSON.stringify(s)],
      );
      break;
    }
    case 'share.granted':
    case 'share.updated': {
      const proj = ev.payload as ScheduleProjection;
      if (!proj?.share_id) return;
      // 只按更高 generation/revision 应用,不回退。
      const existing = tx.get(
        `SELECT generation, revision FROM shared_schedules WHERE share_id=? AND generation=?`,
        [proj.share_id, proj.generation],
      ) as { revision: string } | undefined;
      if (existing && BigInt(existing.revision) >= BigInt(proj.projection_revision)) return;
      tx.run(
        `INSERT INTO shared_schedules (share_id, generation, revision, owner_display, store, starts_at, ends_at,
           timezone, address, latitude, longitude, coord_system, provider, poi_id, schedule_status,
           auth_relation_id, auth_relation_generation, synced_at, verified_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')
         ON CONFLICT(share_id, generation) DO UPDATE SET
           revision=excluded.revision, owner_display=excluded.owner_display, store=excluded.store,
           starts_at=excluded.starts_at, ends_at=excluded.ends_at, timezone=excluded.timezone,
           address=excluded.address, latitude=excluded.latitude, longitude=excluded.longitude,
           coord_system=excluded.coord_system, provider=excluded.provider, poi_id=excluded.poi_id,
           schedule_status=excluded.schedule_status, synced_at=excluded.synced_at`,
        [proj.share_id, proj.generation, proj.projection_revision, proj.owner_display, proj.store,
          proj.starts_at, proj.ends_at ?? null, proj.timezone, proj.address,
          proj.latitude ?? null, proj.longitude ?? null, proj.coord_system ?? null,
          proj.provider ?? null, proj.poi_id ?? null, proj.schedule_status,
          proj.auth_relation_id, proj.auth_relation_generation, now],
      );
      // 本人事件:同步授权状态(grants_state);接收者事件:grants_state 只在本人流出现。
      if (isOwnerEvent(tx, proj, ev)) {
        tx.run(
          `INSERT INTO grants_state (share_id, order_id, recipient, role, generation, revision, status, updated_at)
           VALUES (?,?,?,?,?,?, 'active', ?)
           ON CONFLICT(share_id) DO UPDATE SET generation=excluded.generation, revision=excluded.revision,
             status='active', updated_at=excluded.updated_at`,
          [proj.share_id, (ev.payload as Record<string, unknown>).order_id ?? '',
            (ev.payload as Record<string, unknown>).recipient_user_id ?? '',
            (ev.payload as Record<string, unknown>).role ?? 'viewer',
            proj.generation, proj.projection_revision, now],
        );
      }
      break;
    }
    case 'share.purged': {
      const p = ev.payload as { share_id: string; generation: string };
      if (!p?.share_id) return;
      // 只清除指定代次;重新授权的新代次不受影响(迟到 purge 不误删)。
      tx.run(
        `DELETE FROM shared_schedules WHERE share_id=? AND CAST(generation AS INTEGER) <= CAST(? AS INTEGER)`,
        [p.share_id, p.generation],
      );
      tx.run(
        `UPDATE grants_state SET status='revoked', updated_at=? WHERE share_id=? AND CAST(generation AS INTEGER) <= CAST(? AS INTEGER)`,
        [now, p.share_id, p.generation],
      );
      break;
    }
    case 'relation.purged': {
      const p = ev.payload as { auth_relation_id: string; auth_relation_generation: string };
      if (!p?.auth_relation_id) return;
      // 精确代次:仅清除该关系该代次的缓存;重新接受后的新代次不受影响。
      tx.run(
        `DELETE FROM shared_schedules WHERE auth_relation_id=? AND CAST(auth_relation_generation AS INTEGER) <= CAST(? AS INTEGER)`,
        [p.auth_relation_id, p.auth_relation_generation],
      );
      tx.run(`DELETE FROM contacts WHERE contact_id=?`, [p.auth_relation_id]);
      break;
    }
    default:
      break; // contact.added 等在拉取联系人接口单独处理
  }
}

function isOwnerEvent(tx: Tx, proj: ScheduleProjection, ev: PullEvent): boolean {
  void tx; void proj;
  // 本人事件带 owner 视角字段(order_id/recipient_user_id/role);接收者投影没有这些。
  const p = ev.payload as Record<string, unknown>;
  return !!(p && p.order_id && p.recipient_user_id);
}

function applyOrderChanged(tx: Tx, dto: OrderDTO, originOpID: string | null, now: string): void {
  // 基线:总是更新(不倒退)。
  const base = tx.get(
    `SELECT version FROM server_base WHERE aggregate_type='order' AND aggregate_id=?`,
    [dto.id],
  ) as { version: string } | undefined;
  if (base && BigInt(base.version) > BigInt(dto.version)) return;
  tx.run(
    `INSERT INTO server_base (aggregate_type, aggregate_id, version, content) VALUES ('order',?,?,?)
     ON CONFLICT(aggregate_type, aggregate_id) DO UPDATE SET version=excluded.version, content=excluded.content`,
    [dto.id, dto.version, JSON.stringify(dto)],
  );

  const pendingOps = tx.all(
    `SELECT op_id, type, payload FROM outbox WHERE aggregate_id=? AND aggregate_type='order' AND status='pending'`,
    [dto.id],
  ) as Row[];

  if (originOpID) {
    // 回执确认路径:这条事件正是某 pending/sending 操作的结果。
    const op = tx.get(
      `SELECT status FROM outbox WHERE op_id=? AND aggregate_id=?`,
      [originOpID, dto.id],
    ) as { status: string } | undefined;
    if (op && (op.status === 'pending' || op.status === 'sending' || op.status === 'confirmed')) {
      tx.run(
        `UPDATE outbox SET status='confirmed', resulting_version=?, updated_at=? WHERE op_id=?`,
        [dto.version, now, originOpID],
      );
      tx.run(
        `UPDATE payment_entries SET state='confirmed' WHERE origin_op_id=? AND state='pending'`,
        [originOpID],
      );
    }
  }

  if (pendingOps.length === 0 || (originOpID && pendingOps.every((p) => p.op_id === originOpID))) {
    // 无待同步修改(或只剩本操作):直接以服务端为准。
    upsertFromDTO(tx, dto, { keepDirty: false, prevDirty: 0 });
    replaceConfirmedPayments(tx, dto);
    tx.run(`UPDATE orders SET dirty=0 WHERE id=?`, [dto.id]);
    return;
  }

  // 有未确认操作:先落基线,再按链重放本地意图形成工作视图(AC04 不覆盖本地修改)。
  upsertFromDTO(tx, dto, { keepDirty: false, prevDirty: 0 });
  replaceConfirmedPayments(tx, dto);
  replayPending(tx, dto.id, pendingOps);
  tx.run(`UPDATE orders SET dirty=1, updated_at=? WHERE id=?`, [now, dto.id]);
  // 重锚定:若基线前进不是由首个 pending 操作的锚点(其 after_op_id)带来的,
  // 则把首个 pending 操作的版本条件重置为新基线版本(意图重放到新基线)。
  const first = tx.get(
    `SELECT op_id, precondition FROM outbox WHERE aggregate_id=? AND aggregate_type='order'
     AND status = 'pending' ORDER BY created_at LIMIT 1`,
    [dto.id],
  ) as { op_id: string; precondition: string | null } | undefined;
  if (first) {
    let anchor: string | null = null;
    try {
      const pre = first.precondition ? JSON.parse(first.precondition) : null;
      anchor = pre?.after_op_id ?? null;
    } catch { anchor = null; }
    if (anchor !== originOpID) {
      tx.run(`UPDATE outbox SET precondition=? WHERE op_id=?`,
        [JSON.stringify({ expected_version: dto.version }), first.op_id]);
    }
  }
}

/** 在新基线上重放未确认操作的工作视图效果(字段级 apply,不是重算版本)。 */
function replayPending(tx: Tx, orderID: string, pendingOps: Row[]): void {
  const tzRow = tx.get(`SELECT timezone FROM orders WHERE id=?`, [orderID]) as { timezone: string } | undefined;
  const tz = tzRow?.timezone || 'Asia/Shanghai';
  for (const op of pendingOps) {
    const type = op.type as string;
    // payload 在库里是 TEXT;统一解析。
    const payload: Record<string, unknown> = typeof op.payload === 'string'
      ? JSON.parse(op.payload as string)
      : (op.payload as Record<string, unknown>);
    if (type === 'order.update' || type === 'order.reschedule') {
      const p = payload;
      const sets: string[] = [];
      const vals: unknown[] = [];
      const push = (col: string, val: unknown) => { sets.push(`${col}=?`); vals.push(val); };
      if (p.store !== undefined) push('store', p.store);
      if (p.category !== undefined) push('category', p.category);
      if (p.contact !== undefined) push('contact', p.contact);
      if (p.note !== undefined) push('note', p.note);
      if (p.channel !== undefined) push('channel', p.channel);
      if (p.settle_via !== undefined) push('settle_via', p.settle_via);
      if (p.price_cents !== undefined) push('price_cents', p.price_cents);
      if (p.deposit_cents !== undefined) push('deposit_cents', p.deposit_cents);
      if (p.appt_start !== undefined) {
        push('appt_start', p.appt_start);
        push('appt_local', toLocalInput(p.appt_start as string, tz));
      }
      if (p.clear_appt_end) push('appt_end', null);
      else if (p.appt_end !== undefined) push('appt_end', p.appt_end);
      if (p.place !== undefined) {
        const place = p.place as Record<string, unknown> | null;
        push('place_address', place?.address ?? '');
        push('place_lat', place?.latitude ?? null);
        push('place_lng', place?.longitude ?? null);
        push('place_coord', place?.coord_system ?? null);
        push('place_provider', place?.provider ?? null);
        push('place_poi', place?.poi_id ?? null);
      }
      if (sets.length) {
        tx.run(`UPDATE orders SET ${sets.join(', ')}, dirty=1 WHERE id=?`, [...vals, orderID]);
      }
      continue;
    }
    if (type === 'partner.assign') {
      const p = payload as { type: string; user_id?: string; external_name?: string };
      tx.run(`UPDATE orders SET partner_type=?, partner_user=?, partner_name=?, dirty=1 WHERE id=?`,
        [p.type, p.user_id ?? null, p.external_name ?? null, orderID]);
      continue;
    }
    if (type === 'payment.record') {
      const p = payload as { kind: string; method: string; paid_at: string; amount_cents: number };
      const exists = tx.get(
        `SELECT id FROM payment_entries WHERE origin_op_id=?`,
        [op.op_id],
      ) as { id: string } | undefined;
      if (!exists) {
        tx.run(
          `INSERT INTO payment_entries (id, order_id, kind, entry_type, amount_cents, method, paid_at, reverses_id, state, origin_op_id, created_at)
           VALUES (?,?,?, 'receipt', ?,?,?, NULL, 'pending', ?, ?)`,
          [crypto.randomUUID(), orderID, p.kind, p.amount_cents, p.method, p.paid_at, op.op_id, nowRFC3339()],
        );
      }
    } else if (type === 'payment.reverse') {
      const p = payload as { kind: string };
      const exists = tx.get(
        `SELECT id FROM payment_entries WHERE origin_op_id=?`,
        [op.op_id],
      ) as { id: string } | undefined;
      if (!exists) {
        const base = tx.get(
          `SELECT content FROM server_base WHERE aggregate_type='order' AND aggregate_id=?`,
          [orderID],
        ) as { content: string } | undefined;
        if (base) {
          const dto = JSON.parse(base.content) as OrderDTO;
          const receipt = dto.payments.find(
            (x) => x.kind === p.kind && x.entry_type === 'receipt' && !dto.payments.some((r) => r.reverses_id === x.id),
          );
          if (receipt) {
            tx.run(
              `INSERT INTO payment_entries (id, order_id, kind, entry_type, amount_cents, method, paid_at, reverses_id, state, origin_op_id, created_at)
               VALUES (?,?,?, 'reversal', ?,?,?, ?, 'pending', ?, ?)`,
              [crypto.randomUUID(), orderID, p.kind, receipt.amount_cents, receipt.method, nowRFC3339(), receipt.id, op.op_id, nowRFC3339()],
            );
          }
        }
      }
    }
    // order.update/reschedule/create/delete 的工作视图效果已由本地修改产生,基线刷新时
    // upsertFromDTO(keepDirty) 保留了本地行字段——这里无需重复。
  }
}

function applyOrderDeleted(tx: Tx, p: { id: string; deleted_version: string }, originOpID: string | null, now: string): void {
  tx.run(
    `INSERT INTO server_base (aggregate_type, aggregate_id, version, content) VALUES ('order',?,?,?)
     ON CONFLICT(aggregate_type, aggregate_id) DO UPDATE SET version=excluded.version, content=excluded.content`,
    [p.id, p.deleted_version, JSON.stringify({ id: p.id, status: 'deleted', version: p.deleted_version })],
  );
  const pendingOps = tx.all(
    `SELECT op_id, type, payload FROM outbox WHERE aggregate_id=? AND aggregate_type='order' AND status IN ('pending','sending')`,
    [p.id],
  ) as Row[];
  const localPending = pendingOps.filter((op) => op.op_id !== originOpID);
  if (localPending.length > 0) {
    // 删除 vs 本地未同步修改:进入冲突处理,不静默丢弃(AC13 保留双方)。
    for (const op of localPending) {
      tx.run(
        `INSERT INTO conflicts (id, aggregate_id, op_id, intent, server_content, error_code, status, created_at)
         VALUES (?,?,?,?,?, 'entity_deleted', 'open', ?)`,
        [crypto.randomUUID(), p.id, op.op_id as string, JSON.stringify(op.payload),
          JSON.stringify({ id: p.id, deleted: true, deleted_version: p.deleted_version }), now],
      );
      tx.run(`UPDATE outbox SET status='conflict', result_code='entity_deleted', updated_at=? WHERE op_id=?`,
        [now, op.op_id]);
    }
  }
  if (originOpID) {
    tx.run(`UPDATE outbox SET status='confirmed', resulting_version=?, updated_at=? WHERE op_id=?`,
      [p.deleted_version, now, originOpID]);
  }
  tx.run(`DELETE FROM orders WHERE id=?`, [p.id]);
  tx.run(`DELETE FROM payment_entries WHERE order_id=?`, [p.id]);
}

// ---- pull 页应用:新基线 + 事件 + 游标一起提交(调用方包事务) ----

export function applyPullPage(
  tx: Tx,
  events: PullEvent[],
  cursor: string,
  highWater: string,
  epoch: number,
): void {
  for (const ev of events) applyEvent(tx, ev);
  tx.run(
    `UPDATE sync_meta SET cursor=?, high_water=?, stream_epoch=?, last_pull_at=? WHERE id=1`,
    [cursor, highWater, epoch, nowRFC3339()],
  );
}

// ---- bootstrap 安装:staging 校验后一个事务整体上线 ----

export function installBootstrap(
  db: DBApi,
  pages: { orders: OrderDTO[] }[],
  tail: { settings?: { collect_threshold_days?: number; timezone?: string }; shares?: ScheduleProjection[]; epoch: number; high_water: string; receipts?: { op_id: string; result: string; resulting_version?: string }[] },
): void {
  // staging:内存校验所有页后再动库;失败保持旧库与队列完全可用。
  const allOrders: OrderDTO[] = [];
  for (const page of pages) for (const o of page.orders) allOrders.push(o);
  const active = allOrders.filter((o) => o.status !== 'deleted');
  const tombstones = allOrders.filter((o) => o.status === 'deleted');
  db.transaction(() => {
    // 清空基线层(保留 outbox/conflicts/migration_map/local_settings)。
    db.run(`DELETE FROM orders`);
    db.run(`DELETE FROM payment_entries`);
    db.run(`DELETE FROM server_base`);
    db.run(`DELETE FROM shared_schedules`);
    db.run(`DELETE FROM grants_state`);
    for (const dto of active) {
      upsertFromDTO(db as unknown as Tx, dto, { keepDirty: false, prevDirty: 0, createdAt: dto.created_at });
      replaceConfirmedPayments(db as unknown as Tx, dto);
      db.run(
        `INSERT INTO server_base (aggregate_type, aggregate_id, version, content) VALUES ('order',?,?,?)`,
        [dto.id, dto.version, JSON.stringify(dto)],
      );
    }
    for (const t of tombstones) {
      db.run(
        `INSERT INTO server_base (aggregate_type, aggregate_id, version, content) VALUES ('order',?,?,?)`,
        [t.id, t.version, JSON.stringify({ id: t.id, status: 'deleted', version: t.version })],
      );
    }
    if (tail.settings) {
      if (tail.settings.collect_threshold_days !== undefined) {
        db.run(`INSERT INTO local_settings (key,value) VALUES ('collect_threshold_days', ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [String(tail.settings.collect_threshold_days)]);
      }
      if (tail.settings.timezone) {
        db.run(`INSERT INTO local_settings (key,value) VALUES ('timezone', ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [tail.settings.timezone]);
      }
    }
    for (const proj of tail.shares ?? []) {
      db.run(
        `INSERT OR REPLACE INTO shared_schedules (share_id, generation, revision, owner_display, store, starts_at, ends_at,
           timezone, address, latitude, longitude, coord_system, provider, poi_id, schedule_status,
           auth_relation_id, auth_relation_generation, synced_at, verified_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`,
        [proj.share_id, proj.generation, proj.projection_revision, proj.owner_display, proj.store,
          proj.starts_at, proj.ends_at ?? null, proj.timezone, proj.address,
          proj.latitude ?? null, proj.longitude ?? null, proj.coord_system ?? null,
          proj.provider ?? null, proj.poi_id ?? null, proj.schedule_status,
          proj.auth_relation_id, proj.auth_relation_generation, nowRFC3339()],
      );
    }
    // 回执:与快照同一切点;applied/already_applied 的 op 标记确认,其余保持 pending 重放。
    for (const r of tail.receipts ?? []) {
      if (r.result === 'applied' || r.result === 'already_applied') {
        db.run(
          `UPDATE outbox SET status='confirmed', resulting_version=COALESCE(?, resulting_version), updated_at=? WHERE op_id=? AND status IN ('pending','sending')`,
          [r.resulting_version ?? null, nowRFC3339(), r.op_id],
        );
        db.run(`UPDATE payment_entries SET state='confirmed' WHERE origin_op_id=? AND state='pending'`, [r.op_id]);
      }
    }
    // 仍 pending 的意图重放到新基线上(AC14:重建后队列仍在,逐项对账)。
    const pendingOps = db.all(
      `SELECT op_id, aggregate_id, aggregate_type, type, payload FROM outbox WHERE status IN ('pending','sending')
       ORDER BY created_at, op_id`,
    ) as Row[];
    for (const op of pendingOps) {
      if (op.type === 'order.create') {
        const p = JSON.parse(op.payload as string) as Record<string, unknown>;
        // create 未确认:把本地行重新插入(快照里没有它)。
        const exists = db.get(`SELECT id FROM orders WHERE id=?`, [op.aggregate_id]) as { id: string } | undefined;
        if (!exists) {
          const now = nowRFC3339();
          insertOrderRow(db as unknown as Tx, {
            id: op.aggregate_id as string, version: '0',
            store: String(p.store ?? ''), category: (p.category as string) ?? '其他',
            contact: String(p.contact ?? ''), note: String(p.note ?? ''),
            price_cents: Number(p.price_cents ?? 0), deposit_cents: Number(p.deposit_cents ?? 0),
            appt_start: p.appt_start as string, timezone: (p.timezone as string) || 'Asia/Shanghai',
            settle_via: (p.settle_via as 'private' | 'douyin') ?? 'private',
            channel: (p.channel as string) ?? '直客',
            status: 'active', created_at: now, updated_at: now,
            place: p.place as OrderDTO['place'], partner: p.partner as OrderDTO['partner'],
          }, 1, now);
        }
      } else if (op.aggregate_type === 'order' && op.type !== 'order.delete') {
        replayPending(db as unknown as Tx, op.aggregate_id as string, [op]);
      }
      // order.delete 未确认:工作行在快照中仍存在;保留并标记 dirty(重新对账时服务端会拒绝并进冲突)。
    }
    const stillPending = db.all(
      `SELECT DISTINCT aggregate_id FROM outbox WHERE status IN ('pending','sending') AND aggregate_type='order'`,
    ) as Row[];
    for (const row of stillPending) {
      db.run(`UPDATE orders SET dirty=1 WHERE id=?`, [row.aggregate_id]);
    }
    db.run(
      `UPDATE sync_meta SET cursor=NULL, high_water=?, stream_epoch=?, last_pull_at=? WHERE id=1`,
      [tail.high_water, tail.epoch, nowRFC3339()],
    );
  });
}

// ---- 旧数据迁移导入(单事务;重复导入以 migration_map 去重) ----

export interface LegacyImportItem {
  legacyId: number;
  store: string;
  category: string;
  contact: string;
  note: string;
  priceCents: number;
  depositCents: number;
  apptStartUTC: string;
  timezone: string;
  settleVia: 'private' | 'douyin';
  channel: string;
  partnerName: string;
  shotAt: string | null;
  submittedAt: string | null;
  shortSentAt: string | null;
  longSentAt: string | null;
  remindAt: string | null;
  payments: { kind: 'deposit' | 'final'; amountCents: number; method: string; paidAtUTC: string }[];
}

export function importLegacy(
  tx: Tx,
  sourceDataset: string,
  items: LegacyImportItem[],
  sessionId: string | null,
): { created: number; skipped: number } {
  let created = 0;
  let skipped = 0;
  for (const item of items) {
    const mapped = tx.get(
      `SELECT new_id FROM migration_map WHERE source_dataset=? AND kind='order' AND old_id=?`,
      [sourceDataset, String(item.legacyId)],
    ) as { new_id: string } | undefined;
    if (mapped) { skipped++; continue; } // AC15:同一来源重复导入不重复入账
    const id = crypto.randomUUID();
    const now = nowRFC3339();
    insertOrderRow(tx, {
      id, version: '0', store: item.store, category: item.category, contact: item.contact,
      note: item.note, price_cents: item.priceCents, deposit_cents: item.depositCents,
      appt_start: item.apptStartUTC, timezone: item.timezone, settle_via: item.settleVia,
      channel: item.channel, shot_at: item.shotAt, submitted_at: item.submittedAt,
      short_sent_at: item.shortSentAt, long_sent_at: item.longSentAt, remind_at: item.remindAt,
      status: 'active', created_at: now, updated_at: now,
      partner: item.partnerName ? { type: 'external', external_name: item.partnerName } : null,
    }, 1, now);
    for (const p of item.payments) {
      tx.run(
        `INSERT INTO payment_entries (id, order_id, kind, entry_type, amount_cents, method, paid_at, reverses_id, state, origin_op_id, created_at)
         VALUES (?,?,?, 'receipt', ?,?,?, NULL, 'pending', NULL, ?)`,
        [crypto.randomUUID(), id, p.kind, p.amountCents, p.method, p.paidAtUTC, now],
      );
    }
    tx.run(
      `INSERT INTO migration_map (source_dataset, kind, old_id, new_id) VALUES (?,?,?,?)`,
      [sourceDataset, 'order', String(item.legacyId), id],
    );
    for (const p of item.payments) {
      // 流水 ID 稳定映射:按 (来源, 订单旧ID, 序号)
      const idx = item.payments.indexOf(p);
      tx.run(
        `INSERT INTO migration_map (source_dataset, kind, old_id, new_id) VALUES (?,?,?,?)`,
        [sourceDataset, 'payment', `${item.legacyId}:${idx}`, `${id}:${p.kind}`],
      );
    }
    appendOutbox(tx, {
      op_id: crypto.randomUUID(), aggregate_type: 'order', aggregate_id: id,
      type: 'order.create', precondition: { expected_version: '0' },
      payload: {
        store: item.store, category: item.category, contact: item.contact, note: item.note,
        price_cents: item.priceCents, deposit_cents: item.depositCents,
        appt_start: item.apptStartUTC, timezone: item.timezone,
        settle_via: item.settleVia, channel: item.channel,
        partner: item.partnerName ? { type: 'external', external_name: item.partnerName } : undefined,
      },
    }, sessionId);
    created++;
  }
  return { created, skipped };
}

export function getMigrationMap(db: DBApi, sourceDataset: string): Record<string, unknown>[] {
  return db.all(`SELECT * FROM migration_map WHERE source_dataset=?`, [sourceDataset]) as Record<string, unknown>[];
}
