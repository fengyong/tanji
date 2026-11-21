import { describe, it, expect } from 'vitest';
import { parseYuanToCents, formatCents, parseVersion, formatVersion } from './money';
import { parseLegacyLocalTime, toZonedLocalInput, fromZonedLocalInput, todayISO, daysBetween } from './time';
import { workStage, payStage, dueCents, dayBadge, overdueDays } from './order';
import { parseLegacyBackup, previewLegacyBackup, migrateLegacyBackup } from './legacy';
import { grantSetID } from './uuid';

describe('money', () => {
  it('解析两位小数金额为分', () => {
    expect(parseYuanToCents('128')).toBe(12800);
    expect(parseYuanToCents('12.5')).toBe(1250);
    expect(parseYuanToCents('12.34')).toBe(1234);
    expect(parseYuanToCents('', true)).toBe(0);
    expect(parseYuanToCents('12.345')).toBeNull();
    expect(parseYuanToCents('-5')).toBeNull();
    expect(parseYuanToCents('abc')).toBeNull();
  });
  it('格式化分到元', () => {
    expect(formatCents(12800)).toBe('128.00');
    expect(formatCents(1250)).toBe('12.50');
  });
  it('版本号一律字符串', () => {
    expect(formatVersion(12)).toBe('12');
    expect(parseVersion('12')).toBe(12);
    expect(parseVersion('009')).toBe(9);
    expect(parseVersion('-1')).toBeNull();
    expect(parseVersion('1e3')).toBeNull();
    expect(parseVersion('999999999999999999999')).toBeNull();
  });
});

describe('time', () => {
  it('旧本地时间按 Asia/Shanghai(+08:00)转 UTC', () => {
    expect(parseLegacyLocalTime('2026-11-22T10:00', 'Asia/Shanghai')).toBe('2026-11-22T02:00:00Z');
    expect(parseLegacyLocalTime('2026-11-22T10:00', 'UTC')).toBe('2026-11-22T10:00:00Z');
    expect(parseLegacyLocalTime('bad', 'Asia/Shanghai')).toBeNull();
  });
  it('UTC↔本地输入转换', () => {
    const iso = '2026-11-25T02:00:00Z';
    expect(toZonedLocalInput(iso, 'Asia/Shanghai')).toBe('2026-11-25T10:00');
    expect(fromZonedLocalInput('2026-11-25T10:00', 'Asia/Shanghai')).toBe('2026-11-25T02:00:00Z');
  });
  it('今天与逾期天数按账本时区', () => {
    const now = new Date('2026-11-22T16:00:00Z'); // 上海 23 日 0 点
    expect(todayISO('Asia/Shanghai', now)).toBe('2026-11-23');
    expect(todayISO('UTC', now)).toBe('2026-11-22');
    expect(daysBetween('2026-11-15T02:00:00Z', 'Asia/Shanghai', now)).toBe(8);
  });
});

describe('order rules', () => {
  const base = { price_cents: 10000, deposit_cents: 2000, settle_via: 'private' as const };
  it('工作线状态机', () => {
    expect(workStage({ shot_at: null, submitted_at: null, short_sent_at: null, long_sent_at: null })).toBe('待拍摄');
    expect(workStage({ shot_at: 'x', submitted_at: null, short_sent_at: null, long_sent_at: null })).toBe('后期中');
    expect(workStage({ shot_at: 'x', submitted_at: 'x', short_sent_at: 'x', long_sent_at: null })).toBe('发片中');
    expect(workStage({ shot_at: 'x', submitted_at: 'x', short_sent_at: 'x', long_sent_at: 'x' })).toBe('已交付');
  });
  it('收款线与待收金额', () => {
    expect(payStage(base, [])).toBe('待定金');
    expect(dueCents(base, [], 'deposit')).toBe(2000);
    expect(dueCents(base, [], 'final')).toBe(8000);
    const dep = [{ id: 'p1', order_id: 'o', kind: 'deposit' as const, entry_type: 'receipt' as const, amount_cents: 2000, method: '微信', paid_at: 'x' }];
    expect(payStage(base, dep)).toBe('待尾款');
    expect(payStage({ ...base, settle_via: 'douyin' }, dep)).toBe('平台结算');
    const fin = [...dep, { id: 'p2', order_id: 'o', kind: 'final' as const, entry_type: 'receipt' as const, amount_cents: 8000, method: '微信', paid_at: 'x' }];
    expect(payStage(base, fin)).toBe('已结清');
  });
  it('撤销后重新计入待收', () => {
    const entries = [
      { id: 'p1', order_id: 'o', kind: 'deposit' as const, entry_type: 'receipt' as const, amount_cents: 2000, method: '微信', paid_at: 'x' },
      { id: 'p2', order_id: 'o', kind: 'deposit' as const, entry_type: 'reversal' as const, amount_cents: 2000, method: '微信', paid_at: 'x', reverses_id: 'p1' },
    ];
    expect(dueCents(base, entries, 'deposit')).toBe(2000);
  });
  it('平台结算免催收', () => {
    const shot = { ...base, settle_via: 'private' as const, shot_at: '2026-11-01T02:00:00Z' as const };
    expect(overdueDays(shot, [], 'Asia/Shanghai', () => 20)).toBe(20);
    expect(overdueDays({ ...shot, settle_via: 'douyin' }, [], 'Asia/Shanghai', () => 20)).toBe(0);
  });
  it('单日勋章阈值', () => {
    expect(dayBadge(2, 300000)).toEqual({ e: '💎', t: '王牌日' });
    expect(dayBadge(5, 0)).toEqual({ e: '🔥', t: '爆单' });
    expect(dayBadge(3, 150000)).toEqual({ e: '💰', t: '千元日' });
    expect(dayBadge(1, 0)).toBeNull();
  });
});

describe('legacy migration', () => {
  const backup = {
    app: '探记 TanJi', version: '0.4', threshold: 15,
    orders: [
      { id: 1, store: '旧店', cat: '茶饮', contact: '', price: 128, deposit: 30, appt: '2026-11-10T10:00', settleVia: 'private', channel: '蜂向', partner: '花花', note: '', shotAt: '2026-11-10T11:00', depositPaidAt: '2026-11-10T12:00' },
      { id: 2, store: '另一家', price: 99.5, deposit: 0, appt: '2026-11-12T14:30' },
    ],
    payments: [
      { oid: 1, kind: '定金', amount: 30, at: '2026-11-10T12:00', method: '微信' },
    ],
  };
  it('解析与预览', () => {
    const parsed = parseLegacyBackup(JSON.stringify(backup));
    const preview = previewLegacyBackup(parsed, 'Asia/Shanghai');
    expect(preview.orders).toBe(2);
    expect(preview.payments).toBe(1);
    expect(preview.receivedTotalCents).toBe(3000);
    expect(preview.perOrder[0].priceCents).toBe(12800);
    const bad = { ...backup, orders: [{ ...backup.orders[0], price: 12.345 }] };
    expect(previewLegacyBackup(parseLegacyBackup(JSON.stringify(bad))).issues.some((i) => i.level === 'error')).toBe(true);
  });
  it('迁移:金额转分、时间按上海解释、搭档为外部', () => {
    const parsed = parseLegacyBackup(JSON.stringify(backup));
    const warnings: string[] = [];
    const [m1, m2] = migrateLegacyBackup(parsed, 'Asia/Shanghai', warnings);
    expect(m1.priceCents).toBe(12800);
    expect(m1.depositCents).toBe(3000);
    expect(m1.apptStartUTC).toBe('2026-11-10T02:00:00Z');
    expect(m1.partnerName).toBe('花花');
    expect(m1.payments).toEqual([
      { kind: 'deposit', amountCents: 3000, method: '微信', paidAtUTC: '2026-11-10T04:00:00Z' },
    ]);
    expect(m2.priceCents).toBe(9950);
    expect(warnings).toEqual([]);
  });
});

describe('grant set id', () => {
  it('与后端 UUIDv5(NAMESPACE_URL) 完全一致', async () => {
    const id = await grantSetID(
      '3d02cc86-61c0-467e-80bb-f8b30f739da9',
      'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbb1',
      '8a14f207-6ee2-4dc0-bce0-7ddbbc9eb0e4',
    );
    // Go 参考实现 engine.grantSetID 输出:
    expect(id).toBe('f1e8b642-18e9-5f23-be06-dc0fb52eda80');
  });
});
