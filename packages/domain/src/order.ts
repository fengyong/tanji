// 订单/收款的派生规则:与旧版 index.html 语义一致,金额单位为分。

export type SettleVia = 'private' | 'douyin';
export type OrderStatus = 'active' | 'cancelled' | 'archived' | 'deleted';
export type PayKind = 'deposit' | 'final';
export type EntryType = 'receipt' | 'reversal';

export const RECEIPT_METHODS = ['微信', '支付宝', '银行卡', '抖音商单', '其他'] as const;
export type ReceiptMethod = (typeof RECEIPT_METHODS)[number];

export const CATEGORIES = [
  '咖啡', '餐饮', '烧烤', '火锅', '茶饮', '甜品', '烘焙', '美发', '健身',
  '民宿', '零售', '体验馆', '服饰', '快餐', '其他',
] as const;

export interface PaymentEntry {
  id: string;
  order_id: string;
  kind: PayKind;
  entry_type: EntryType;
  amount_cents: number;
  method: string;
  paid_at: string;
  reverses_id?: string;
}

export interface PlaceInfo {
  address: string;
  latitude?: string;
  longitude?: string;
  coord_system?: 'GCJ-02' | 'WGS-84' | string;
  provider?: string;
  poi_id?: string;
}

export interface PartnerRef {
  type: 'account' | 'external';
  user_id?: string;
  external_name?: string;
}

export interface OrderDTO {
  id: string;
  version: string;
  store: string;
  category: string;
  contact: string;
  note: string;
  price_cents: number;
  deposit_cents: number;
  appt_start: string;
  appt_end?: string | null;
  timezone: string;
  settle_via: SettleVia;
  channel: string;
  shot_at?: string | null;
  submitted_at?: string | null;
  short_sent_at?: string | null;
  long_sent_at?: string | null;
  remind_at?: string | null;
  status: OrderStatus;
  place?: PlaceInfo | null;
  partner?: PartnerRef | null;
  payments: PaymentEntry[];
  active_receipts?: Record<string, string>;
  created_at: string;
  updated_at: string;
}

/** 工作线:待拍摄 → 后期中 → 发片中 → 已交付。 */
export function workStage(o: Pick<OrderDTO, 'shot_at' | 'submitted_at' | 'short_sent_at' | 'long_sent_at'>): string {
  if (!o.shot_at) return '待拍摄';
  if (!o.submitted_at) return '后期中';
  if (o.short_sent_at && o.long_sent_at) return '已交付';
  return '发片中';
}

export function hasActiveReceipt(entries: PaymentEntry[], kind: PayKind): boolean {
  const active = new Map<string, PaymentEntry>();
  for (const p of entries) {
    if (p.entry_type === 'receipt') active.set(p.id, p);
    else if (p.reverses_id) active.delete(p.reverses_id);
  }
  return [...active.values()].some((p) => p.kind === kind);
}

export function activeReceiptOf(entries: PaymentEntry[], kind: PayKind): PaymentEntry | null {
  const active = new Map<string, PaymentEntry>();
  for (const p of entries) {
    if (p.entry_type === 'receipt') active.set(p.id, p);
    else if (p.reverses_id) active.delete(p.reverses_id);
  }
  for (const p of active.values()) if (p.kind === kind) return p;
  return null;
}

export function receivedTotalCents(entries: PaymentEntry[]): number {
  return entries
    .filter((p) => p.entry_type === 'receipt' && !p.reverses_id)
    .reduce((s, p) => s + p.amount_cents, 0);
}

/** 待收金额:deposit=定金余额;final=尾款余额(按有效收款计)。 */
export function dueCents(o: Pick<OrderDTO, 'price_cents' | 'deposit_cents'>, entries: PaymentEntry[], kind: PayKind): number {
  const total = kind === 'deposit' ? o.deposit_cents : o.price_cents - o.deposit_cents;
  return hasActiveReceipt(entries, kind) ? 0 : total;
}

/** 收款线:待定金 / 待尾款 / 平台结算 / 已结清。 */
export function payStage(o: Pick<OrderDTO, 'price_cents' | 'deposit_cents' | 'settle_via'>, entries: PaymentEntry[]): string {
  const finalDue = dueCents(o, entries, 'final');
  if (dueCents(o, entries, 'deposit') > 0) return '待定金';
  if (finalDue <= 0) return '已结清';
  if (o.settle_via === 'douyin') return '平台结算';
  return '待尾款';
}

export function isCollectExempt(o: Pick<OrderDTO, 'settle_via'>): boolean {
  return o.settle_via === 'douyin';
}

/** 尾款逾期天数:自实际拍摄日起,按账本时区;平台结算免催收。 */
export function overdueDays(
  o: Pick<OrderDTO, 'settle_via' | 'price_cents' | 'deposit_cents' | 'shot_at'>,
  entries: PaymentEntry[],
  tz: string,
  daysSince: (iso: string, tz: string) => number,
): number {
  if (isCollectExempt(o) || hasActiveReceipt(entries, 'final') || !o.shot_at) return 0;
  if (o.price_cents - o.deposit_cents <= 0) return 0;
  return daysSince(o.shot_at, tz);
}

/** 单日勋章:💎≥2500 > 🔥≥5 > 💰≥1000 > ⭐≥3(阈值按真实峰值校准)。 */
export function dayBadge(n: number, sumCents: number): { e: string; t: string } | null {
  if (sumCents >= 250000) return { e: '💎', t: '王牌日' };
  if (n >= 5) return { e: '🔥', t: '爆单' };
  if (sumCents >= 100000) return { e: '💰', t: '千元日' };
  if (n >= 3) return { e: '⭐', t: '忙碌日' };
  return null;
}

/** 时段冲突:同日 ±120 分钟提醒(不禁止,达人可找人代拍)。 */
export function conflictFor(
  orders: { appt_start: string; store: string }[],
  apptStartUTC: string,
  tz: string,
  toLocalInput: (iso: string, tz: string) => string,
  excludeId?: string,
): string {
  if (!apptStartUTC) return '';
  const day = toLocalInput(apptStartUTC, tz).slice(0, 10);
  const same = orders.filter((o) => o.appt_start !== apptStartUTC && toLocalInput(o.appt_start, tz).slice(0, 10) === day);
  if (!same.length) return '';
  const t = minutesOf(apptStartUTC, tz, toLocalInput);
  const overlap = same.filter((o) => Math.abs(minutesOf(o.appt_start, tz, toLocalInput) - t) <= 120);
  const label = (o: { appt_start: string; store: string }) =>
    `「${o.store}」${toLocalInput(o.appt_start, tz).slice(11, 16)}`;
  if (overlap.length) {
    return `<b>该时段已有排期:</b>${overlap.map(label).join('、')}。不影响保存——可找人代拍或错峰。`;
  }
  return `当天已有 ${same.length} 个排期:${same.map(label).join('、')}`;
}

function minutesOf(iso: string, tz: string, toLocalInput: (iso: string, tz: string) => string): number {
  const local = toLocalInput(iso, tz);
  return Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
}
