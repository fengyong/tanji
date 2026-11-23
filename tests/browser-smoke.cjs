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
  if(!/^(index\.html|imaging\.js|logic\.js|geo\.js|app\.js|sw\.js|manifest\.webmanifest|privacy\.html|support\.html|icons\/[a-z0-9.-]+|vendor\/sqlite3\.(mjs|wasm))$/.test(relative)){response.writeHead(404);response.end();return}
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
    const ready=()=>evaluate('new Promise(resolve=>{const check=()=>!!window.__TANJI__&&__TANJI__.Store.ready?resolve(true):setTimeout(check,25);check()})');
    const click=async selector=>{
      await evaluate('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');
      const position=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error("Missing element");el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(!el.contains(hit))throw new Error('Click intercepted: '+${JSON.stringify(selector)}+' by '+hit?.outerHTML);return {x,y}})()`);
      await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...position});
      await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...position});
    };
    const fill=async(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await call('Page.navigate',{url:origin});await ready();
    assert.equal(await evaluate('__TANJI__.db.orders.length'),17);
    await evaluate('new Promise(resolve=>{const check=()=>__TANJI__.Store.sqlite3?resolve():setTimeout(check,25);check()})');
    assert.equal(await evaluate('new TextDecoder().decode(__TANJI__.buildSqliteBytes().slice(0,15))'),'SQLite format 3');
    const secondary=await send('Target.createTarget',{url:'about:blank'}),attached=await send('Target.attachToTarget',{targetId:secondary.targetId,flatten:true});
    await send('Page.navigate',{url:origin},attached.sessionId);
    const readonly=await send('Runtime.evaluate',{expression:'new Promise(resolve=>{const check=()=>!!window.__TANJI__&&__TANJI__.Store.ready?resolve({blocked:__TANJI__.Store.blocked,count:__TANJI__.db.orders.length}):setTimeout(check,25);check()})',awaitPromise:true,returnByValue:true},attached.sessionId);
    assert.deepEqual(readonly.result.value,{blocked:true,count:17});await send('Target.closeTarget',{targetId:secondary.targetId});
    await capture('home-mobile');
    await click('.tab[data-tab="stats"]');
    await click('[data-act="switch-mode"]');
    await evaluate('new Promise(resolve=>{const check=()=>__TANJI__.Store.busy?setTimeout(check,25):resolve();check()})');
    assert.equal(await evaluate('__TANJI__.Store.mode'),'work');assert.equal(await evaluate('__TANJI__.db.orders.length'),0);
    await click('.tab[data-tab="stats"]');await click('#v-stats [data-act="export-json"]');
    await click('.tab[data-tab="home"]');await click('#v-home [data-act="new-order"]');
    await evaluate('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');
    // 保存按钮必须常驻:内容滚到顶部时也得在视口内,且不能躺在滚动区里
    const saveBar=await evaluate(`(()=>{const body=document.querySelector('#sheet-new .sheet-body');body.scrollTop=0;const btn=document.querySelector('#sheet-new [data-act="save-order"]');if(!btn)return {found:false};const r=btn.getBoundingClientRect();return {found:true,top:r.top,bottom:r.bottom,viewport:innerHeight,inScrollArea:!!btn.closest('.sheet-body')}})()`);
    assert.ok(saveBar.found,'新建弹层缺少保存按钮');
    assert.equal(saveBar.inScrollArea,false,'保存按钮不该放在滚动区里(要滚到底才看得见)');
    assert.ok(saveBar.top>=0&&saveBar.bottom<=saveBar.viewport+1,'保存按钮不在首屏可见区域: '+JSON.stringify(saveBar));
    // geo.js 必须被真正加载:地图跳转与定位都挂在这个模块上
    assert.equal(await evaluate('TanJiGeo.mapUrl({query:"万象城 3 层"}).startsWith("https://maps.apple.com/")'),true);
    // 触摸手感:整页要像原生 App,双击不能缩放、拖动不能把文字刷蓝
    const touch=await evaluate(`(()=>{const html=getComputedStyle(document.documentElement),body=getComputedStyle(document.body);return {touchAction:html.touchAction,userSelect:body.userSelect||body.webkitUserSelect,viewport:document.querySelector('meta[name=viewport]').content}})()`);
    assert.equal(touch.touchAction,'manipulation','html 的 touch-action 必须是 manipulation,否则双击会缩放');
    assert.match(touch.userSelect,/none/,'body 必须禁止文字选中(否则滑动会刷蓝一片)');
    assert.match(touch.viewport,/user-scalable=no/,'viewport 必须禁用手势缩放');
    await fill('#f-store','安全 <b>咖啡</b>');await fill('#f-price','1000');await fill('#f-deposit','200');
    await fill('#f-date','2026-11-22');await click('[data-act="save-order"]');
    assert.equal(await evaluate('__TANJI__.db.orders.length'),1);
    assert.equal(await evaluate('document.querySelector("#v-trip .rname").textContent'),'安全 <b>咖啡</b>');
    assert.equal(await evaluate('document.querySelector("#v-trip .rname b")'),null);
    // 未来 7 天:含当天共 7 格横滑,点了能落到那天
    const week=await evaluate(`(()=>{const bar=document.querySelector('#v-trip .n7');if(!bar)return null;return {chips:bar.querySelectorAll('.n7d').length,title:/未来 7 天/.test(document.querySelector('#v-trip').textContent)}})()`);
    assert.deepEqual(week,{chips:7,title:true},'行程页应有未来 7 天横滑条');
    await evaluate('__TANJI__.Store.queue');await call('Page.reload');await ready();
    assert.equal(await evaluate('__TANJI__.db.orders[0].store'),'安全 <b>咖啡</b>');
    // 输入法合成期间不能重建搜索框:节点一换,合成被强制结束,拼音被逐段提交成字面量、候选词消失。
    // 合成中的 input 不触发重绘(节点不变、列表不动),compositionend 之后才按最终文本筛选
    await click('.tab[data-tab="orders"]');
    const ime=await evaluate(`(()=>{const el=document.querySelector('#q-input');el.focus();const fire=(type,data)=>el.dispatchEvent(new CompositionEvent(type,{bubbles:true,data}));fire('compositionstart','');el.value='zzz';el.dispatchEvent(new InputEvent('input',{bubbles:true,data:'zzz',isComposing:true}));const keptNode=document.querySelector('#q-input')===el,keptRows=document.querySelectorAll('#v-orders .row').length;fire('compositionend','安全');el.value='安全';el.dispatchEvent(new InputEvent('input',{bubbles:true,data:'安全',isComposing:false}));return {keptNode,keptRows,rows:document.querySelectorAll('#v-orders .row').length,q:__TANJI__.ui.q}})()`);
    assert.deepEqual(ime,{keptNode:true,keptRows:1,rows:1,q:'安全'}, '搜索框在输入法合成期间被重建,或合成结束后没有按最终文本筛选: '+JSON.stringify(ime));
    await click('#v-orders [data-act="open"]');
    await click('#detail-body [data-kind="deposit"]');await click('[data-act="confirm-pay"]');
    assert.equal(await evaluate('__TANJI__.db.payments.length'),1);assert.equal(await evaluate('__TANJI__.statsFor("M").paidSum'),200);
    // 「钱必须可逆」:收款 toast 必须带撤销,且真要能把流水与标记一起回滚
    assert.equal(await evaluate(`!!document.querySelector('#toast [data-act="toast-undo"]')`),true,'收款后应有撤销入口');
    await click('#toast [data-act="toast-undo"]');
    assert.equal(await evaluate('__TANJI__.db.payments.length'),0,'撤销后流水应移除');
    assert.equal(await evaluate('__TANJI__.db.orders[0].depositPaidAt'),null,'撤销后已收标记应回滚');
  await click('#detail-body [data-kind="deposit"]');await click('[data-act="confirm-pay"]');
  assert.equal(await evaluate('__TANJI__.db.payments.length'),1,'重新记一次,后续断言依赖这笔流水');
    // 收完定金转为"待尾款",催收跟进才出现:记一笔,详情页要立刻出现时间线
    await click('#detail-body [data-act="remind-open"]');
    assert.equal(await evaluate("document.querySelector('#sheet-remind').classList.contains('show')"),true,'再催一次应打开记录弹层');
    await click('[data-act="remind-quick"]');
    await fill('#remind-note','说这周给,15 号打款');
    await click('[data-act="remind-save"]');
    assert.equal(await evaluate('__TANJI__.db.orders[0].remindLog.length'),1);
    assert.match(await evaluate('document.querySelector("#detail-body").textContent'),/已催 1 次/);
    assert.match(await evaluate('document.querySelector("#detail-body").textContent'),/说这周给/);
    await click('#detail-body [data-act="edit-order"]');
    await evaluate('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');
    const editBar=await evaluate(`(()=>{const btn=document.querySelector('#sheet-edit [data-act="save-edit"]');if(!btn)return {found:false};const r=btn.getBoundingClientRect();return {found:true,top:r.top,bottom:r.bottom,viewport:innerHeight,inScrollArea:!!btn.closest('.sheet-body')}})()`);
    assert.ok(editBar.found&&!editBar.inScrollArea&&editBar.bottom<=editBar.viewport+1,'编辑弹层的保存按钮必须常驻可见: '+JSON.stringify(editBar));
    await fill('#e-price','1200');await click('[data-act="save-edit"]');
    assert.equal(await evaluate('__TANJI__.db.orders[0].price'),1000);
  await click('#sheet-edit [data-act="close-sheet"]');
  // P0 拆分安全网:新增订单 → 标记收款 → 导出 JSON 的全链路 —— 导出必须真的
  // 产出下载文件,且内容与页面状态一致(不是只点了按钮、toast 亮了一下)。
  // 此刻:工作模式、1 笔订单、1 笔定金收款、无弹层遮挡。
  await click('.tab[data-tab="stats"]');
  const beforeExport=Date.now();
  await click('#v-stats [data-act="export-json"]');
  const exported=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('export-json 没有产出下载文件')),10000);
    const check=()=>{
      const files=fs.readdirSync(profile)
        .filter(n=>n.startsWith('探记-工作备份-')&&n.endsWith('.json'))
        .map(n=>({n,t:fs.statSync(path.join(profile,n)).mtimeMs}))
        .filter(f=>f.t>=beforeExport);
      if(files.length){clearTimeout(timer);resolve(path.join(profile,files[files.length-1].n))}
      else setTimeout(check,100);
    };
    check();
  });
  // 文本导出带 UTF-8 BOM(download 有意为之),与 previewImport 同口径剥掉再解析
  const backup=JSON.parse(fs.readFileSync(exported,'utf8').replace(/^\uFEFF/,''));
  assert.equal(backup.app,'探记 TanJi','导出的 JSON 应是探记备份文档');
  assert.equal(backup.orders.length,1,'导出备份应含刚新建的 1 笔订单');
  assert.equal(backup.orders[0].store,'安全 <b>咖啡</b>','订单内容应与页面一致');
  assert.equal(backup.payments.length,1,'导出备份应含刚标记的 1 笔定金收款');
  assert.equal(backup.payments[0].amount,200,'收款金额应与页面一致');
  await click('.tab[data-tab="orders"]');
  // 下拉关闭:详情页往下拖 200px 应当退出(iOS 弹层的基本手势,不能只靠点上方空白)
    await click('#v-orders [data-act="open"]');
    await evaluate(`(()=>{const sheet=document.querySelector('#sheet-detail');const pt=y=>new Touch({identifier:1,target:sheet,clientX:200,clientY:y});const fire=(type,touches)=>sheet.dispatchEvent(new TouchEvent(type,{touches,bubbles:true,cancelable:true}));fire('touchstart',[pt(400)]);fire('touchmove',[pt(480)]);fire('touchmove',[pt(600)]);fire('touchend',[])})()`);
    assert.equal(await evaluate("document.querySelector('#sheet-detail').classList.contains('show')"),false,'下拉应该能关闭详情弹层');
    assert.equal(await evaluate('__TANJI__.ui.detail'),null,'关闭后 detail 状态应清空');
    assert.equal(await evaluate("document.body.style.overflow"),'',`下拉关闭后不应留下行内 transform/overflow 残渣`);
    await click('.tab[data-tab="trip"]');await evaluate('__TANJI__.ui.selDay="2026-11-22";__TANJI__.ui.vMon={y:2026,m:11};__TANJI__.renderTrip()');await click('#v-trip [data-act="share"]');
    await evaluate('new Promise(resolve=>{const check=()=>__TANJI__.ui.shareBlob?resolve():setTimeout(check,25);check()})');
    assert.equal(await evaluate('__TANJI__.ui.shareDay'),'2026-11-22');
    await evaluate('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');await capture('share-mobile');
    await click('#sheet-share [data-act="close-sheet"]');await click('.tab[data-tab="stats"]');
    const importPath=path.join(profile,'roundtrip.json');fs.writeFileSync(importPath,await evaluate('JSON.stringify(__TANJI__.backupDocument())'));
    await call('DOM.enable');const {root:documentRoot}=await call('DOM.getDocument');const input=await call('DOM.querySelector',{nodeId:documentRoot.nodeId,selector:'#import-file'});
    await call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[importPath]});
    await evaluate('new Promise(resolve=>{const check=()=>__TANJI__.Store.pending?resolve():setTimeout(check,25);check()})');
    assert.match(await evaluate('document.querySelector("#import-summary").textContent'),/1 笔订单/);
    await evaluate('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');await capture('import-mobile');
    await click('[data-act="confirm-import"]');await evaluate('new Promise(resolve=>{const check=()=>__TANJI__.Store.busy?setTimeout(check,25):resolve();check()})');
    assert.equal(await evaluate('__TANJI__.db.payments.length'),1);
    await evaluate('__TANJI__.previewImport(new File(["{bad"],"bad.json"))');assert.equal(await evaluate('__TANJI__.Store.pending'),null);assert.equal(await evaluate('__TANJI__.db.orders.length'),1);
    await click('#v-stats [data-act="clear-data"]');await evaluate('new Promise(resolve=>{const check=()=>__TANJI__.Store.busy?setTimeout(check,25):resolve();check()})');
    await call('Page.reload');await ready();assert.equal(await evaluate('__TANJI__.db.orders.length'),0);
    await click('.tab[data-tab="stats"]');await capture('stats-mobile');
    // 付费漏斗:必须有 iOS 原生版入口(未上架显示「即将上架」,上架后是可点的 App Store 链接)
    const iosRow=await evaluate(`(()=>{const r=[...document.querySelectorAll('#v-stats .menu-row')].find(x=>(x.querySelector('.menu-name')?.textContent||'').includes('iOS 原生版'));if(!r)return null;return {isLink:r.tagName==='A',href:r.getAttribute('href')||'',badge:r.querySelector('.tag-badge')?.textContent||''}})()`);
    assert.ok(iosRow,'统计页缺少 iOS 原生版入口(免费体验 → 付费版的转化入口)');
    assert.ok(iosRow.isLink?/^https:\/\/apps\.apple\.com\//.test(iosRow.href):iosRow.badge==='即将上架','iOS 原生版入口状态异常: '+JSON.stringify(iosRow));
    await click('#v-stats [data-act="restore-backup"]');await evaluate('new Promise(resolve=>{const check=()=>__TANJI__.Store.busy?setTimeout(check,25):resolve();check()})');
    assert.equal(await evaluate('__TANJI__.db.orders.length'),1);assert.equal(await evaluate('__TANJI__.db.payments.length'),1);
    await evaluate('navigator.serviceWorker.ready');await evaluate('__TANJI__.Store.queue');
    await call('Network.enable');await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await call('Page.reload');await ready();assert.equal(await evaluate('__TANJI__.db.orders.length'),1);assert.equal(await evaluate('__TANJI__.db.payments[0].amount'),200);
    await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await capture('home-desktop');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,viewports:['390x844','1280x900'],screenshots,checks:['SQLite generation','single-writer lock','demo/work isolation','create + reload','HTML escaping','save button always visible','geo module loaded','touch feel locked','sheet drag to dismiss','future 7 days bar','collection follow-up log','payment + statistics','payment undo','financial edit protection','selected-date sharing','JSON file input + restore','corrupt import rejection','clear + empty reload','checkpoint recovery','offline reload'],consoleErrors:errors},null,2));
    await send('Browser.close');
  }finally{
    if(socket)socket.close();
    server.close();
    if(processChrome.exitCode===null)processChrome.kill('SIGTERM');
  }
})().catch(error=>{console.error(error);process.exitCode=1;server.close()});
