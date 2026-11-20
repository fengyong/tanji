/* 探记 TanJi · Service Worker:App 外壳缓存,离线可用 */
const VERSION='tanji-v0.3.1';
const ASSETS=[
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './vendor/sqlite3.mjs',
  './vendor/sqlite3.wasm',
];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(
    caches.match(e.request,{ignoreSearch:true}).then(hit=>{
      if(hit)return hit;
      return fetch(e.request).then(res=>{
        if(res.ok&&new URL(e.request.url).origin===location.origin){
          const copy=res.clone();
          caches.open(VERSION).then(c=>c.put(e.request,copy));
        }
        return res;
      }).catch(()=>caches.match('./index.html'));
    })
  );
});
