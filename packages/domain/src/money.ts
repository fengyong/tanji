// 金额:一律非负整数分;JSON 数字必须落在 JavaScript 安全整数范围。
export const MAX_AMOUNT_CENTS = 9_000_000_000;

export function validAmountCents(c: number): boolean {
  return Number.isSafeInteger(c) && c >= 0 && c <= MAX_AMOUNT_CENTS;
}

/** "128"、"12.5"、"12.34" → 分;非法返回 null。blankZero 时空串视为 0。 */
export function parseYuanToCents(text: string, blankZero = false): number | null {
  const t = text.trim();
  if (!t) return blankZero ? 0 : null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return validAmountCents(cents) ? cents : null;
}

export function formatCents(c: number): string {
  if (!Number.isSafeInteger(c) || c < 0) return '';
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

export function formatMoney(c: number): string {
  return `¥${formatCents(c)}`;
}

// ---- 版本与序号:线路上一律十进制字符串,避免 JS 精度损失 ----

export function formatVersion(v: number): string {
  if (!Number.isSafeInteger(v) || v < 0) throw new Error(`非法版本号 ${v}`);
  return String(v);
}

export function parseVersion(s: string): number | null {
  if (!/^\d{1,15}$/.test(s)) return null;
  const v = Number(s);
  return Number.isSafeInteger(v) && v >= 0 ? v : null;
}
