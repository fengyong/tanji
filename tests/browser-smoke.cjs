const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.join(__dirname,'..','www');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tanji-browser-'));
const chrome=process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server=http.createServer((request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  const relative=pathname==='/'?'index.html':pathname.slice(1);
  if(!/^(index\.html|storage\.js|sw\.js|manifest\.webmanifest|privacy\.html|support\.html|icons\/[a-z0-9.-]+|vendor\/sqlite3\.(mjs|wasm))$/.test(relative)){response.writeHead(404);response.end();return}
  const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.png':'image/png','.webmanifest':'application/manifest+json'};
  response.setHeader('Content-Type',types[path.extname(relative)]||'application/octet-stream');
  response.setHeader('Cache-Control','no-cache');fs.createReadStream(path.join(root,relative)).pipe(response);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const processChrome=spawn(chrome,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:['ignore','ignore','pipe']});
  let socket;
  try{
    const endpoint=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error('Chrome startup timed out')),15000);
      processChrome.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1])}});
      processChrome.once('error',reject);processChrome.once('exit',code=>reject(new Error(`Chrome exited ${code}`)));
    });
    socket=new WebSocket(endpoint);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
    let counter=0;const pending=new Map(),errors=[];
    socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.id){const entry=pending.get(message.id);if(entry){pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(new Error(JSON.stringify(message.error))):entry.resolve(message.result)}}
      if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text+' '+JSON.stringify(message.params.exceptionDetails.exception));
      if(message.method==='Page.javascriptDialogOpening')send('Page.handleJavaScriptDialog',{accept:true},message.sessionId).catch(error=>errors.push(error.message));
    });
    const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
      const id=++counter,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timed out: ${method} ${params.expression||''}`))},20000);
      pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
    await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:profile});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const call=(method,params)=>send(method,params,sessionId);
    await call('Page.enable');await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    const evaluate=async expression=>{
      const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const screenshots={};
    const capture=async name=>{await call('Page.bringToFront');await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});screenshots[name]=path.join(profile,name+'.png');fs.writeFileSync(screenshots[name],Buffer.from(image.data,'base64'))};
    const ready=()=>evaluate('new Promise(resolve=>{const check=()=>typeof Store!=="undefined"&&Store.ready?resolve(true):setTimeout(check,25);check()})');
    const click=async selector=>{
      await evaluate('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');
      const position=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error("Missing element");el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(!el.contains(hit))throw new Error('Click intercepted: '+${JSON.stringify(selector)}+' by '+hit?.outerHTML);return {x,y}})()`);
      await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...position});
      await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...position});
    };
    const fill=async(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await call('Page.navigate',{url:origin});await ready();
    assert.equal(await evaluate('db.orders.length'),17);
    await evaluate('new Promise(resolve=>{const check=()=>Store.sqlite3?resolve():setTimeout(check,25);check()})');
    assert.equal(await evaluate('new TextDecoder().decode(buildSqliteBytes().slice(0,15))'),'SQLite format 3');
    const secondary=await send('Target.createTarget',{url:'about:blank'}),attached=await send('Target.attachToTarget',{targetId:secondary.targetId,flatten:true});
    await send('Page.navigate',{url:origin},attached.sessionId);
    const readonly=await send('Runtime.evaluate',{expression:'new Promise(resolve=>{const check=()=>typeof Store!=="undefined"&&Store.ready?resolve({blocked:Store.blocked,count:db.orders.length}):setTimeout(check,25);check()})',awaitPromise:true,returnByValue:true},attached.sessionId);
    assert.deepEqual(readonly.result.value,{blocked:true,count:17});await send('Target.closeTarget',{targetId:secondary.targetId});
    await capture('home-mobile');
    await click('.tab[data-tab="stats"]');
    await click('[data-act="switch-mode"]');
    await evaluate('new Promise(resolve=>{const check=()=>Store.busy?setTimeout(check,25):resolve();check()})');
    assert.equal(await evaluate('Store.mode'),'work');assert.equal(await evaluate('db.orders.length'),0);
    await click('.tab[data-tab="stats"]');await click('#v-stats [data-act="export-json"]');
    await click('.tab[data-tab="home"]');await click('#v-home [data-act="new-order"]');
    await fill('#f-store','安全 <b>咖啡</b>');await fill('#f-price','1000');await fill('#f-deposit','200');
    await fill('#f-date','2026-11-22');await click('[data-act="save-order"]');
    assert.equal(await evaluate('db.orders.length'),1);
    assert.equal(await evaluate('document.querySelector("#v-trip .rname").textContent'),'安全 <b>咖啡</b>');
    assert.equal(await evaluate('document.querySelector("#v-trip .rname b")'),null);
    await evaluate('Store.queue');await call('Page.reload');await ready();
    assert.equal(await evaluate('db.orders[0].store'),'安全 <b>咖啡</b>');
    await click('.tab[data-tab="orders"]');await click('#v-orders [data-act="open"]');
    await click('#detail-body [data-kind="deposit"]');await click('[data-act="confirm-pay"]');
    assert.equal(await evaluate('db.payments.length'),1);assert.equal(await evaluate('statsFor("M").paidSum'),200);
    await click('#detail-body [data-act="edit-order"]');await fill('#e-price','1200');await click('[data-act="save-edit"]');
    assert.equal(await evaluate('db.orders[0].price'),1000);
    await click('#sheet-edit [data-act="close-sheet"]');
    await click('.tab[data-tab="trip"]');await evaluate('ui.selDay="2026-11-22";ui.vMon={y:2026,m:11};renderTrip()');await click('#v-trip [data-act="share"]');
    await evaluate('new Promise(resolve=>{const check=()=>ui.shareBlob?resolve():setTimeout(check,25);check()})');
    assert.equal(await evaluate('ui.shareDay'),'2026-11-22');
    await evaluate('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');await capture('share-mobile');
    await click('#sheet-share [data-act="close-sheet"]');await click('.tab[data-tab="stats"]');
    const importPath=path.join(profile,'roundtrip.json');fs.writeFileSync(importPath,await evaluate('JSON.stringify(backupDocument())'));
    await call('DOM.enable');const {root:documentRoot}=await call('DOM.getDocument');const input=await call('DOM.querySelector',{nodeId:documentRoot.nodeId,selector:'#import-file'});
    await call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[importPath]});
    await evaluate('new Promise(resolve=>{const check=()=>Store.pending?resolve():setTimeout(check,25);check()})');
    assert.match(await evaluate('document.querySelector("#import-summary").textContent'),/1 笔订单/);
    await evaluate('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');await capture('import-mobile');
    await click('[data-act="confirm-import"]');await evaluate('new Promise(resolve=>{const check=()=>Store.busy?setTimeout(check,25):resolve();check()})');
    assert.equal(await evaluate('db.payments.length'),1);
    await evaluate('previewImport(new File(["{bad"],"bad.json"))');assert.equal(await evaluate('Store.pending'),null);assert.equal(await evaluate('db.orders.length'),1);
    await click('#v-stats [data-act="clear-data"]');await evaluate('new Promise(resolve=>{const check=()=>Store.busy?setTimeout(check,25):resolve();check()})');
    await call('Page.reload');await ready();assert.equal(await evaluate('db.orders.length'),0);
    await click('.tab[data-tab="stats"]');await capture('stats-mobile');
    // 付费漏斗:必须有 iOS 原生版入口(未上架显示「即将上架」,上架后是可点的 App Store 链接)
    const iosRow=await evaluate(`(()=>{const r=[...document.querySelectorAll('#v-stats .menu-row')].find(x=>(x.querySelector('.menu-name')?.textContent||'').includes('iOS 原生版'));if(!r)return null;return {isLink:r.tagName==='A',href:r.getAttribute('href')||'',badge:r.querySelector('.tag-badge')?.textContent||''}})()`);
    assert.ok(iosRow,'统计页缺少 iOS 原生版入口(免费体验 → 付费版的转化入口)');
    assert.ok(iosRow.isLink?/^https:\/\/apps\.apple\.com\//.test(iosRow.href):iosRow.badge==='即将上架','iOS 原生版入口状态异常: '+JSON.stringify(iosRow));
    await click('#v-stats [data-act="restore-backup"]');await evaluate('new Promise(resolve=>{const check=()=>Store.busy?setTimeout(check,25):resolve();check()})');
    assert.equal(await evaluate('db.orders.length'),1);assert.equal(await evaluate('db.payments.length'),1);
    await evaluate('navigator.serviceWorker.ready');await evaluate('Store.queue');
    await call('Network.enable');await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await call('Page.reload');await ready();assert.equal(await evaluate('db.orders.length'),1);assert.equal(await evaluate('db.payments[0].amount'),200);
    await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await capture('home-desktop');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,viewports:['390x844','1280x900'],screenshots,checks:['SQLite generation','single-writer lock','demo/work isolation','create + reload','HTML escaping','payment + statistics','financial edit protection','selected-date sharing','JSON file input + restore','corrupt import rejection','clear + empty reload','checkpoint recovery','offline reload'],consoleErrors:errors},null,2));
    await send('Browser.close');
  }finally{
    if(socket)socket.close();
    server.close();
    if(processChrome.exitCode===null)processChrome.kill('SIGTERM');
  }
})().catch(error=>{console.error(error);process.exitCode=1;server.close()});
