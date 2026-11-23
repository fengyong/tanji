const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..','www');
// P0 拆层后:页面脚本与 storage 已 ESM 化,改由 tests/harness-entry.mjs
// 打包成 IIFE 线束(npm run build:test-harness),在 vm 里拼回全局面
const bundle=fs.readFileSync(path.join(__dirname,'.harness.bundle.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'); // 仅供「公开 HTML 不嵌隐私数据」静态检查
const logic=fs.readFileSync(path.join(root,'logic.js'),'utf8');
const imaging=fs.readFileSync(path.join(root,'imaging.js'),'utf8');
function app({mockDisk=true}={}){
  let time=new Date('2026-11-21T12:00:00').getTime();
  class Clock extends Date{constructor(...args){super(...(args.length?args:[time]))}static now(){return time}}
  const elements=new Map(),events={},local=new Map(),disk=new Map(),texts=[];
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{value:'',checked:false,innerHTML:'',textContent:'',hidden:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelector:child=>element(selector+' '+child),addEventListener(){},focus(){},setSelectionRange(){},click(){},getContext:()=>new Proxy({fillText:text=>texts.push(text),createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>target[key]||(()=>{})}),toBlob:callback=>callback(new Blob(['image']))});
    return elements.get(selector);
  };
  const context=vm.createContext({console,Date:Clock,Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},File:class{},document:{querySelector:element,querySelectorAll:()=>[],createElement:tag=>element('created:'+tag),addEventListener:(name,fn)=>{events[name]=fn},visibilityState:'visible'},window:{},navigator:{},location:{hostname:'localhost',protocol:'http:',reload(){}},localStorage:{getItem:key=>local.get(key)??null,setItem:(key,value)=>local.set(key,value)},setTimeout:()=>1,clearTimeout(){},setInterval(){},clearInterval(){},addEventListener(){},confirm:()=>true,indexedDB:{open(){throw new Error('test must supply IDB')}},elements,texts});
  const run=code=>vm.runInContext(code,context);
  // 加载顺序与 index.html 一致:imaging(图像) → logic(规则) → 线束(持久化/通知/页面脚本,不含启动序列)
  run(imaging+'\n'+logic+'\n'+bundle);
  context.readDisk=async key=>({ok:true,value:disk.get(key)??null});
  context.writeDisk=async entries=>{for(const [key,value] of entries)disk.set(key,JSON.parse(JSON.stringify(value)));return true};
  if(mockDisk)run('idb.get=readDisk;idb.setMany=writeDisk;');
  run('Store.ready=true;Store.mode="work";');
  return {run,context,local,disk,elements,element,events,texts,tick:milliseconds=>{time+=milliseconds},json:code=>JSON.parse(run('JSON.stringify('+code+')'))};
}
const order=overrides=>({id:1,store:'测试店',cat:'餐饮',contact:'',channel:'直客',partner:'',price:1000,deposit:200,settleVia:'private',appt:'2026-11-01T10:00',shotAt:'2026-11-01T11:00',submittedAt:null,shortAt:null,longAt:null,depositPaidAt:null,finalPaidAt:null,remindAt:null,location:'',deliverMain:true,deliverSub:true,reviewResult:'',publishedAt:null,accountId:null,note:'',...overrides});
// ESM 后 db 是模块 live binding,不允许外部整体重赋值;__replaceDb 做清空+变异(见 harness-entry)
function setState(a,orders=[order()],payments=[]){a.run(`__replaceDb(${JSON.stringify({orders,payments,threshold:15,notifyEnabled:true,accounts:[],providers:[]})})`)}
function seedForm(a,prefix,values={}){
  const base={store:'新店',cat:'餐饮',price:'1000',deposit:'200',date:'2026-11-22',time:'10:00',contact:'',note:'',channel:'直客',partner:'',settle:'private','need-main':true,'need-sub':false,...values};
  for(const [key,value] of Object.entries(base)){
    const el=a.element(`#${prefix}-${key}`);
    if(typeof value==='boolean')el.checked=value;else el.value=value;
  }
}
test('empty persisted state is restored instead of demo',async()=>{
  const a=app();setState(a,[]);await a.run('save()');a.run('__replaceDb(demoSeed())');assert.equal(await a.run('loadState()'),true);assert.equal(a.run('db.orders.length'),0);
});
test('newer synchronous snapshot wins before IndexedDB commit',async()=>{
  const a=app();setState(a);await a.run('save()');const old=a.disk.get('tanji_v3_work_json');a.run('db.orders[0].store="刚刚修改";save()');a.disk.set('tanji_v3_work_json',old);a.context.readDisk=async key=>({ok:true,value:key==='tanji_v3_work_json'?old:null});a.run('idb.get=readDisk');await a.run('loadState()');assert.equal(a.run('db.orders[0].store'),'刚刚修改');
});
test('legacy localStorage wins over stale legacy IDB and retains empty arrays',async()=>{
  const a=app();a.local.set('tanji_v2',JSON.stringify({orders:[],payments:[],threshold:30}));a.disk.set('json',{orders:[order()],payments:[],threshold:15});await a.run('loadState()');assert.deepEqual(a.json('db'),{orders:[],payments:[],threshold:30,notifyEnabled:true,accounts:[],providers:[]});assert.equal(a.run('Store.mode'),'work');
});
test('storage failure reports unsaved data and does not claim success',async()=>{
  const a=app();setState(a);a.run('localStorage.setItem=()=>{throw new Error("quota")};idb.setMany=async()=>false');assert.equal(await a.run('save()'),false);assert.match(a.run('Store.status'),/保存失败/);assert.equal(a.run('db.orders.length'),1);
});
test('corrupt data is not overwritten with demo',async()=>{
  const a=app();a.local.set('tanji_v3_work_json','{bad');await a.run('loadState()');assert.equal(a.run('Store.blocked'),true);assert.equal(a.local.get('tanji_v3_work_json'),'{bad');assert.equal(a.disk.size,0);
});
test('queued JSON and SQLite derive from the same immutable snapshot',async()=>{
  const a=app();setState(a);a.run('buildSqliteBytes=state=>state.orders[0].store');const saved=a.run('save()');a.run('db.orders[0].store="后续改动"');await saved;assert.equal(a.disk.get('tanji_v3_work_json').orders[0].store,'测试店');assert.equal(a.disk.get('tanji_v3_work_sqlite'),'测试店');
});
test('demo and work data survive switching independently',async()=>{
  const a=app();setState(a);await a.run('save()');await a.run('switchMode("demo")');assert.equal(a.run('db.orders.length'),17);await a.run('switchMode("work")');assert.equal(a.run('db.orders[0].store'),'测试店');
});
test('replacement checkpoint can undo an import',async()=>{
  const a=app();setState(a);assert.equal(await a.run('replaceData({orders:[],payments:[],threshold:30})'),true);assert.equal(a.run('db.orders.length'),0);await a.run('restoreCheckpoint()');assert.equal(a.run('db.orders[0].store'),'测试店');assert.equal(a.run('db.threshold'),15);
});
test('failed pre-replacement backup preserves current data',async()=>{
  const a=app();setState(a);a.run('localStorage.setItem=()=>{throw new Error("quota")};idb.setMany=async()=>false');assert.equal(await a.run('replaceData({orders:[],payments:[],threshold:30})'),false);assert.equal(a.run('db.orders.length'),1);
});
test('JSON backup round trip preserves data and threshold',()=>{
  const a=app();setState(a);a.run('db.threshold=45');assert.deepEqual(a.json('validateState(backupDocument())'),a.json('db'));
});
test('old exported threshold is supported',()=>{
  const a=app();assert.equal(a.run('validateState({version:"0.2",orders:[],payments:[],collectThresholdDays:30}).threshold'),30);
});
test('malformed imports reject duplicate IDs, invalid dates and amounts',()=>{
  const a=app();for(const orders of [[order(),order()],[order({price:-1})],[order({deposit:1200})],[order({appt:'2026-02-30T10:00'})],[order({store:''})]])assert.throws(()=>a.run(`validateState(${JSON.stringify({orders,payments:[]})})`));assert.throws(()=>a.run('validateState({orders:[],payments:[{oid:9}]})'));
});
test('empty database creates distinct finite IDs',()=>{
  const a=app();setState(a,[]);seedForm(a,'f');a.run('saveOrder();saveOrder()');assert.deepEqual(a.json('db.orders.map(o=>o.id)'),[1,2]);
});
test('new orders reject negative and excessive deposits but accept zero price',()=>{
  for(const values of [{price:'-10'},{deposit:'-10'},{deposit:'1200'},{price:'1.234'}]){const a=app();setState(a,[]);seedForm(a,'f',values);a.run('saveOrder()');assert.equal(a.run('db.orders.length'),0)}
  const a=app();setState(a,[]);seedForm(a,'f',{price:'0',deposit:'0'});a.run('saveOrder()');assert.equal(a.run('db.orders.length'),1);assert.equal(a.run('owedOf(db.orders[0])'),0);assert.equal(a.run('isOver(db.orders[0])'),false);
});
test('zero balance settles without a zero-value payment',()=>{
  const a=app();setState(a,[order({price:0,deposit:0})]);assert.equal(a.run('payOf(db.orders[0])'),'已结清');a.run('pay(1,"final")');assert.equal(a.run('db.payments.length'),0);
});
test('unpaid deposit cannot be hidden by a paid final balance',()=>{
  const a=app();setState(a,[order({finalPaidAt:'2026-11-02T10:00'})]);assert.equal(a.run('payOf(db.orders[0])'),'待定金');assert.equal(a.run('owedOf(db.orders[0])'),200);
});
test('repeat payment only records once',()=>{
  const a=app();setState(a);a.run('pay(1,"deposit");pay(1,"deposit")');assert.equal(a.run('db.payments.length'),1);assert.equal(a.run('db.payments[0].amount'),200);
});
test('already paid orders cannot silently change financial history',()=>{
  const a=app();setState(a,[order({depositPaidAt:'2026-11-01T09:00'})],[{oid:1,kind:'定金',amount:200,at:'2026-11-01T09:00',method:'微信'}]);a.run('ui.editId=1');seedForm(a,'e',{price:'1200',deposit:'300'});a.run('saveEdit()');assert.equal(a.run('db.orders[0].price'),1000);assert.equal(a.run('db.payments[0].amount'),200);
});
test('overdue requires actual shooting and excludes platform and zero balance',()=>{
  const a=app();for(const overrides of [{shotAt:null},{settleVia:'douyin'},{price:200,deposit:200,depositPaidAt:'2026-11-01T10:00'}]){setState(a,[order(overrides)]);assert.equal(a.run('isOver(db.orders[0])'),false)}setState(a,[order({depositPaidAt:'2026-11-01T10:00'})]);assert.equal(a.run('isOver(db.orders[0])'),true);
});
test('new payment is counted after the application has been open',()=>{
  const a=app();setState(a);a.tick(3600000);a.run('pay(1,"deposit")');assert.equal(a.run('statsFor("M").paidSum'),200);
});
test('seven-day summary and bars share natural-day boundaries',()=>{
  const a=app();setState(a,[order()],[{oid:1,kind:'定金',amount:100,at:'2026-11-14T18:00',method:'微信'},{oid:1,kind:'尾款',amount:200,at:'2026-11-15T00:00',method:'微信'}]);assert.equal(a.run('statsFor("7").paidSum'),200);a.run('renderStats()');assert.match(a.element('#v-stats').innerHTML,/¥200/);
});
test('clock crosses midnight without forcing a manually selected day',()=>{
  const a=app();a.tick(86400000);a.run('refreshClock()');assert.equal(a.run('TODAY'),'2026-11-22');assert.equal(a.run('ui.selDay'),'2026-11-22');a.run('ui.selDay="2026-10-01"');a.tick(86400000);a.run('refreshClock()');assert.equal(a.run('ui.selDay'),'2026-10-01');
});
test('HTML text and attributes are escaped, including search input',()=>{
  const a=app();setState(a,[order({store:'<img src=x onerror=alert(1)>',channel:'" onclick="bad'})]);assert.doesNotMatch(a.run('orderRowTrip(db.orders[0])'),/<img/);assert.match(a.run('orderRowTrip(db.orders[0])'),/&lt;img/);a.run('ui.q=\'" autofocus onfocus="bad\';renderOrders()');assert.match(a.element('#v-orders').innerHTML,/&quot;/);
});
test('share uses explicitly selected date instead of today',async()=>{
  const a=app();setState(a,[order({appt:'2026-11-22T10:00',store:'明天店'})]);await a.run('buildTodayImage("2026-11-22")');assert.ok(a.texts.some(text=>String(text).includes('明天店')));assert.ok(a.texts.some(text=>String(text).includes('11月22日')));
});
test('share image follows the account filter, like the trip page it is shared from',async()=>{
  const a=app();setState(a,[order({id:1,appt:'2026-11-22T10:00',store:'甲账号的店',accountId:1}),order({id:2,appt:'2026-11-22T14:00',store:'乙账号的店',accountId:2})]);
  a.run("db.accounts=[{id:1,name:'甲',color:0},{id:2,name:'乙',color:1}];ui.accFilter=1;");
  await a.run('buildTodayImage("2026-11-22")');
  assert.ok(a.texts.some(text=>String(text).includes('甲账号的店')),'当前账号的单要在图里');
  assert.ok(!a.texts.some(text=>String(text).includes('乙账号的店')),'筛了账号还把别的账号的单画进分享图:行程页只显示当前账号,图却替用户分享了没打算分享的行程');
  assert.ok(!a.texts.some(text=>String(text).includes('2 个拍摄安排')),'标题计数也要跟着筛选');
});
test('IndexedDB writes only succeed after transaction commit',async()=>{
  const a=app({mockDisk:false});let transaction,settled=false,putCount=0;
  a.context.database={transaction:()=>transaction={objectStore:()=>({put(){putCount++;return {}}})}};
  a.run('idb.open=async()=>database');
  const result=a.run('idb.setMany([["one",1],["two",2]])').then(value=>{settled=true;return value});
  await Promise.resolve();await Promise.resolve();assert.equal(putCount,2);assert.equal(settled,false);
  transaction.oncomplete();assert.equal(await result,true);
});
test('IndexedDB abort reports failure even after puts were accepted',async()=>{
  const a=app({mockDisk:false});let transaction;
  a.context.database={transaction:()=>transaction={objectStore:()=>({put(){return {}}})}};a.run('idb.open=async()=>database');
  const result=a.run('idb.setMany([["one",1]])');await Promise.resolve();transaction.onabort();assert.equal(await result,false);
});
test('failed restore keeps the target checkpoint intact',async()=>{
  const a=app();setState(a);await a.run('replaceData({orders:[],payments:[],threshold:30})');
  const localBefore=new Map(a.local),diskBefore=JSON.stringify([...a.disk]);
  a.run('localStorage.setItem=()=>{throw new Error("quota")};idb.setMany=async()=>false');await a.run('restoreCheckpoint()');
  assert.equal(a.run('db.orders.length'),0);assert.deepEqual(a.local,localBefore);assert.equal(JSON.stringify([...a.disk]),diskBefore);
  assert.equal((await a.run('readSnapshot("work","backup")')).value.orders[0].store,'测试店');
});
test('local-only replacement preserves both current and prior state',async()=>{
  const a=app();setState(a);a.run('idb.setMany=async()=>false');assert.equal(await a.run('replaceData({orders:[],payments:[],threshold:30})'),true);
  await a.run('loadState()');assert.equal(a.run('db.orders.length'),0);await a.run('restoreCheckpoint()');assert.equal(a.run('db.orders[0].store'),'测试店');
});
test('locked-out pages cannot persist or replace data',async()=>{
  const a=app();setState(a);await a.run('save()');const before=new Map(a.local);
  a.run('Store.lockedOut=true');await a.run('loadState()');assert.equal(a.run('Store.blocked'),true);
  assert.equal(await a.run('save()'),false);assert.equal(await a.run('replaceData({orders:[],payments:[],threshold:30})'),false);assert.deepEqual(a.local,before);
});
test('import preview rejects inconsistent receipts without changing data',async()=>{
  const a=app();setState(a);a.context.file={name:'broken.json',size:100,text:async()=>JSON.stringify({orders:[order({depositPaidAt:'2026-11-01T10:00'})],payments:[]})};
  await a.run('previewImport(file)');assert.equal(a.run('Store.pending'),null);assert.equal(a.run('db.orders[0].store'),'测试店');assert.match(a.element('#toast').textContent,/不一致/);
});
test('month navigation clamps selected dates at month end',()=>{
  const a=app();a.run('ui.selDay="2026-01-31";ui.vMon={y:2026,m:1}');a.events.click({target:{closest:()=>({dataset:{act:'mnav',d:'1'}})}});assert.equal(a.run('ui.selDay'),'2026-02-28');
});
test('home collection link includes every active overdue order',()=>{
  const a=app();setState(a,[order({depositPaidAt:'2026-11-01T09:00'}),order({id:2,store:'第二店',shotAt:'2026-10-01T10:00',depositPaidAt:'2026-10-01T09:00'})]);
  a.events.click({target:{closest:()=>({dataset:{act:'goto-collect'}})}});assert.equal(a.run('ui.bucket'),'over');assert.match(a.element('#v-pay').innerHTML,/测试店/);assert.match(a.element('#v-pay').innerHTML,/第二店/);
});
test('unreadable replica prevents stale data from overwriting a newer snapshot',async()=>{
  const a=app();setState(a);await a.run('save()');const old=a.local.get('tanji_v3_work_json');
  a.run('db.orders[0].store="最新记录"');await a.run('save()');a.local.set('tanji_v3_work_json',old);
  a.run('idb.get=async key=>key==="tanji_v3_work_json"?{ok:false,value:null}:readDisk(key)');
  await a.run('loadState()');assert.equal(a.run('Store.blocked'),true);assert.equal(await a.run('persistFull()'),false);assert.equal(a.disk.get('tanji_v3_work_json').orders[0].store,'最新记录');
  a.run('idb.get=readDisk');await a.run('loadState()');assert.equal(a.run('Store.blocked'),false);assert.equal(a.run('db.orders[0].store'),'最新记录');
});
test('unreadable target replica prevents dataset switching',async()=>{
  const a=app();setState(a);await a.run('save()');a.run('idb.get=async key=>key==="tanji_v3_demo_json"?{ok:false,value:null}:readDisk(key)');
  await a.run('switchMode("demo")');assert.equal(a.run('Store.mode'),'work');assert.equal(a.run('db.orders.length'),1);assert.equal(a.local.has('tanji_v3_demo_json'),false);
});
test('zero-value receipts cannot settle an unpaid imported order',async()=>{
  const a=app();setState(a);a.context.file={name:'zero.json',size:100,text:async()=>JSON.stringify({orders:[order()],payments:[{oid:1,kind:'定金',amount:0,at:'2026-11-01T10:00',method:'微信'},{oid:1,kind:'尾款',amount:0,at:'2026-11-01T10:00',method:'微信'}]})};
  await a.run('previewImport(file)');assert.equal(a.run('Store.pending'),null);assert.equal(a.run('owedOf(db.orders[0])'),1000);
});
test('legacy decimal receipts normalize consistently to cents',()=>{
  const a=app();setState(a,[order({price:19.99,deposit:1.01,depositPaidAt:'2026-11-01T10:00',finalPaidAt:'2026-11-01T10:00'})],[{oid:1,kind:'定金',amount:1.01,at:'2026-11-01T10:00',method:'微信'},{oid:1,kind:'尾款',amount:19.99-1.01,at:'2026-11-01T10:00',method:'微信'}]);
  a.run('__replaceDb(validateState(db))');assert.equal(a.run('db.payments[1].amount'),18.98);assert.equal(a.run('db.payments.reduce((sum,p)=>sum+moneyCents(p.amount),0)'),1999);assert.equal(a.run('statsFor("M").paidSum'),19.99);
});
test('unpaid deposits do not hide overdue final payments',()=>{
  const a=app();setState(a);assert.equal(a.run('isOver(db.orders[0])'),true);assert.equal(a.run('overdueDays(db.orders[0])'),20);a.run('ui.bucket="over";renderPay()');assert.match(a.element('#v-pay').innerHTML,/data-kind="final"/);assert.match(a.element('#v-pay').innerHTML,/另待定金/);
});
test('read-only pages can inspect details but cannot edit or collect',()=>{
  const a=app();setState(a);a.run('Store.blocked=true');const click=act=>a.events.click({target:{closest:()=>({dataset:{act,oid:'1'}})}});
  click('open');assert.equal(a.run('ui.detail'),1);click('edit-order');assert.notEqual(a.run('ui.editId'),1);click('mark-shot');click('confirm-pay');assert.equal(a.run('db.orders[0].shotAt'),'2026-11-01T11:00');assert.equal(a.run('db.payments.length'),0);
});
test('public HTML no longer embeds private schedule',()=>{
  assert.doesNotMatch(html,/function dawangSeed|阿遇烧烤|郭璐璐\(龙华\)/);
});
test('催收跟进痕迹:合法条目保留,坏条目丢弃,缺省不造字段',()=>{
  const a=app();
  const tracked=order({remindLog:[{at:'2026-11-10T10:00',note:'说这周给'},{at:'坏时间',note:'x'},{at:'2026-11-18T18:30',note:123}]});
  const clean=a.json(`validateState(${JSON.stringify({orders:[tracked],payments:[]})})`);
  assert.equal(clean.orders[0].remindLog.length,2,'时间非法的条目应被丢弃');
  assert.equal(clean.orders[0].remindLog[1].note,'','非文本答复归一为空串,不抛错');
  const absent=a.json(`validateState(${JSON.stringify({orders:[order()],payments:[]})})`);
  assert.equal('remindLog' in absent.orders[0],false,'没记过跟进就不该凭空造字段');
  assert.equal('expectPayAt' in absent.orders[0],false,'没填到账日也不造字段');
});
test('预计到账日:非法日期拒绝导入,合法值原样往返',()=>{
  const a=app();
  const bad=order({expectPayAt:'2026-11-31T10:00'}),good=order({expectPayAt:'2026-11-30T10:00'});
  assert.throws(()=>a.run(`validateState(${JSON.stringify({orders:[bad],payments:[]})})`),'11 月没有 31 号');
  assert.equal(a.run(`validateState(${JSON.stringify({orders:[good],payments:[]})}).orders[0].expectPayAt`),'2026-11-30T10:00');
});
test('收款撤销:撤销刚记的流水并把已收标记回滚',()=>{
  const a=app();setState(a);a.run('pay(1,"deposit")');
  assert.equal(a.run('db.payments.length'),1);
  const at=a.run('db.payments[0].at');
  assert.equal(a.run(`undoPay(1,"deposit","${at}")`),true);
  assert.equal(a.run('db.payments.length'),0);assert.equal(a.run('db.orders[0].depositPaidAt'),null);
  assert.equal(a.run(`undoPay(1,"deposit","${at}")`),false,'重复撤销不应再动数据');
});
test('撤销入口:toast 上的动作真的会被执行',()=>{
  const a=app();setState(a);a.run('pay(1,"deposit")');
  assert.equal(a.run('db.payments.length'),1);
  assert.equal(a.run('typeof toastAction'),'object','收款后应挂上撤销动作');
  a.events.click({target:{closest:()=>({dataset:{act:'toast-undo'}})}});
  assert.equal(a.run('db.payments.length'),0,'点撤销必须真的把流水撤掉,不能只是关掉提示');
  assert.equal(a.run('toastAction'),null,'动作用完要清掉,避免重复撤销');
});
test('收款撤销:流水已被改动时不再回滚',()=>{
  const a=app();setState(a);a.run('pay(1,"deposit")');
  const at=a.run('db.payments[0].at');
  a.run('db.payments[0].at="2030-01-01T00:00"');
  assert.equal(a.run(`undoPay(1,"deposit","${at}")`),false,'对不上就保守不删');
  assert.equal(a.run('db.payments.length'),1);
});
test('冲突提示带上已有单的时间与地点',()=>{
  const a=app();setState(a,[order({id:1,appt:'2026-11-22T12:00',location:'万象城 3 层'})]);
  const msg=a.run('conflictFor("2026-11-22","11:00",0)');
  assert.match(msg,/测试店/);assert.match(msg,/12:00/);assert.match(msg,/万象城 3 层/,'不带地点就判断不了要不要跨区');
});
test('催收跟进:记一次后追加而不是覆盖',()=>{
  const a=app();setState(a,[order({depositPaidAt:'2026-11-01T10:00'})]);
  a.run('openRemind(1)');
  a.element('#remind-note').value='  财务走流程  ';
  a.run('saveRemind()');
  assert.equal(a.run('db.orders[0].remindLog.length'),1);
  assert.equal(a.run('db.orders[0].remindLog[0].note'),'财务走流程','答复应去掉首尾空格');
  a.run('openRemind(1)');
  a.element('#remind-note').value='';
  a.run('saveRemind()');
  assert.equal(a.run('db.orders[0].remindLog.length'),2,'第二次跟进要追加,不能覆盖上一次');
  assert.equal(a.run('db.orders[0].remindLog[1].note'),'','空答复留空串,不写 undefined');
});
test('平台单:预计到账弹层保存后落成完整时间串',()=>{
  const a=app();setState(a,[order({settleVia:'douyin',depositPaidAt:'2026-11-01T10:00'})]);
  a.run('openExpect(1)');
  a.element('#expect-date').value='2026-12-01';
  a.run('saveExpect()');
  assert.equal(a.run('db.orders[0].expectPayAt'),'2026-12-01T10:00','只选日期,时间固定 10:00 便于排序');
  a.run('clearExpect(1)');
  assert.equal(a.run('db.orders[0].expectPayAt'),null);
});
test('平台单在收款页显示预计到账与超期',()=>{
  const a=app();setState(a,[order({settleVia:'douyin',depositPaidAt:'2026-11-01T10:00',expectPayAt:'2026-11-10T10:00'})]);
  a.run('renderPay()');
  const html=a.element('#v-pay').innerHTML;
  assert.match(html,/11-10/);assert.match(html,/已超期/);
});
test('行程页给出未来 7 天横滑条',()=>{
  const a=app();setState(a,[order({id:1,appt:'2026-11-22T10:00',price:1000})]);
  a.run('ui.selDay="2026-11-21";ui.vMon={y:2026,m:11};renderTrip()');
  const html=a.element('#v-trip').innerHTML;
  assert.equal((html.match(/class="n7d/g)||[]).length,7,'含当天共 7 格');
  assert.match(html,/未来 7 天 · 1 单/);
});

/* ---------- 第五轮深度 review 的回归(2026-11-22) ---------- */

test('账号筛选要覆盖行程页与收款流水(同一屏两个口径最容易出错)',()=>{
  const a=app();
  setState(a,[order({id:1,store:'A账号的单',accountId:1}),order({id:2,store:'B账号的单',accountId:2})]);
  a.run(`db.accounts=[{id:1,name:'账号A',color:0},{id:2,name:'账号B',color:1}]`);
  a.run(`db.payments=[{oid:2,kind:'定金',amount:100,at:'2026-11-01T10:00',method:'微信'}]`);
  a.run('ui.accFilter=1');
  a.run('renderTrip()');
  assert.doesNotMatch(a.element('#v-trip').innerHTML,/B账号/,'行程页不应出现别的账号的订单');
  a.run('renderPay()');
  assert.doesNotMatch(a.element('#v-pay').innerHTML,/B账号/,'收款流水不应出现别的账号的记录');
  // 取消筛选后两边的单都要回来
  a.run('ui.accFilter=null');
  a.run('renderTrip()');
  assert.match(a.element('#v-trip').innerHTML,/B账号/,'取消筛选后应看到全部账号');
});

test('隐私模式不能被编辑弹层绕过(截图模式不能露金额)',()=>{
  const a=app();setState(a,[order({price:1200,deposit:300})]);
  a.run('ui.privacy=true');
  a.run('openEdit(1)');
  const body=a.element('#edit-body').innerHTML;
  assert.match(body,/id="e-price"[^>]*data-masked="1"/,'隐私模式下总价输入框应遮蔽');
  assert.doesNotMatch(body,/id="e-price"[^>]*value="1200"/,'隐私模式下不能出现真实总价');
  assert.doesNotMatch(body,/id="e-deposit"[^>]*value="300"/,'隐私模式下不能出现真实定金');
  // 遮蔽状态下保存:不能报「金额不合法」,也不能把金额改掉
  a.element('#e-price').dataset.masked='1';
  a.element('#e-deposit').dataset.masked='1';
  a.element('#e-store').value='测试店';
  a.element('#e-settle').value='private';
  a.element('#e-date').value='2026-11-01';
  a.element('#e-time').value='10:00';
  a.element('#e-need-main').checked=true;
  a.run('saveEdit()');
  assert.equal(a.run('db.orders[0].price'),1200,'遮蔽状态下保存应保持原金额');
  assert.equal(a.run('db.orders[0].deposit'),300,'遮蔽状态下保存应保持原定金');
});

test('里程碑前置守卫:未提审不许标记发布(哪怕正副片都不要求)',()=>{
  const a=app();
  setState(a,[order({shotAt:null,submittedAt:null,publishedAt:null,deliverMain:false,deliverSub:false})]);
  assert.equal(a.run("mark(1,'publishedAt','发布')"),false,'未提审不能标发布');
  assert.equal(a.run('db.orders[0].publishedAt'),null,'publishedAt 不该被写进去');
});

/* ---------- P3:Store 显式状态视图(2026-11-23) ---------- */

test('storePhase:就绪为 ready,数据替换中为 writing,完成后回 ready',async()=>{
  const a=app();
  assert.equal(a.run('storePhase()'),'ready');
  // busy 只罩重型操作(replaceData/switchMode);save 走 queue 不占 busy
  const pending=a.run('replaceData({orders:[],payments:[],threshold:15})');
  assert.equal(a.run('storePhase()'),'writing','replaceData 进行中应处于 writing');
  await pending;
  assert.equal(a.run('storePhase()'),'ready');
});
test('storePhase:未就绪为 loading',()=>{
  const a=app();
  a.run('Store.ready=false');
  assert.equal(a.run('storePhase()'),'loading');
});
test('storePhase:数据损坏进入 read-only,写入暂停但可读',async()=>{
  const a=app();
  a.local.set('tanji_v3_work_json','{bad');
  await a.run('loadState()');
  assert.equal(a.run('storePhase()'),'read-only');
  assert.equal(a.run('Store.blocked'),true);
});
test('storePhase:失去多 Tab 写锁是 locked-out 终态,且必然 blocked(不变量)',async()=>{
  const a=app();
  a.run('navigator.locks=undefined');       // 无锁环境 = 拿不到写锁
  await a.run('acquireWriter()');
  assert.equal(a.run('Store.lockedOut'),true);
  await a.run('loadState()');
  assert.equal(a.run('storePhase()'),'locked-out');
  assert.equal(a.run('Store.blocked'),true,'lockedOut 必须蕴含 blocked(写锁丢了写入必须停)');
});

/* ---------- 隐私模式:渲染级遮蔽(2026-11-23,第六轮 review 发现的回归) ---------- */

test('隐私模式遮蔽全部渲染金额,关闭后恢复',()=>{
  const a=app();setState(a);
  const views=['#v-home','#v-trip','#v-orders','#v-pay','#v-stats'];
  a.run('ui.privacy=false;renderAll()');
  const withMoney=views.filter(sel=>/¥[\d,]/.test(a.element(sel).innerHTML));
  assert.ok(withMoney.length>=3,`关闭隐私时应有金额渲染,实际只有 ${withMoney}`);
  a.run('ui.privacy=true;renderAll()');
  for(const sel of views){
    const html=a.element(sel).innerHTML;
    assert.ok(!/¥[\d,]/.test(html),`隐私模式下 ${sel} 仍渲染真实金额`);
  }
  assert.ok(a.element('#v-home').innerHTML.includes('✱✱✱'),'隐私模式下应出现遮蔽记号');
  a.run('ui.privacy=false;renderAll()');
  assert.ok(/¥[\d,]/.test(a.element('#v-home').innerHTML),'关闭隐私后应恢复真实金额');
});
