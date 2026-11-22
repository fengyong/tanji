// 构建后生成 dist/sw.js:精确白名单预缓存(架构文档 §10.1)。
// 绝不缓存 /v1/*、/health、/events、认证接口;HTML network-first(升级设备必得新版),静态资源 cache-first。
import fs from 'node:fs';
import path from 'node:path';

const dist = new URL('../dist', import.meta.url).pathname;

function listFiles(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const all = listFiles(dist);
const PRECACHE = all.filter((f) => {
  if (f.startsWith('vendor/sqlite3')) return true;           // WASM 引擎必须离线可用
  if (f.startsWith('assets/')) return true;                  // 哈希产物
  if (/^icon-|^apple-touch-icon|manifest\.webmanifest$/.test(f)) return true;
  return false;
});

const sw = `// 探记云端版 Service Worker(自动生成于构建;勿手改)
// 白名单预缓存;认证/同步接口绝不进 Cache API(PRD §10.1)。
const VERSION = '${new Date().toISOString().slice(0, 19)}';
const PRECACHE = ${JSON.stringify(PRECACHE, null, 2)};
const NEVER = /\\/(v1|health|events)(\\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open('tanji-shell-' + VERSION);
    await Promise.allSettled(PRECACHE.map((f) => cache.add(new Request(f, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('tanji-shell-') && key !== 'tanji-shell-' + VERSION) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (NEVER.test(url.pathname)) return; // 认证/同步/SSE:绝不缓存
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open('tanji-shell-' + VERSION);
    // HTML:network-first(升级设备必得新版;断网才回退缓存)
    if (url.pathname === '/' || url.pathname.endsWith('.html')) {
      try {
        const fresh = await fetch(event.request);
        if (fresh.ok) cache.put(event.request, fresh.clone());
        return fresh;
      } catch {
        const cached = await cache.match('/') || await cache.match(event.request);
        return cached || new Response('离线且无缓存', { status: 503 });
      }
    }
    // 静态资源:cache-first。缓存键 = 完整 URL(含 query):
    // sqlite3 opfs 代理 worker 依赖 ?vfs=opfs 参数,绝不能归一化掉 query。
    const cached = await cache.match(event.request, { ignoreSearch: false });
    if (cached) return cached;
    try {
      const fresh = await fetch(event.request);
      if (fresh.ok && (PRECACHE.includes(url.pathname.slice(1)) || url.pathname.startsWith('/assets/'))) {
        cache.put(event.request, fresh.clone());
      }
      return fresh;
    } catch {
      return new Response('离线且无缓存', { status: 503 });
    }
  })());
});
`;

fs.writeFileSync(path.join(dist, 'sw.js'), sw);
console.log(`sw.js 生成: 预缓存 ${PRECACHE.length} 个文件`);
