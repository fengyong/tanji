// 时间约定:API/存储一律 RFC3339 UTC 字符串;预约另存 IANA 时区(默认 Asia/Shanghai);
// 派生计算(今天/本月/逾期天数)按账本时区进行,不用本机时区偷换。

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

export function validRFC3339UTC(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(s)) return false;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return false;
  const y = Number(s.slice(0, 4));
  return y >= 1970 && y <= 2999;
}

export function nowRFC3339(): string {
  // 保留毫秒:同秒内多个操作需要稳定排序(outbox 链、bootstrap 重放)。
  return new Date().toISOString();
}

export function toRFC3339(t: Date): string {
  return t.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 旧版本无时区时间 "YYYY-MM-DDTHH:mm" 按 tz 解释转为 UTC RFC3339;迁移用,不能当 UTC。 */
export function parseLegacyLocalTime(s: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  // 通过 Intl 求该时区的 UTC 偏移(处理 DST 无关,中国无 DST;通用实现)。
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se ?? 0));
  const offset = tzOffsetMs(new Date(naive), tz);
  const utc = new Date(naive - offset);
  return toRFC3339(utc);
}

function tzOffsetMs(at: Date, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = dtf.formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return asUTC - at.getTime();
  } catch {
    return 0;
  }
}

export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---- 按账本时区的"今天" ----

export function zonedDateParts(at: Date, tz: string): { y: number; m: number; d: number; hh: number; mm: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const parts = dtf.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour') % 24, mm: get('minute') };
}

export function todayISO(tz: string, now = new Date()): string {
  const p = zonedDateParts(now, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** RFC3339 UTC → 账本时区的 "YYYY-MM-DDTHH:mm"(用于 <input> 与展示)。 */
export function toZonedLocalInput(rfc3339: string, tz: string): string {
  const t = new Date(rfc3339);
  if (Number.isNaN(t.getTime())) return '';
  const p = zonedDateParts(t, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}T${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

/** 账本时区的 "YYYY-MM-DDTHH:mm" → RFC3339 UTC(存储/传输形态)。 */
export function fromZonedLocalInput(local: string, tz: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const naive = Date.parse(local + ':00Z');
  if (Number.isNaN(naive)) return null;
  const offset = tzOffsetMs(new Date(naive), tz);
  const utc = new Date(naive - offset);
  return toRFC3339(utc);
}

export function daysBetween(fromISO: string, tz: string, now = new Date()): number {
  const f = zonedDateParts(new Date(fromISO), tz);
  const n = zonedDateParts(now, tz);
  const d1 = Date.UTC(f.y, f.m - 1, f.d);
  const d2 = Date.UTC(n.y, n.m - 1, n.d);
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}
