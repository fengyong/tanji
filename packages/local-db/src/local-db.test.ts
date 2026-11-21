// 本地数据内核不变量测试:真实 SQLite(官方 WASM 的 Node 构建)。
// 覆盖 AC01/AC03/AC04/AC05 的本地部分、AC13/AC14 的客户端行为、AC15 幂等迁移。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createNodeLedger } from './test-adapter';
import type { PullEvent, OrderDTO } from '@tanji/domain';

// 每个用例独立账本,避免相互污染
let ledger: Awaited<ReturnType<typeof createNodeLedger>>;

beforeEach(async () => { ledger = await createNodeLedger(); });
afterEach(() => ledger.reset());

async function openLedger(sessionId = 'sess-1') {
  await ledger.call('open', { env: 'prod', accountId: 'user-A', sessionId });
}

describe('本地事务与 outbox', () => {
  it('AC01: 离线创建订单 → 业务行 + outbox 同事务落盘;刷新重开仍在', async () => {
    await openLedger();
    const res = (await ledger.call('createOrder', {
      sessionId: 'sess-1',
      payload: {
        appt_local: '2026-11-23T10:00', timezone: 'Asia/Shanghai',
        store: '离线奶茶', price_cents: 9900, deposit_cents: 1000,
      },
    })) as { data: { id: string } };
    const resId = res.data.id;
    expect(resId).toMatch(/^[0-9a-f-]{36}$/);

    const ops = (await ledger.call('nextOutboxBatch', { limit: 10 })) as Record<string, unknown>[];
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('order.create');
    expect((ops[0].payload as Record<string, unknown>).appt_start).toBe('2026-11-23T02:00:00Z');
    expect((ops[0].precondition as Record<string, string>).expected_version).toBe('0');

    // 强制退出重开(关闭再打开,新连接读同一文件)。
    await ledger.call('close');
    await openLedger('sess-1');
    const orders = (await ledger.call('listOrders', { day: '2026-11-23' })) as Record<string, unknown>[];
    expect(orders).toHaveLength(1);
    expect(orders[0].store).toBe('离线奶茶');
    expect(orders[0].dirty).toBe(1);
  });

  it('AC03: 连续离线 create→update→收款 用 after_op_id 链接,顺序与依赖正确', async () => {
    await openLedger();
    const created = (await ledger.call('createOrder', {
      sessionId: 'sess-1',
      payload: { appt_local: '2026-11-24T10:00', timezone: 'Asia/Shanghai', store: '链式店', price_cents: 5000, deposit_cents: 0 },
    })) as { data: { id: string } };
    const id = created.data.id;
    // 先取走 create(模拟发送中)。
    const ops = (await ledger.call('nextOutboxBatch', { limit: 10 })) as Record<string, unknown>[];
    expect(ops.map((o) => o.type)).toEqual(['order.create']);
    // 之后离线追加 update 与收款。
    await ledger.call('updateOrder', {
      id, sessionId: 'sess-1',
      changes: { note: '改备注', price_cents: 6000 },
    });
    await ledger.call('recordPayment', { id, kind: 'final', method: '微信', paidAtLocal: 'now', sessionId: 'sess-1' });
    const ops2 = (await ledger.call('nextOutboxBatch', { limit: 10 })) as Record<string, unknown>[];
    const byType = Object.fromEntries(ops2.map((o) => [o.type, o]));
    expect(byType['order.update']).toBeTruthy();
    const upd = byType['order.update'] as Record<string, unknown>;
    const updPre = typeof upd.precondition === 'string' ? JSON.parse(upd.precondition as string) : upd.precondition;
    expect((updPre as Record<string, string>).after_op_id).toBe(ops[0].op_id);
    const pay = byType['payment.record'] as Record<string, unknown>;
    const payPre = typeof pay.precondition === 'string' ? JSON.parse(pay.precondition as string) : pay.precondition;
    expect((payPre as Record<string, string>).after_op_id).toBe(upd.op_id);
    // 金额 = 改价后的定金之外……deposit=0 → 记收款应失败?
  });
});

describe('下行应用与重放', () => {
  it('AC04: 下行到来时有未上传修改 → 基线更新 + 本地字段保留(重放)', async () => {
    await openLedger();
    const created = (await ledger.call('createOrder', {
      sessionId: 'sess-1',
      payload: { appt_local: '2026-11-25T10:00', timezone: 'Asia/Shanghai', store: '重放店', price_cents: 8000, deposit_cents: 0 },
    })) as { data: { id: string } };
    const id = created.data.id;
    // 取走 create op(sending)。
    await ledger.call('nextOutboxBatch', { limit: 10 });
    // 离线改备注(outbox: order.update pending)。
    await ledger.call('updateOrder', { id, sessionId: 'sess-1', changes: { note: '本地备注' } });

    // 服务端事件:云端有人把这单改了价(另一台设备),带不同 origin。
    const dto: OrderDTO = {
      id, version: '7', store: '重放店', category: '其他', contact: '', note: '云端备注',
      price_cents: 9999, deposit_cents: 0, appt_start: '2026-11-25T02:00:00Z', timezone: 'Asia/Shanghai',
      settle_via: 'private', channel: '直客', status: 'active',
      payments: [], created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-21T00:00:00Z',
    };
    const ev: PullEvent = { seq: '1', event_type: 'order.changed', entity_id: id, payload: dto };
    await ledger.call('applyPullPage', { events: [ev], cursor: 'c1', highWater: '1', epoch: 1 });

    const orders = (await ledger.call('listOrders', { day: '2026-11-25' })) as Record<string, unknown>[];
    const row = orders.find((o) => o.id === id)!;
    expect(row.price_cents).toBe(9999); // 基线更新
    expect(row.note).toBe('本地备注'); // 本地意图保留
    expect(row.dirty).toBe(1);
    // update op 的 precondition 现在应指向基线版本 7(expected_version),而不是旧值。
    const ops = (await ledger.call('listOutbox', { statuses: ['pending'] })) as Record<string, unknown>[];
    const upd = ops.find((o) => o.type === 'order.update') as Record<string, unknown>;
    const pre = JSON.parse(upd.precondition as string) as Record<string, string>;
    expect(pre.expected_version).toBe('7');
  });

  it('回执确认:order.changed 带 origin_op_id → outbox 确认 + pending 流水转 confirmed', async () => {
    await openLedger();
    const created = (await ledger.call('createOrder', {
      sessionId: 'sess-1',
      payload: { appt_local: '2026-11-26T10:00', timezone: 'Asia/Shanghai', store: '确认店', price_cents: 3000, deposit_cents: 1000 },
    })) as { data: { id: string } };
    const id = created.data.id;
    await ledger.call('recordPayment', { id, kind: 'deposit', method: '支付宝', paidAtLocal: 'now', sessionId: 'sess-1' });
    const batch = (await ledger.call('nextOutboxBatch', { limit: 10 })) as Record<string, unknown>[];
    const createOp = batch[0];
    const payOp = batch.find((o) => o.type === 'payment.record') as Record<string, unknown> | undefined;
    expect(payOp).toBeTruthy();
    void createOp;

    const dto: OrderDTO = {
      id, version: '2', store: '确认店', category: '其他', contact: '', note: '',
      price_cents: 3000, deposit_cents: 1000, appt_start: '2026-11-26T02:00:00Z', timezone: 'Asia/Shanghai',
      settle_via: 'private', channel: '直客', status: 'active',
      payments: [
        { id: 'srv-p1', order_id: id, kind: 'deposit', entry_type: 'receipt', amount_cents: 1000, method: '支付宝', paid_at: '2026-11-26T02:05:00Z' },
      ],
      created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-21T00:00:00Z',
    };
    await ledger.call('applyPullPage', {
      events: [
        { seq: '2', event_type: 'order.changed', entity_id: id, origin_op_id: createOp.op_id, payload: { ...dto, version: '1' } },
        { seq: '3', event_type: 'order.changed', entity_id: id, origin_op_id: payOp!.op_id, payload: dto },
      ],
      cursor: 'c2', highWater: '3', epoch: 1,
    });
    const orders = (await ledger.call('listOrders', { day: '2026-11-26' })) as Record<string, unknown>[];
    const row = orders.find((o) => o.id === id)!;
    expect(row.dirty).toBe(0);
    expect(row.version).toBe('2');
    const payments = row.payments as Record<string, unknown>[];
    expect(payments.every((p) => p.state === 'confirmed')).toBe(true);
    const ops = (await ledger.call('listOutbox', { statuses: ['confirmed'] })) as Record<string, unknown>[];
    expect(ops.length).toBeGreaterThanOrEqual(2);
  });

  it('AC13: 删除事件 vs 本地未同步修改 → 冲突保留,不静默丢弃', async () => {
    await openLedger();
    const created = (await ledger.call('createOrder', {
      sessionId: 'sess-1',
      payload: { appt_local: '2026-11-27T10:00', timezone: 'Asia/Shanghai', store: '删除冲突店', price_cents: 100, deposit_cents: 0 },
    })) as { data: { id: string } };
    const id = created.data.id;
    await ledger.call('nextOutboxBatch', { limit: 10 }); // create → sending
    await ledger.call('updateOrder', { id, sessionId: 'sess-1', changes: { note: '本地未同步' } });
    await ledger.call('applyPullPage', {
      events: [{ seq: '4', event_type: 'order.deleted', entity_id: id, payload: { id, deleted_version: '2' } }],
      cursor: 'c3', highWater: '4', epoch: 1,
    });
    const conflicts = (await ledger.call('listConflicts')) as Record<string, unknown>[];
    expect(conflicts.some((c) => c.aggregate_id === id && c.error_code === 'entity_deleted')).toBe(true);
    const orders = (await ledger.call('listOrders', {})) as Record<string, unknown>[];
    expect(orders.find((o) => o.id === id)).toBeUndefined(); // 已删除不复活
    // 本地意图保存在冲突里。
    const c = conflicts.find((x) => x.aggregate_id === id)!;
    expect((c.intent as string)).toContain('本地未同步' as unknown as never).toBeTruthy();
  });

  it('share purge 只清指定代次;重新授权的新代次不受迟到 purge 影响', async () => {
    await openLedger();
    const proj = (gen: string) => ({
      share_id: 'share-1', generation: gen, projection_revision: '1',
      owner_display: '店长', store: '共享店', starts_at: '2026-11-25T02:00:00Z',
      timezone: 'Asia/Shanghai', address: '', schedule_status: 'normal',
      auth_relation_id: 'rel-1', auth_relation_generation: '1',
    });
    await ledger.call('applyPullPage', {
      events: [{ seq: '5', event_type: 'share.granted', share_id: 'share-1', generation: '1', payload: proj('1') }],
      cursor: 'c4', highWater: '5', epoch: 1,
    });
    let shared = (await ledger.call('listShared')) as Record<string, unknown>[];
    expect(shared).toHaveLength(1);
    // 撤销 gen1 → 重新授权 gen2 → 迟到的 gen1 purge。
    await ledger.call('applyPullPage', {
      events: [{ seq: '6', event_type: 'share.purged', share_id: 'share-1', generation: '1', payload: { share_id: 'share-1', generation: '1' } }],
      cursor: 'c5', highWater: '6', epoch: 1,
    });
    shared = (await ledger.call('listShared')) as Record<string, unknown>[];
    expect(shared).toHaveLength(0);
    await ledger.call('applyPullPage', {
      events: [{ seq: '7', event_type: 'share.granted', share_id: 'share-1', generation: '2', payload: proj('2') }],
      cursor: 'c6', highWater: '7', epoch: 1,
    });
    // 迟到 purge(gen1)不应清掉 gen2。
    await ledger.call('applyPullPage', {
      events: [{ seq: '8', event_type: 'share.purged', share_id: 'share-1', generation: '1', payload: { share_id: 'share-1', generation: '1' } }],
      cursor: 'c7', highWater: '8', epoch: 1,
    });
    shared = (await ledger.call('listShared')) as Record<string, unknown>[];
    expect(shared).toHaveLength(1);
    expect(shared[0].generation).toBe('2');
  });
});

describe('bootstrap 安装与迁移', () => {
  it('AC14: 全量重建后 pending 队列仍在并重放到工作视图', async () => {
    await openLedger();
    const created = (await ledger.call('createOrder', {
      sessionId: 'sess-1',
      payload: { appt_local: '2026-11-28T10:00', timezone: 'Asia/Shanghai', store: '重建保留店', price_cents: 7000, deposit_cents: 0 },
    })) as { id: string };
    await ledger.call('nextOutboxBatch', { limit: 10 }); // create → sending
    await ledger.call('updateOrder', { id: created.data.id, sessionId: 'sess-1', changes: { note: '重建期间的本地修改' } });

    const dto: OrderDTO = {
      id: 'srv-1', version: '3', store: '云端已有单', category: '其他', contact: '', note: '',
      price_cents: 111, deposit_cents: 0, appt_start: '2026-11-28T03:00:00Z', timezone: 'Asia/Shanghai',
      settle_via: 'private', channel: '直客', status: 'active',
      payments: [], created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z',
    };
    await ledger.call('installBootstrap', {
      pages: [{ orders: [dto] }],
      tail: {
        settings: { collect_threshold_days: 30, timezone: 'Asia/Shanghai' },
        shares: [], epoch: 1, high_water: '9', receipts: [],
      },
    });
    const orders = (await ledger.call('listOrders', {})) as Record<string, unknown>[];
    expect(orders.some((o) => o.id === 'srv-1')).toBe(true);
    const local = orders.find((o) => o.id === created.data.id) as Record<string, unknown> | undefined;
    expect(local?.note).toBe('重建期间的本地修改');
    expect(local?.dirty).toBe(1);
    const settings = (await ledger.call('settings')) as Record<string, unknown>;
    expect(settings.collect_threshold_days).toBe(30);
  });

  it('AC15: 同一旧备份导入两次不重复建单', async () => {
    await openLedger();
    const items = [{
      legacyId: 1, store: '旧店', category: '茶饮', contact: '', note: '',
      priceCents: 12800, depositCents: 3000, apptStartUTC: '2026-11-10T02:00:00Z',
      timezone: 'Asia/Shanghai', settleVia: 'private', channel: '直客', partnerName: '花花',
      shotAt: null, submittedAt: null, shortSentAt: null, longSentAt: null, remindAt: null,
      payments: [{ kind: 'deposit', amountCents: 3000, method: '微信', paidAtUTC: '2026-11-10T04:00:00Z' }],
    }];
    const r1 = (await ledger.call('importLegacy', { sourceDataset: 'backup-1', items, sessionId: 'sess-1' })) as { created: number; skipped: number };
    expect(r1.created).toBe(1);
    const r2 = (await ledger.call('importLegacy', { sourceDataset: 'backup-1', items, sessionId: 'sess-1' })) as { created: number; skipped: number };
    expect(r2.created).toBe(0);
    expect(r2.skipped).toBe(1);
    const orders = (await ledger.call('listOrders', { search: '旧店' })) as Record<string, unknown>[];
    expect(orders).toHaveLength(1);
    const pays = orders[0].payments as Record<string, unknown>[];
    expect(pays).toHaveLength(1); // 不重复入账
  });
});

describe('收款规则(本地)', () => {
  it('重复收款拒绝;有有效收款时改价拒绝;撤销后再记允许', async () => {
    await openLedger();
    const created = (await ledger.call('createOrder', {
      sessionId: 'sess-1',
      payload: { appt_local: '2026-11-29T10:00', timezone: 'Asia/Shanghai', store: '规则店', price_cents: 20000, deposit_cents: 5000 },
    })) as { data: { id: string } };
    const id = created.data.id;
    await ledger.call('recordPayment', { id, kind: 'deposit', method: '微信', paidAtLocal: 'now', sessionId: 'sess-1' });
    await expect(ledger.call('recordPayment', { id, kind: 'deposit', method: '微信', paidAtLocal: 'now', sessionId: 'sess-1' }))
      .rejects.toThrow('请勿重复收款');
    await expect(ledger.call('updateOrder', { id, sessionId: 'sess-1', changes: { price_cents: 30000 } }))
      .rejects.toThrow('不能修改总价');
    await ledger.call('reversePayment', { id, kind: 'deposit', sessionId: 'sess-1' });
    await ledger.call('recordPayment', { id, kind: 'deposit', method: '支付宝', paidAtLocal: 'now', sessionId: 'sess-1' });
    const orders = (await ledger.call('listOrders', { search: '规则店' })) as Record<string, unknown>[];
    const pays = orders[0].payments as Record<string, unknown>[];
    const kinds = pays.map((p) => p.entry_type);
    expect(kinds.filter((k) => k === 'receipt')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'reversal')).toHaveLength(1);
  });
});
