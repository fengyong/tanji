const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const zlib=require('node:zlib');
const root=path.join(__dirname,'..','www');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tanji-browser-'));
const chrome=process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/* 600×300 测试图:左/中/右三等分分别是红/绿/蓝。头像默认取居中正方形 → 中心是绿;
   把图拖到最右 → 中心变蓝。用来验证「取景框对着哪,存进去的就是哪一块」。 */
function stripPng(file){
  const W=600,H=300,raw=Buffer.alloc((W*3+1)*H);
  for(let y=0;y<H;y++){const o=y*(W*3+1);for(let x=0;x<W;x++){const c=x<200?[255,0,0]:x<400?[0,200,0]:[0,0,255];raw[o+1+x*3]=c[0];raw[o+2+x*3]=c[1];raw[o+3+x*3]=c[2]}}
  const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(zlib.crc32(body)>>>0);return Buffer.concat([len,body,crc])};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
  fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
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
    const futureDay=await evaluate(`(()=>{const d=new Date();d.setDate(d.getDate()+3);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()`);
    await fill('#f-date',futureDay);assert.match(await evaluate('document.querySelector("#f-date-relative").textContent'),new RegExp('^'+futureDay+' 周. · 3 天后$'),'日期行应显示完整日期、星期和相对天数');
    const dateLayout=await evaluate(`(()=>{const d=document.querySelector('#f-date').getBoundingClientRect(),t=document.querySelector('#f-time').getBoundingClientRect(),h=document.querySelector('#f-date-relative').getBoundingClientRect();return {dateWidth:d.width,timeWidth:t.width,hintTop:h.top,dateBottom:d.bottom}})()`);
    assert.ok(dateLayout.dateWidth>90&&dateLayout.timeWidth>50&&dateLayout.hintTop>=dateLayout.dateBottom-1,'日期与时间应同排完整显示,辅助标签独立占第二行: '+JSON.stringify(dateLayout));
    await capture('new-order-mobile');
    await fill('#f-store','安全 <b>咖啡</b>');await fill('#f-price','1000');await fill('#f-deposit','200');await fill('#f-location','万象城 3 层');
    await fill('#f-date','2026-11-22');await click('[data-act="save-order"]');
    assert.equal(await evaluate('__TANJI__.db.orders.length'),1);
    assert.equal(await evaluate('document.querySelector("#v-trip .rname").textContent'),'安全 <b>咖啡</b>');
    assert.equal(await evaluate('document.querySelector("#v-trip .rname b")'),null);
    assert.equal(await evaluate('document.querySelector("#v-trip .trip-place").textContent'),'万象城 3 层');
    await evaluate('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');await evaluate('document.querySelector("#v-trip .trip-row").scrollIntoView({block:"center"})');await capture('trip-mobile');
    // 未来 7 天:含当天共 7 格横滑,点了能落到那天
    const week=await evaluate(`(()=>{const bar=document.querySelector('#v-trip .n7');if(!bar)return null;return {chips:bar.querySelectorAll('.n7d').length,title:/未来 7 天/.test(document.querySelector('#v-trip').textContent)}})()`);
    assert.deepEqual(week,{chips:7,title:true},'行程页应有未来 7 天横滑条');
    const nativeLayout=await evaluate(`(()=>{document.documentElement.classList.add('native');const status=getComputedStyle(document.querySelector('.statusbar')).display,island=getComputedStyle(document.querySelector('.island')).display,top=getComputedStyle(document.querySelector('#v-trip')).paddingTop;document.documentElement.classList.remove('native');return {status,island,top}})()`);
    assert.deepEqual(nativeLayout,{status:'none',island:'none',top:'18px'},'原生类应隐藏假状态栏并改用安全区顶部留白');
    const swipeDays=await evaluate(`(()=>{const view=document.querySelector('#v-trip');const fire=(target,type,touches,changedTouches=touches)=>target.dispatchEvent(new TouchEvent(type,{touches,changedTouches,bubbles:true,cancelable:true}));const swipe=(target,x0,y0,x1,y1)=>{const start=new Touch({identifier:1,target,clientX:x0,clientY:y0}),end=new Touch({identifier:1,target,clientX:x1,clientY:y1});fire(target,'touchstart',[start]);fire(target,'touchend',[],[end]);return __TANJI__.ui.selDay};const days=[];days.push(swipe(view,280,500,180,504));days.push(swipe(view,180,500,280,496));days.push(swipe(view,240,300,230,440));days.push(swipe(view,240,300,220,302));days.push(swipe(view.querySelector('.n7'),280,500,180,500));return days})()`);
    assert.deepEqual(swipeDays,['2026-11-23','2026-11-22','2026-11-22','2026-11-22','2026-11-22'],'左右切日、竖滚/点击/横滑条冲突阈值异常');
    await click('#v-trip [data-act="edit-order"]');
    assert.equal(await evaluate('document.querySelector("#sheet-edit").classList.contains("show")'),true,'行程行编辑图标应直接打开编辑弹层');
    assert.equal(await evaluate('document.querySelector("#sheet-detail").classList.contains("show")'),false,'直接编辑不应先打开订单详情');
    await click('#sheet-edit [data-act="close-sheet"]');
    await evaluate('__TANJI__.Store.queue');await call('Page.reload');await ready();
    assert.equal(await evaluate('__TANJI__.db.orders[0].store'),'安全 <b>咖啡</b>');
    // 输入法合成期间不能重建搜索框:节点一换,合成被强制结束,拼音被逐段提交成字面量、候选词消失。
    // 合成中的 input 不触发重绘(节点不变、列表不动),compositionend 之后才按最终文本筛选
    await click('.tab[data-tab="orders"]');
    const ime=await evaluate(`(()=>{const el=document.querySelector('#q-input');el.focus();const fire=(type,data)=>el.dispatchEvent(new CompositionEvent(type,{bubbles:true,data}));fire('compositionstart','');el.value='zzz';el.dispatchEvent(new InputEvent('input',{bubbles:true,data:'zzz',isComposing:true}));const keptNode=document.querySelector('#q-input')===el,keptRows=document.querySelectorAll('#v-orders .row').length;fire('compositionend','安全');el.value='安全';el.dispatchEvent(new InputEvent('input',{bubbles:true,data:'安全',isComposing:false}));return {keptNode,keptRows,rows:document.querySelectorAll('#v-orders .row').length,q:__TANJI__.ui.q}})()`);
    assert.deepEqual(ime,{keptNode:true,keptRows:1,rows:1,q:'安全'}, '搜索框在输入法合成期间被重建,或合成结束后没有按最终文本筛选: '+JSON.stringify(ime));
    await click('#v-orders [data-act="edit-order"]');
    assert.equal(await evaluate('document.querySelector("#sheet-edit").classList.contains("show")'),true,'订单行编辑图标应直接打开完整编辑弹层');
    assert.equal(await evaluate('!!document.querySelector("#e-store")&&!!document.querySelector("#e-location")&&!!document.querySelector("#e-note")'),true,'直接入口应使用详情内的完整编辑表单');
    await click('#sheet-edit [data-act="close-sheet"]');
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
    // 头像裁剪:选图 → 全屏裁剪层 → 「使用」只把 128×128 的裁剪结果存进草稿。
    // 不调整直接用 = 以前的居中正方形裁切(逐像素一致);拖动后存的是取景框对着的那一块;「取消」不动草稿。
    const stripPath=path.join(profile,'strip.png');stripPng(stripPath);
    const stripB64=fs.readFileSync(stripPath).toString('base64');
    const centerPixel=async url=>evaluate(`(async()=>{const i=new Image();i.src=${JSON.stringify(url)};await i.decode();const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');g.drawImage(i,0,0);return [i.naturalWidth,i.naturalHeight,...g.getImageData(64,64,1,1).data].slice(0,6)})()`);
    const pickAvatar=async()=>{const {root:doc}=await call('DOM.getDocument');const input=await call('DOM.querySelector',{nodeId:doc.nodeId,selector:'#avatar-file'});await call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[stripPath]});await evaluate('new Promise(resolve=>{const check=()=>!document.querySelector("#avatar-crop").hidden?resolve():setTimeout(check,25);check()})')};
    const nextDraft=async not=>evaluate(`new Promise(resolve=>{const check=()=>__TANJI__.ui.draftAvatar&&__TANJI__.ui.draftAvatar!==${JSON.stringify(not)}?resolve(__TANJI__.ui.draftAvatar):setTimeout(check,25);check()})`);
    await click('.tab[data-tab="stats"]');await evaluate(`document.querySelector('#v-stats [data-act="open-account"]').click()`);
    // 记下每次出图用的取景区域(原图像素坐标):断言的是几何,不是 JPEG 字节 —— 同一张图先按预览尺寸
    // 画过再缩小出图,浏览器走的重采样路径略有差异,色块边缘会有个位数级的像素差,肉眼不可见。
    await evaluate("window.__cropRects=[];const origCrop=TanJiImage.crop;TanJiImage.crop=async(img,rect,preset)=>{window.__cropRects.push(rect);return origCrop(img,rect,preset)};'ok'");
    await pickAvatar();
    assert.equal(await evaluate('__TANJI__.ui.draftAvatar'),null,'选图后先进裁剪层,草稿不该被改');
    await click('[data-act="crop-use"]');
    const centered=await nextDraft(null);
    assert.equal(await evaluate(`document.querySelector('#avatar-crop').hidden`),true,'「使用」后裁剪层应收起');
    assert.equal(await evaluate(`document.querySelector('#sheet-account').classList.contains('show')`),true,'账号弹层应保持打开');
    assert.deepEqual(await evaluate('window.__cropRects'),[{sx:150,sy:0,sw:300,sh:300}],'不调整直接「使用」= 以前的居中正方形裁切:600×300 的图应取中间 300×300,实际 '+JSON.stringify(await evaluate('window.__cropRects')));
    let [w,h,...rgb]=await centerPixel(centered);
    assert.deepEqual([w,h],[128,128],'头像必须是 128×128');
    assert.ok(rgb[1]>150&&rgb[0]<40&&rgb[2]<40,'默认取景框对着的应是中间的绿色区域,实测 '+rgb);
    await pickAvatar();
    const box=await evaluate(`(()=>{const r=document.querySelector('#crop-canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:box.x,y:box.y});
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:box.x-400,y:box.y});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:box.x-400,y:box.y});
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await click('[data-act="crop-use"]');
    const dragged=await nextDraft(centered);
    rgb=(await centerPixel(dragged)).slice(2);
    assert.ok(rgb[2]>150&&rgb[0]<40&&rgb[1]<40,'把图拖到最右后,存进去的应是右边的蓝色区域,实测 '+rgb);
    await pickAvatar();
    await click('[data-act="crop-cancel"]');
    assert.deepEqual(await evaluate(`[document.querySelector('#avatar-crop').hidden,__TANJI__.ui.draftAvatar===${JSON.stringify(dragged)}]`),[true,true],'「取消」应收起裁剪层且不动草稿');
    await click('#sheet-account [data-act="close-sheet"]');
    await evaluate('navigator.serviceWorker.ready');await evaluate('__TANJI__.Store.queue');
    await call('Network.enable');await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await call('Page.reload');await ready();assert.equal(await evaluate('__TANJI__.db.orders.length'),1);assert.equal(await evaluate('__TANJI__.db.payments[0].amount'),200);
    // 订单列表左滑露出复制;竖向滚动不能误触,副本直接进完整编辑
    await evaluate(`__TANJI__.db.accounts=[{id:1,name:'甲账号',color:0},{id:2,name:'乙账号',color:1}];__TANJI__.renderTrip()`);
    await click('.tab[data-tab="orders"]');
    const swipeCopy=await evaluate(`(()=>{const track=document.querySelector('#v-orders .order-swipe-track'),item=track.closest('.order-swipe');const fire=(type,touches,changedTouches=touches)=>track.dispatchEvent(new TouchEvent(type,{touches,changedTouches,bubbles:true,cancelable:true}));const swipe=(x0,y0,x1,y1)=>{const start=new Touch({identifier:1,target:track,clientX:x0,clientY:y0}),move=new Touch({identifier:1,target:track,clientX:x1,clientY:y1});fire('touchstart',[start]);fire('touchmove',[move]);fire('touchend',[],[move]);return item.classList.contains('open')};return {vertical:swipe(300,200,295,330),horizontal:swipe(300,400,170,405)}})()`);
    assert.deepEqual(swipeCopy,{vertical:false,horizontal:true},'订单左滑复制与竖向滚动冲突判定异常');
    await click('#v-orders .order-swipe [data-act="copy-order"]');
    assert.equal(await evaluate('__TANJI__.db.orders.length'),2);
    assert.equal(await evaluate('document.querySelector("#sheet-edit").classList.contains("show")&&__TANJI__.ui.editId===2'),true,'复制后应直接编辑副本');
    assert.equal(await evaluate('__TANJI__.db.orders[1].shotAt===null&&__TANJI__.db.orders[1].depositPaidAt===null'),true,'副本不能带历史进度');
    await fill('#e-price','800');await click('[data-act="save-edit"]');
    assert.deepEqual(await evaluate('__TANJI__.db.orders.map(o=>o.price)'),[1000,800],'副本改价不能影响原订单');
    // 多账号创建:同一表单一次拆成两个独立订单
    await click('.tab[data-tab="home"]');await click('#v-home [data-act="new-order"]');await click('#f-acc-block [data-id="2"]');
    await fill('#f-store','双账号测试店');await fill('#f-price','500');await fill('#f-deposit','0');await fill('#f-date','2026-11-22');await click('[data-act="save-order"]');
    assert.equal(await evaluate('__TANJI__.db.orders.length'),4);
    assert.deepEqual(await evaluate('__TANJI__.db.orders.slice(-2).map(o=>o.accountId)'),[1,2],'两个选中账号应各生成一单');
    assert.deepEqual(await evaluate('__TANJI__.db.orders.slice(-2).map(o=>o.id)'),[3,4],'拆单必须分配不同订单 ID');
    assert.equal(await evaluate('__TANJI__.db.orders.slice(-2).every(o=>o.store==="双账号测试店"&&o.price===500&&o.shotAt===null)'),true);
    // 连点防护(P1-2):保存后 sheet 有 340ms 滑动动画,期间 visibility 仍是 visible、
    // 按钮仍可命中 —— 不锁指针事件,快速连点/双指同击会重复建单(多账号拆单时一次翻倍)。
    // 机制断言(确定性):保存动作一触发,sheet 的指针事件必须立刻锁掉;
    // 行为断言(兜底):紧接着再原地点一次,不能多出订单。
    await click('.tab[data-tab="home"]');await click('#v-home [data-act="new-order"]');
    await fill('#f-store','连点防护店');await fill('#f-price','300');await fill('#f-deposit','0');await fill('#f-date','2026-11-22');
    // 等开场动画结束再取按钮坐标:动画中 getBoundingClientRect 是中间态,派发会落空
    await evaluate('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');
    const savePos=await evaluate(`(()=>{const btn=document.querySelector('#sheet-new [data-act="save-order"]');const r=btn.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:savePos.x,y:savePos.y});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:savePos.x,y:savePos.y});
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#sheet-new [data-act="save-order"]').closest('.sheet')).pointerEvents`),'none','保存后 sheet 必须锁掉指针事件:340ms 关闭动画期间按钮仍可见,连点会重复建单');
    assert.equal(await evaluate('__TANJI__.db.orders.length'),5,'第一次保存应建出一笔');
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:savePos.x,y:savePos.y});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:savePos.x,y:savePos.y});
    await evaluate('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');
    assert.equal(await evaluate('__TANJI__.db.orders.length'),5,'连点保存只能建一笔订单,实测 '+await evaluate('__TANJI__.db.orders.length'));
    await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await capture('home-desktop');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,viewports:['390x844','1280x900'],screenshots,checks:['SQLite generation','single-writer lock','demo/work isolation','create + reload','HTML escaping','save button always visible','geo module loaded','touch feel locked','sheet drag to dismiss','future 7 days bar','collection follow-up log','payment + statistics','payment undo','financial edit protection','selected-date sharing','JSON file input + restore','corrupt import rejection','clear + empty reload','checkpoint recovery','avatar crop','offline reload'],consoleErrors:errors},null,2));
    await send('Browser.close');
  }finally{
    if(socket)socket.close();
    server.close();
    if(processChrome.exitCode===null)processChrome.kill('SIGTERM');
  }
})().catch(error=>{console.error(error);process.exitCode=1;server.close()});
