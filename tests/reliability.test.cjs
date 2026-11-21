const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
const storage=fs.readFileSync(path.join(root,'storage.js'),'utf8');
function app({mockDisk=true}={}){
  let time=new Date('2026-11-21T12:00:00').getTime();
  class Clock extends Date{constructor(...args){super(...(args.length?args:[time]))}static now(){return time}}
  const elements=new Map(),events={},local=new Map(),disk=new Map(),texts=[];
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{value:'',innerHTML:'',textContent:'',hidden:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelector:child=>element(selector+' '+child),addEventListener(){},focus(){},setSelectionRange(){},click(){},getContext:()=>new Proxy({fillText:text=>texts.push(text),createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>target[key]||(()=>{})}),toBlob:callback=>callback(new Blob(['image']))});
    return elements.get(selector);
  };
  const context=vm.createContext({console,Date:Clock,Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},File:class{},document:{querySelector:element,querySelectorAll:()=>[],createElement:tag=>element('created:'+tag),addEventListener:(name,fn)=>{events[name]=fn},visibilityState:'visible'},window:{},navigator:{},location:{hostname:'localhost',protocol:'http:',reload(){}},localStorage:{getItem:key=>local.get(key)??null,setItem:(key,value)=>local.set(key,value)},setTimeout:()=>1,clearTimeout(){},setInterval(){},clearInterval(){},addEventListener(){},confirm:()=>true,indexedDB:{open(){throw new Error('test must supply IDB')}},elements,texts});
  const run=code=>vm.runInContext(code,context);
  run(storage+'\n'+script.slice(0,script.indexOf('/* ================= 启动')));
  context.readDisk=async key=>({ok:true,value:disk.get(key)??null});
  context.writeDisk=async entries=>{for(const [key,value] of entries)disk.set(key,JSON.parse(JSON.stringify(value)));return true};
  if(mockDisk)run('idb.get=readDisk;idb.setMany=writeDisk;');
  run('Store.ready=true;Store.mode="work";');
  return {run,context,local,disk,elements,element,events,texts,tick:milliseconds=>{time+=milliseconds},json:code=>JSON.parse(run('JSON.stringify('+code+')'))};
}
const order=overrides=>({id:1,store:'测试店',cat:'餐饮',contact:'',channel:'直客',partner:'',price:1000,deposit:200,settleVia:'private',appt:'2026-11-01T10:00',shotAt:'2026-11-01T11:00',submittedAt:null,shortAt:null,longAt:null,depositPaidAt:null,finalPaidAt:null,remindAt:null,note:'',...overrides});
function setState(a,orders=[order()],payments=[]){a.run(`db=${JSON.stringify({orders,payments,threshold:15})}`)}
function seedForm(a,prefix,values={}){
  const base={store:'新店',cat:'餐饮',price:'1000',deposit:'200',date:'2026-11-22',time:'10:00',contact:'',note:'',channel:'直客',partner:'',settle:'private',...values};
  for(const [key,value] of Object.entries(base))a.element(`#${prefix}-${key}`).value=value;
}
test('empty persisted state is restored instead of demo',async()=>{
  const a=app();setState(a,[]);await a.run('save()');a.run('db=demoSeed()');assert.equal(await a.run('loadState()'),true);assert.equal(a.run('db.orders.length'),0);
});
test('newer synchronous snapshot wins before IndexedDB commit',async()=>{
  const a=app();setState(a);await a.run('save()');const old=a.disk.get('tanji_v3_work_json');a.run('db.orders[0].store="刚刚修改";save()');a.disk.set('tanji_v3_work_json',old);a.context.readDisk=async key=>({ok:true,value:key==='tanji_v3_work_json'?old:null});a.run('idb.get=readDisk');await a.run('loadState()');assert.equal(a.run('db.orders[0].store'),'刚刚修改');
});
test('legacy localStorage wins over stale legacy IDB and retains empty arrays',async()=>{
  const a=app();a.local.set('tanji_v2',JSON.stringify({orders:[],payments:[],threshold:30}));a.disk.set('json',{orders:[order()],payments:[],threshold:15});await a.run('loadState()');assert.deepEqual(a.json('db'),{orders:[],payments:[],threshold:30});assert.equal(a.run('Store.mode'),'work');
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
  a.run('db=validateState(db)');assert.equal(a.run('db.payments[1].amount'),18.98);assert.equal(a.run('db.payments.reduce((sum,p)=>sum+moneyCents(p.amount),0)'),1999);assert.equal(a.run('statsFor("M").paidSum'),19.99);
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
