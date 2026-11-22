const VERSION='tanji-v0.5.0';
const ASSETS=['./','./index.html','./app.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png','./vendor/sqlite3.mjs','./vendor/sqlite3.wasm','./privacy.html','./support.html'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('tanji-')&&key!==VERSION).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  const fresh=event.request.mode==='navigate'||url.pathname.endsWith('.html')||url.pathname.endsWith('/storage.js');
  event.respondWith((async()=>{
    const cache=await caches.open(VERSION);
    const cached=await cache.match(event.request,{ignoreSearch:true});
    if(!fresh&&cached)return cached;
    try{
      const response=await fetch(event.request);
      if(response.ok)await cache.put(event.request,response.clone());
      if(response.status>=500&&cached)return cached;
      return response;
    }catch(error){
      if(cached)return cached;
      if(event.request.mode==='navigate'){
        const shell=await cache.match('./index.html');
        if(shell)return shell;
      }
      throw error;
    }
  })());
});
