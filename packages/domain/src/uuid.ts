// UUID v4(随机)与 UUID v5(URL 命名空间,确定性派生)。
// v5 与后端 engine.grantSetID 一致:UUIDv5(NAMESPACE_URL, "tanji-grant:"+owner+":"+order+":"+recipient)。
const NAMESPACE_URL = new Uint8Array([
  0x6b, 0xa7, 0xb8, 0x11, 0x9d, 0xad, 0x11, 0xd1,
  0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8,
]);

export function uuidV4(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return formatUUID(b);
}

/** WebCrypto 是异步的;Worker 内使用。 */
export async function uuidV5URL(name: string): Promise<string> {
  const data = new Uint8Array(16 + name.length);
  data.set(NAMESPACE_URL, 0);
  data.set(new TextEncoder().encode(name), 16);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  const b = digest.slice(0, 16) as Uint8Array<ArrayBuffer>;
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  return formatUUID(b);
}

function formatUUID(b: Uint8Array): string {
  const hex = Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 授权聚合 ID:与后端一致的确定性三元组派生。 */
export function grantSetID(owner: string, orderID: string, recipient: string): Promise<string> {
  return uuidV5URL(`tanji-grant:${owner}:${orderID}:${recipient}`);
}
