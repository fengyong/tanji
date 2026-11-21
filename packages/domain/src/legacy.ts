// 旧版本(v0.2–v0.4)备份 JSON 的解析与迁移预览。
// 旧数据来源:旧站点导出的 backupDocument {app,version,threshold,orders,payments};
// 跨域无法读取旧站点浏览器存储,统一走导出文件迁移(架构文档 §10.2)。

import { parseLegacyLocalTime, DEFAULT_TIMEZONE, toRFC3339 } from './time';
import type { PayKind } from './order';

export interface LegacyOrder {
  id: number;
  store: string;
  cat?: string;
  contact?: string;
  price: number; // 元(浮点)
  deposit: number;
  appt: string;
  settleVia?: 'private' | 'douyin';
  channel?: string;
  partner?: string;
  note?: string;
  shotAt?: string | null;
  submittedAt?: string | null;
  shortAt?: string | null;
  longAt?: string | null;
  depositPaidAt?: string | null;
  finalPaidAt?: string | null;
  remindAt?: string | null;
}

export interface LegacyPayment {
  oid: number;
  kind: '定金' | '尾款';
  amount: number;
  at: string;
  method: string;
  note?: string;
}

export interface LegacyBackup {
  app?: string;
  version?: string;
  threshold?: number;
  orders: LegacyOrder[];
  payments: LegacyPayment[];
}

export interface MigrationIssue {
  level: 'error' | 'warn';
  message: string;
}

export interface MigrationPreview {
  orders: number;
  payments: number;
  receivedTotalCents: number;
  threshold: number;
  timezone: string;
  issues: MigrationIssue[];
  /** 每单的迁移摘要(预览界面展示) */
  perOrder: { id: number; store: string; priceCents: number; depositCents: number; receipts: number }[];
}

export function parseLegacyBackup(text: string): LegacyBackup {
  const stripped = text.replace(/^\uFEFF/, '');
  const raw = JSON.parse(stripped) as LegacyBackup;
  if (!raw || !Array.isArray(raw.orders) || !Array.isArray(raw.payments)) {
    throw new Error('备份必须包含订单与收款流水数组');
  }
  if (raw.version && !['0.2', '0.3', '0.4'].includes(raw.version)) {
    throw new Error('暂不支持这个备份版本');
  }
  return raw;
}

/**
 * 迁移预览:金额按分转换(仅容忍能明确舍入到两位小数的旧浮点),
 * 旧时间按所选时区解释(不当作 UTC),旧搭档一律视为外部搭档。
 */
export function previewLegacyBackup(
  backup: LegacyBackup,
  tz = DEFAULT_TIMEZONE,
): MigrationPreview {
  const issues: MigrationIssue[] = [];
  const perOrder: MigrationPreview['perOrder'] = [];
  let receivedTotal = 0;
  const seenIDs = new Set<number>();

  for (const o of backup.orders) {
    const label = `订单「${o.store}」(ID ${o.id})`;
    if (!Number.isSafeInteger(o.id) || o.id < 1 || seenIDs.has(o.id)) {
      issues.push({ level: 'error', message: `${label}: ID 无效或重复` });
      continue;
    }
    seenIDs.add(o.id);
    const priceCents = toCents(o.price, label + ' 总价', issues);
    const depositCents = toCents(o.deposit, label + ' 定金', issues);
    if (priceCents !== null && depositCents !== null && depositCents > priceCents) {
      issues.push({ level: 'error', message: `${label}: 定金超过总价` });
    }
    if (!parseLegacyLocalTime(o.appt, tz)) {
      issues.push({ level: 'error', message: `${label}: 预约时间无效` });
    }
    const receipts = backup.payments.filter((p) => p.oid === o.id);
    for (const p of receipts) {
      const c = toCents(p.amount, `${label} 的${p.kind}流水`, issues);
      if (c !== null) receivedTotal += c;
      if (!['定金', '尾款'].includes(p.kind)) {
        issues.push({ level: 'error', message: `${label}: 流水类型 ${p.kind} 无效` });
      }
    }
    // 旧数据一致性:depositPaidAt/finalPaidAt 与流水必须一致(不静默补账)。
    for (const [kind, field] of [['定金', 'depositPaidAt'], ['尾款', 'finalPaidAt']] as const) {
      const entries = receipts.filter((p) => p.kind === kind);
      const marked = (o as unknown as Record<string, string | null>)[field];
      if (entries.length > 1 || (entries.length > 0 && !marked) || (entries.length === 0 && marked)) {
        issues.push({
          level: 'warn',
          message: `${label}: ${kind}已收标记与流水不一致,请先在旧版本核对`,
        });
      }
    }
    perOrder.push({
      id: o.id, store: o.store,
      priceCents: priceCents ?? 0, depositCents: depositCents ?? 0,
      receipts: receipts.length,
    });
  }
  const orphan = backup.payments.filter((p) => !seenIDs.has(p.oid));
  for (const p of orphan) {
    issues.push({ level: 'error', message: `流水找不到订单 ${p.oid}` });
  }
  const threshold = backup.threshold ?? 15;
  if (![7, 15, 30, 45].includes(threshold)) {
    issues.push({ level: 'warn', message: `催收阈值 ${threshold} 天不在 7/15/30/45 中,将重置为 15` });
  }
  return {
    orders: backup.orders.length,
    payments: backup.payments.length,
    receivedTotalCents: receivedTotal,
    threshold: [7, 15, 30, 45].includes(threshold) ? threshold : 15,
    timezone: tz,
    issues,
    perOrder,
  };
}

function toCents(v: number, label: string, issues: MigrationIssue[]): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    issues.push({ level: 'error', message: `${label}: 金额无效` });
    return null;
  }
  const rounded = Math.round(v * 100);
  if (Math.abs(v * 100 - rounded) > 0.00001) {
    issues.push({ level: 'error', message: `${label}: 金额超过两位小数,无法安全转换` });
    return null;
  }
  return rounded;
}

/** 迁移结果的规范化中间形态(local-db 负责落库)。 */
export interface MigratedOrder {
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
  payments: { kind: PayKind; amountCents: number; method: string; paidAtUTC: string }[];
}

export function migrateLegacyBackup(
  backup: LegacyBackup,
  tz = DEFAULT_TIMEZONE,
  warnings: string[] = [],
): MigratedOrder[] {
  const out: MigratedOrder[] = [];
  const tzToUse = tz || DEFAULT_TIMEZONE;
  for (const o of backup.orders) {
    const conv = (s?: string | null): string | null => {
      if (!s) return null;
      const utc = parseLegacyLocalTime(s, tzToUse);
      if (!utc) {
        warnings.push(`订单「${o.store}」时间 ${s} 无法按 ${tzToUse} 解释,已置空`);
        return null;
      }
      return utc;
    };
    out.push({
      legacyId: o.id,
      store: String(o.store ?? '').trim(),
      category: o.cat && o.cat.trim() ? o.cat : '其他',
      contact: String(o.contact ?? ''),
      note: String(o.note ?? ''),
      priceCents: Math.round((Number(o.price) || 0) * 100),
      depositCents: Math.round((Number(o.deposit) || 0) * 100),
      apptStartUTC: conv(o.appt) ?? toRFC3339(new Date('2026-01-01T00:00:00Z')),
      timezone: tzToUse,
      settleVia: o.settleVia === 'douyin' ? 'douyin' : 'private',
      channel: o.channel && o.channel.trim() ? o.channel : '直客',
      partnerName: String(o.partner ?? ''),
      shotAt: conv(o.shotAt),
      submittedAt: conv(o.submittedAt),
      shortSentAt: conv(o.shortAt),
      longSentAt: conv(o.longAt),
      remindAt: conv(o.remindAt),
      payments: backup.payments
        .filter((p) => p.oid === o.id)
        .map((p) => ({
          kind: (p.kind === '尾款' ? 'final' : 'deposit') as PayKind,
          amountCents: Math.round(p.amount * 100),
          method: p.method,
          paidAtUTC: parseLegacyLocalTime(p.at, tzToUse) ?? toRFC3339(new Date('2026-01-01T00:00:00Z')),
        })),
    });
  }
  return out;
}
