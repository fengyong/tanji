/**
 * native-app 分支回归测试：覆盖「原生路径」(isNative=true)。
 *
 * 背景：native 分支把 Web 资源搬进 www/ 并删掉了 main 分支的两个测试文件，
 * 而研发笔记里的「烟雾测试」跑的是浏览器回退路径(isNative=false)，
 * 原生持久化与通知桥接从未被真正执行过。
 *
 * 本文件用 node:sqlite(真实 SQLite)为 @capacitor-community/sqlite 做高保真 mock，
 * 用内存数组为 local-notifications 做 mock，从而在真机上不了手的情况下验证原生逻辑。
 * device 对象用于模拟「同一个 App 重启」——SQLite 库与通知队列跨实例共享。
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');

const root=path.join(__dirname,'..','www');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
const storage=fs.readFileSync(path.join(root,'storage.js'),'utf8');
const logic=fs.readFileSync(path.join(root,'logic.js'),'utf8');
const imaging=fs.readFileSync(path.join(root,'imaging.js'),'utf8');
const geo=fs.readFileSync(path.join(root,'geo.js'),'utf8');

/* ---------- 模拟一台设备：SQLite 库 + 通知队列（跨 app 实例共享 = 重启） ---------- */
function newDevice(options={}){
  return {
    options,
    // localStorage 在真机上跨重启保留，与 SQLite 库一样属于「设备状态」
    local:new Map(),
    db:new DatabaseSync(':memory:'),
    pending:[],
    cancelled:[],
    scheduled:[],
    written:[],
  };
}

/* ---------- Capacitor mock ---------- */
function makeCap(device){
  const {singleStatementExecute=false,grantPermission=true}=device.options;

  class SQLiteConnection{
    constructor(plugin){this.plugin=plugin}
    async createConnection(name){
      const db=device.db;
      const conn={
        db,
        async open(){},
        async execute(sql){
          if(singleStatementExecute){
            // 只取第一条语句，模拟 sqlite3_prepare_v2 的行为
            const first=String(sql).split(';').map(s=>s.trim()).find(Boolean);
            db.exec(first+';');
          }else{
            db.exec(sql);
          }
        },
        async executeSet(set){
          if(device.options.failWrites)throw new Error('disk is full');
          // 复刻 iOS 端的真实契约：每一项都必须同时含 statement 与 values 两个键，
          // 缺 values 会被整批 reject(OS-PLUG-SQLITE executeSet: Must provide a set
          // as Array of {statement,values})。Android 与浏览器端不会暴露这个问题。
          for(const item of set){
            if(!Object.prototype.hasOwnProperty.call(item,'statement')||!Object.prototype.hasOwnProperty.call(item,'values')){
              throw new Error('ExecuteSet: Must provide a set as Array of {statement,values}');
            }
          }
          db.exec('BEGIN');
          try{
            for(const item of set)db.prepare(item.statement).run(...(item.values||[]));
            db.exec('COMMIT');
          }catch(error){
            db.exec('ROLLBACK');
            throw error;
          }
        },
        async query(sql,values){
          return {values:db.prepare(sql).all(...(values||[]))};
        },
      };
      return conn;
    }
  }

  const LocalNotifications={
    async checkPermissions(){return {display:grantPermission?'granted':'denied'}},
    async requestPermissions(){return {display:grantPermission?'granted':'denied'}},
    async getPending(){return {notifications:device.pending.map(n=>({...n}))}},
    async cancel(payload){
      for(const n of (payload&&payload.notifications)||[]){
        const index=device.pending.findIndex(p=>+p.id===+n.id);
        if(index>=0)device.pending.splice(index,1);
        device.cancelled.push(+n.id);
      }
    },
    async schedule(payload){
      for(const n of (payload.notifications||[])){
        const index=device.pending.findIndex(p=>+p.id===+n.id);
        if(index>=0)device.pending.splice(index,1);
        device.pending.push(n);
        device.scheduled.push(n);
      }
    },
  };

  return {
    cap:{
      Capacitor:{isNativePlatform:()=>true},
      SQLiteConnection,
      LocalNotifications,
      Filesystem:{async writeFile(opts){device.written.push(opts);return {uri:'file:///tmp/'+opts.path};}},
      Share:{async share(){return {activityType:'custom'};}},
      Directory:{Cache:'CACHE'},
      Encoding:{UTF8:'utf8',Base64:'base64'},
      // 定位插件:iOS 真机返回 WGS84 十进制度,这里固定一个深圳坐标便于断言
      Geolocation:{async getCurrentPosition(){return {coords:{latitude:22.5430961,longitude:114.0578654,accuracy:12}}}},
    },
  };
}

/* ---------- 应用沙箱 ---------- */
function app(device=newDevice()){
  let time=new Date('2026-11-21T12:00:00').getTime();
  class Clock extends Date{
    constructor(...args){super(...(args.length?args:[time]))}
    static now(){return time}
  }
  const elements=new Map(),events={},local=device.local,texts=[];
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{value:'',checked:false,innerHTML:'',textContent:'',hidden:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelector:child=>element(selector+' '+child),addEventListener(){},focus(){},setSelectionRange(){},click(){},getContext:()=>new Proxy({fillText:text=>texts.push(text),createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>target[key]||(()=>{})}),toBlob:callback=>callback(new Blob(['image']))});
    return elements.get(selector);
  };
  const context=vm.createContext({
    console,Date:Clock,Blob,
    FileReader:class{readAsDataURL(){this.result='data:application/octet-stream;base64,TVQ=';if(this.onload)this.onload();}},
    URL:{createObjectURL:()=>'blob:test',revokeObjectURL(){}},
    document:{querySelector:element,querySelectorAll:()=>[],createElement:tag=>element('created:'+tag),addEventListener:(name,fn)=>{events[name]=fn},visibilityState:'visible'},
    window:{},navigator:{},location:{hostname:'localhost',protocol:'http:',reload(){}},
    localStorage:{getItem:key=>local.get(key)??null,setItem:(key,value)=>local.set(key,value)},
    setTimeout:()=>1,clearTimeout(){},setInterval(){},clearInterval(){},addEventListener(){},confirm:()=>true,
    indexedDB:{open(){throw new Error('native 路径不应依赖 IndexedDB')}},
    elements,texts,
  });

  const mock=makeCap(device);
  context.window.TanjiCap=mock.cap;

  const run=code=>vm.runInContext(code,context);
  // 加载顺序与 index.html 一致:imaging(图像) → logic(规则) → geo(定位) → storage(持久化/通知) → 页面脚本
  run(imaging+'\n'+logic+'\n'+geo+'\n'+storage+'\n'+script.slice(0,script.indexOf('/* ================= 启动')));
  // IndexedDB 在原生端不该被读写；这里给一个「读得到但为空」的实现，模拟 WKWebView 正常行为
  run('idb.get=async()=>({ok:true,value:null});idb.setMany=async()=>true;');
  run('Store.ready=true;Store.mode="work";');
  return {run,context,local,device,mock,elements,element,events,texts,json:code=>JSON.parse(run('JSON.stringify('+code+')'))};
}

const order=overrides=>({
  id:1,store:'测试店',cat:'餐饮',contact:'',channel:'直客',partner:'',
  price:1000,deposit:200,settleVia:'private',
  appt:'2026-11-01T10:00',shotAt:'2026-11-01T11:00',
  submittedAt:null,shortAt:null,longAt:null,
  depositPaidAt:null,finalPaidAt:null,remindAt:null,
  location:'',deliverMain:true,deliverSub:true,reviewResult:'',publishedAt:null,accountId:null,
  note:'',...overrides,
});

const OVERDUE=order({shotAt:'2026-01-01T11:00'});
const setState=(a,orders=[order()],payments=[])=>a.run(`db=${JSON.stringify({orders,payments,threshold:15})}`);
const tick=()=>new Promise(r=>setImmediate(r));

/* ---------- 原生持久化 ---------- */

test('原生持久化：写入后可重新读回',async()=>{
  const a=app();
  setState(a);
  assert.equal(await a.run('save()'),true);
  assert.equal(await a.run('loadState()'),true);
  assert.equal(a.run('db.orders.length'),1);
  assert.equal(a.run('db.orders[0].store'),'测试店');
});

test('原生持久化：orders/payments/settings 三张表都建出来了',async()=>{
  const a=app();
  setState(a);
  await a.run('save()');
  const tables=a.run(`Store.conn.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name)`);
  for(const name of ['orders','payments','settings']){
    assert.ok(tables.includes(name),`缺少表 ${name}，实际建出：${tables.join(',')}`);
  }
});

test('原生持久化：即使插件 execute 只执行第一条语句，也必须建出全部三张表',async()=>{
  const device=newDevice({singleStatementExecute:true});
  const a=app(device);
  setState(a);
  await a.run('save()');
  const tables=a.run(`Store.conn.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name)`);
  for(const name of ['orders','payments','settings']){
    assert.ok(tables.includes(name),`缺少表 ${name}，实际建出：${tables.join(',')}`);
  }
});

test('原生持久化：收款流水按订单落库，金额与渠道不串行',async()=>{
  const a=app();
  setState(a,[order()],[{oid:1,kind:'定金',amount:200,at:'2026-11-01T12:00',method:'微信'}]);
  await a.run('save()');
  const rows=a.run(`Store.conn.db.prepare("SELECT order_id,kind,amount,method FROM payments").all()`);
  assert.equal(rows.length,1);
  assert.equal(rows[0].kind,'定金');
  assert.equal(rows[0].amount,200);
  assert.equal(rows[0].method,'微信');
});

test('原生持久化：演示数据与工作数据互不覆盖',async()=>{
  const a=app();
  setState(a);
  await a.run('save()');
  await a.run('switchMode("demo")');
  assert.equal(a.run('db.orders.length'),17);
  await a.run('switchMode("work")');
  assert.equal(a.run('db.orders[0].store'),'测试店');
});

/* ---------- 通知设置持久化 ---------- */

test('通知开关：关闭后重启仍然是关闭的',async()=>{
  const device=newDevice();
  const a=app(device);
  setState(a,[OVERDUE]);
  await a.run('save()');
  await a.run('Notify.toggle()');                 // 关闭
  assert.equal(a.run('db.notifyEnabled'),false);
  await a.run('save()');
  await tick();

  const b=app(device);                            // 重启
  await b.run('loadState()');
  assert.equal(b.run('db.notifyEnabled'),false,'重启后通知开关被重置为开启');
});

test('通知开关：开启态重启后不丢',async()=>{
  const device=newDevice();
  const a=app(device);
  setState(a,[OVERDUE]);
  await a.run('save()');
  await a.run('Notify.toggle()');                 // 关闭
  await a.run('Notify.toggle()');                 // 开启
  assert.equal(a.run('db.notifyEnabled'),true);
  await a.run('save()');
  await tick();

  const b=app(device);                            // 重启
  await b.run('loadState()');
  assert.equal(b.run('db.notifyEnabled'),true);
});

test('通知开关：只管每日催收——关闭不撤用户自设的备忘与出片提醒',async()=>{
  const a=app();
  // 三笔单各司其职:逾期且未设提醒(撑起每日汇总)、逾期+用户自设备忘、刚拍摄(出片提醒)。
  // 逾期要求拍摄≥15 天前,出片提醒要求拍摄<24h,同一笔单不可能同时满足;
  // 设了备忘的单会被每日汇总排除,所以汇总与备忘也不能共用一笔单
  setState(a,[OVERDUE,order({id:2,store:'新店',shotAt:'2026-11-21T10:00'}),order({id:3,store:'另一家',shotAt:'2026-01-05T11:00'})]);
  await a.run('save()');
  await a.run('Notify.syncDaily()');
  await a.run("db.orders[0].remindAt='2026-11-24T09:00';Notify.scheduleSnooze(db.orders[0],3);");
  await a.run('Notify.syncDeliver()');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,1,'应排每日催收汇总');
  assert.equal(a.device.pending.filter(n=>+n.id>=100000&&+n.id<300000).length,1,'应排催收备忘');
  assert.equal(a.device.pending.filter(n=>+n.id>=300000).length,1,'应排出片提醒');

  await a.run('Notify.toggle()');                 // 关闭「逾期催收每日提醒」
  await tick();
  assert.equal(a.run('db.notifyEnabled'),false);
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,0,'每日汇总应被撤掉');
  assert.equal(a.device.pending.filter(n=>+n.id>=100000&&+n.id<300000).length,1,'开关只管每日汇总,用户自设的备忘提醒不能被连带取消');
  assert.equal(a.device.pending.filter(n=>+n.id>=300000).length,1,'开关只管每日汇总,出片提醒不能被连带取消');

  // 关闭期间:每日汇总不重排,出片提醒照常(它不受这个开关管)
  a.run('Notify.syncDaily()');
  a.run('Notify.syncDeliver()');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,0,'关闭期间每日汇总不应重排');
  assert.equal(a.device.pending.filter(n=>+n.id>=300000).length,1,'出片提醒不受每日催收开关影响');

  await a.run('Notify.toggle()');                 // 重新开启
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,1,'开启后每日汇总恢复');
  assert.equal(a.device.pending.filter(n=>+n.id>=100000&&+n.id<300000).length,1,'备忘提醒全程未被动过');
});

/* ---------- 通知与数据变更同步 ---------- */

test('通知 id 分段:高订单号的催收备忘不再撞掉低订单号的出片提醒',async()=>{
  const a=app();
  setState(a,[order({id:7,store:'小店',shotAt:'2026-11-21T10:00'}),order({id:2000,store:'高单号',shotAt:'2026-11-21T10:30'})]);
  await a.run('save()');
  await a.run('Notify.syncDeliver()');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===300007).length,1,'订单 7 的出片提醒在排');
  assert.equal(a.device.pending.filter(n=>+n.id===302000).length,1,'订单 2000 的出片提醒在排');
  // 旧方案备忘 id=100000+id*100+d:给订单 2000 设 7 天备忘会算出 300007,
  // 正好撞掉订单 7 的出片提醒(同 id 后排覆盖前排),取消过滤也会误伤
  await a.run("db.orders[1].remindAt='2026-11-24T09:00';Notify.scheduleSnooze(db.orders[1],7);");
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===102000).length,1,'备忘用 100000+订单号,有自己的 id 段');
  assert.equal(a.device.pending.filter(n=>+n.id===300007).length,1,'订单 7 的出片提醒不能被高单号备忘撞掉');
  await a.run('Notify.cancelOrder(2000)');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===102000||+n.id===302000).length,0,'清单应同时撤掉该单的备忘与出片提醒');
  assert.equal(a.device.pending.filter(n=>+n.id===300007).length,1,'别单的出片提醒不受影响');
});

test('数据替换(导入/恢复/清空)后通知按新数据重排,旧数据的备忘不残留',async()=>{
  const a=app();
  setState(a,[OVERDUE,order({id:2,store:'新店',shotAt:'2026-11-21T10:00'})]);
  await a.run('save()');
  // 先排每日汇总再设备忘:备忘一旦设上,该单会被 snoozed 从汇总口径里排除
  await a.run('Notify.syncDaily()');
  a.run("db.orders[0].remindAt='2026-11-24T09:00';Notify.scheduleSnooze(db.orders[0],3);");
  await a.run('Notify.syncDeliver()');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,1,'每日汇总在排');
  assert.equal(a.device.pending.filter(n=>+n.id>=100000&&+n.id<300000).length,1,'旧数据的催收备忘在排');
  assert.equal(a.device.pending.filter(n=>+n.id>=300000).length,1,'旧数据的出片提醒在排');

  // 清空与导入/恢复共用 replaceData:旧数据已不存在,任何已排通知都不该残留
  assert.equal(await a.run('replaceData({orders:[],payments:[],threshold:15})'),true);
  await tick();
  assert.equal(a.device.pending.length,0,'数据整体替换后,指向旧数据的通知应全部撤掉');

  // 换一份带逾期单的数据:每日汇总要按新数据排出来,且不凭空造备忘
  assert.equal(await a.run(`replaceData(${JSON.stringify({orders:[order({id:9,store:'导入店',shotAt:'2026-01-05T11:00'})],payments:[],threshold:15})})`),true);
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,1,'导入的逾期单应重新排每日汇总');
  assert.equal(a.device.pending.filter(n=>+n.id>=100000&&+n.id<300000).length,0,'备忘是设当时的快照,导入不凭空重排');
});


test('收尾款后每日催收通知应重新排程',async()=>{
  const a=app();
  setState(a,[OVERDUE]);
  await a.run('save()');
  await a.run('loadState()');
  a.run('Notify.syncDaily()');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,1,'逾期时应排每日通知');

  a.run("db.orders[0].finalPaidAt='2026-11-20T10:00';db.payments.push({oid:1,kind:'尾款',amount:800,at:'2026-11-20T10:00',method:'微信'});");
  a.run('Notify.syncDaily()');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,0,'已结清后每日通知应被撤掉');
});

/* ---------- 每日汇总口径变化后必须重排(汇总是 09:00 重复通知,内容按排程时冻结) ----------
 * 首页/收款页把「已设提醒(snoozed)」的单排除在催收口径外,每日汇总通知也必须同一口径:
 * 设备用后不撤销,用户照样收到"1 笔尾款已逾期";改平台单/清除拍摄后不撤销,平台单也被催。 */

test('设了催收备忘后,每日汇总按新口径重排;清除备忘后恢复',async()=>{
  const a=app();
  setState(a,[OVERDUE]);
  await a.run('save()');
  await a.run('Notify.syncDaily()');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,1,'逾期时应排每日通知');

  // 点「3天后提醒」:该单被 snoozed 从每日汇总排除,09:00 的汇总必须按新口径撤销
  a.events.click({target:{closest:()=>({dataset:{act:'snooze',oid:'1',d:'3'}})}});
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,0,'唯一的逾期单设了备忘后,每日汇总应撤销');
  assert.equal(a.device.pending.filter(n=>+n.id===100001).length,1,'备忘本身要排上');

  // 清除备忘:该单重新计入催收口径,每日汇总要恢复(与设备用时的撤销互为反向)
  a.events.click({target:{closest:()=>({dataset:{act:'clear-remind',oid:'1'}})}});
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,1,'清除备忘后每日汇总应恢复');
  assert.equal(a.device.pending.filter(n=>+n.id===100001).length,0,'备忘通知应被撤掉');
});

test('编辑把私收单改为平台单后,每日汇总按新口径撤销(平台单不催收)',async()=>{
  const a=app();
  setState(a,[OVERDUE]);
  await a.run('save()');
  await a.run('Notify.syncDaily()');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,1,'编辑前每日通知在排');

  a.run('openEdit(1)');
  a.element('#e-store').value='测试店';
  a.element('#e-price').value='1000';
  a.element('#e-deposit').value='200';
  a.element('#e-need-main').checked=true;
  a.element('#e-need-sub').checked=true;
  a.element('#e-settle').value='douyin';
  a.element('#e-date').value='2026-11-01';
  a.element('#e-time').value='10:00';
  a.events.click({target:{closest:()=>({dataset:{act:'save-edit',oid:'1'}})}});
  await tick();
  assert.equal(a.run('db.orders[0].settleVia'),'douyin','结算方式应已改为抖音商单');
  assert.equal(a.run('isOver(db.orders[0])'),false,'平台单不计逾期');
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,0,'改为平台单后每日汇总应撤销');
});

test('清除「拍摄」里程碑后,每日汇总按新口径撤销(逾期起算基础消失)',async()=>{
  const a=app();
  setState(a,[OVERDUE]);
  await a.run('save()');
  await a.run('Notify.syncDaily()');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,1,'清除前每日通知在排');

  a.events.click({target:{closest:()=>({dataset:{act:'mile',oid:'1',key:'shotAt'}})}});
  await tick();
  assert.equal(a.run('db.orders[0].shotAt'),null,'拍摄记录应被清除');
  assert.equal(a.run('isOver(db.orders[0])'),false,'没有拍摄时间不计逾期');
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,0,'清除拍摄后每日汇总应撤销');
});

test('撤销收款记录后,每日汇总按新口径重排(与 undoPay 同一口径)',async()=>{
  const a=app();
  // 已结清的单:尾款标记在、拍摄已逾期 → 撤销尾款记录后重新待收,汇总要恢复
  setState(a,[order({depositPaidAt:'2026-11-01T09:00',finalPaidAt:'2026-11-02T10:00'})]);
  await a.run('save()');
  await a.run('Notify.syncDaily()');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,0,'已结清时不排每日通知');

  a.run('ui.editId=1');
  a.events.click({target:{closest:()=>({dataset:{act:'toggle-fin',oid:'1'}})}});
  await tick();
  assert.equal(a.run('db.orders[0].finalPaidAt'),null,'尾款标记应被撤销');
  assert.equal(a.run('isOver(db.orders[0])'),true,'尾款恢复待收且拍摄已逾期');
  assert.equal(a.device.pending.filter(n=>+n.id===1).length,1,'撤销收款后每日汇总应恢复');
});

test('清除催收备忘应撤销已排程的本地通知',async()=>{
  const a=app();
  setState(a,[OVERDUE]);
  await a.run('save()');
  await a.run('loadState()');
  a.run("db.orders[0].remindAt='2026-11-25T09:00';Notify.scheduleSnooze(db.orders[0],1);");
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id>=100000&&+n.id<300000).length,1,'备忘应排一个一次性通知');

  // 处理器(clear-remind)走的是 cancelSnooze:只撤备忘段
  a.run("db.orders[0].remindAt=null;Notify.cancelSnooze(db.orders[0].id);");
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id>=100000&&+n.id<300000).length,0,'清除备忘后不应残留通知');
});

test('清除单笔催收备忘只撤备忘段,同单的 24h 出片提醒必须保留',async()=>{
  const a=app();
  setState(a,[order({id:5,shotAt:'2026-11-22T10:00'})]);
  await a.run('save()');
  await a.run('Notify.syncDeliver()');
  a.run("db.orders[0].remindAt='2026-11-25T09:00';Notify.scheduleSnooze(db.orders[0],3);");
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===100005).length,1,'备忘 100005 在排');
  assert.equal(a.device.pending.filter(n=>+n.id===300005).length,1,'出片提醒 300005 在排');

  a.run('Notify.cancelSnooze(5);');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===100005).length,0,'备忘应被撤掉');
  assert.equal(a.device.pending.filter(n=>+n.id===300005).length,1,'出片提醒不能被清除备忘连带撤掉');

  // 删单仍是两段一起撤(cancelOrder 语义不变)
  a.run('Notify.cancelOrder(5);');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===300005).length,0,'删单时出片提醒仍要一起撤');
});

test('导入校验拒绝订单 id≥100000:通知 id 分段的前提不能只靠新建拦截',()=>{
  const a=app();
  const backup=id=>({version:'0.6',threshold:15,orders:[order({id})],payments:[]});
  // 手工构造的备份若能带进高单号:备忘 id 会撞进出片段、work 段会撞进 demo 段,NOTIFY_OFFSET 整个失效
  assert.throws(()=>a.run(`validateState(${JSON.stringify(backup(100000))})`),/上限|99999/);
  assert.throws(()=>a.run(`validateState(${JSON.stringify(backup(250000))})`),/上限|99999/);
  // 上界之内的最大合法值不受影响
  a.run(`validateState(${JSON.stringify(backup(99999))})`);
});

test('双模式通知分段:work/demo 同订单号互不覆盖,切换模式不撤另一模式的通知',async()=>{
  const device=newDevice();
  const a=app(device);
  setState(a,[order({id:2,store:'工作单',shotAt:'2026-11-22T09:00'})]);
  await a.run('save()');
  await a.run('Notify.syncDeliver()');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===300002).length,1,'work 的出片提醒落在 300002');

  // 切到 demo:演示种子的 id=2(澄川咖啡,今日拍摄)同样满足出片提醒条件,
  // 旧实现会用同号 300002 把 work 的通知顶掉;分段后应排到 800002
  await a.run('switchMode("demo")');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===300002).length,1,'work 的通知不能被 demo 同订单号顶掉');
  const demoDeliver=a.device.pending.find(n=>+n.id===800002);
  assert.ok(demoDeliver,'demo 的出片提醒应落在 800002 段');
  assert.match(demoDeliver.body,/澄川咖啡/);
  assert.equal(a.device.pending.filter(n=>+n.id===500001).length,1,'demo 每日汇总应落在 500001');

  // 切回 work:work 段重排,demo 段原样保留
  await a.run('switchMode("work")');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===800002).length,1,'切回 work 后 demo 的通知不能被撤');
  assert.equal(a.device.pending.filter(n=>+n.id===300002).length,1,'work 的出片提醒仍在排');
  assert.equal(a.device.pending.filter(n=>+n.id===500001).length,1,'demo 的每日汇总也不受影响');
});

test('没有可排的出片提醒时不请求通知权限,有需求时才请求',async()=>{
  const a=app();
  a.run('globalThis.__req=0;CAP.LocalNotifications.checkPermissions=async()=>({display:"prompt"});CAP.LocalNotifications.requestPermissions=async()=>{globalThis.__req++;return{display:"granted"}};');
  setState(a,[order()]);                       // 无 shotAt,没有任何通知需求
  await a.run('Notify.syncDeliver()');
  await tick();
  assert.equal(a.run('globalThis.__req'),0,'保存普通订单不应弹通知授权');

  a.run('db.orders[0].shotAt="2026-11-22T10:00"');
  await a.run('Notify.syncDeliver()');
  await tick();
  assert.equal(a.run('globalThis.__req'),1,'真有提醒要排时才请求权限');
});

test('里程碑不能乱序:前置节点未完成时拒绝标记,不产生早于拍摄的发布时间',()=>{
  const a=app();
  setState(a,[order({shotAt:null,submittedAt:null,shortAt:null,longAt:null,publishedAt:null})]);
  assert.equal(a.run('mark(1,"publishedAt","x")'),false,'未拍摄不能标记发布');
  assert.equal(a.run('db.orders[0].publishedAt'),null);
  assert.equal(a.run('mark(1,"submittedAt","x")'),false,'未拍摄不能标记提审');
  assert.equal(a.run('db.orders[0].submittedAt'),null);

  assert.equal(a.run('mark(1,"shotAt","x")'),true,'按顺序:先拍摄');
  assert.equal(a.run('mark(1,"submittedAt","x")'),true,'再提审');
  assert.equal(a.run('mark(1,"longAt","x")'),true,'发正片');
  assert.equal(a.run('mark(1,"publishedAt","x")'),false,'双片单只出正片不算出齐,不能发布');
  assert.equal(a.run('mark(1,"shortAt","x")'),true,'补发副片');
  assert.equal(a.run('mark(1,"publishedAt","x")'),true,'出齐后才能发布');
});

test('删除订单应撤销该订单残留的一次性通知',async()=>{
  const a=app();
  setState(a,[OVERDUE]);
  await a.run('save()');
  await a.run('loadState()');
  a.run("db.orders[0].remindAt='2026-11-25T09:00';Notify.scheduleSnooze(db.orders[0],1);");
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id>=100000).length,1);

  a.run("db.orders=db.orders.filter(o=>o.id!==1);Notify.cancelOrder(1);");
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id>=100000).length,0,'删除订单后不应残留通知');
});

test('重复设置同一订单备忘只保留一个通知',async()=>{
  const a=app();
  setState(a,[OVERDUE]);
  await a.run('save()');
  await a.run('loadState()');
  a.run("db.orders[0].remindAt='2026-11-25T09:00';Notify.scheduleSnooze(db.orders[0],1);");
  await tick();
  a.run("db.orders[0].remindAt='2026-11-27T09:00';Notify.scheduleSnooze(db.orders[0],3);");
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id>=100000).length,1,'旧备忘通知应被替换而不是叠加');
});

/* ---------- 写入失败必须告知用户 ---------- */

test('原生写入失败必须提示用户，不能静默丢数据',async()=>{
  const device=newDevice({failWrites:true});
  const a=app(device);
  setState(a);
  assert.equal(await a.run('save()'),false,'写入失败必须返回 false');
  assert.match(a.run('Store.status'),/保存失败/,'写入失败必须给出可见提示');
  assert.equal(a.run('db.orders.length'),1,'数据仍在内存里，不能被丢弃');
});

test('原生写入成功后状态提示要清掉，不能一直挂着「正在保存…」',async()=>{
  const a=app();
  setState(a);
  await a.run('save()');
  assert.equal(a.run('Store.status'),'','保存成功后应清空状态提示');
});

/* ---------- 双副本兜底 ---------- */

test('原生端：SQLite 写失败后，靠 localStorage 镜像在重启时把数据找回来',async()=>{
  const device=newDevice({failWrites:true});
  const a=app(device);
  setState(a,[order({store:'镜像兜底店'})]);
  assert.equal(await a.run('save()'),false,'SQLite 写失败应返回 false');
  device.options.failWrites=false;              // 模拟下次启动时 SQLite 恢复
  const b=app(device);                          // 重启
  await b.run('loadState()');
  assert.equal(b.run('db.orders[0].store'),'镜像兜底店','重启后数据应从镜像副本恢复');
});

test('原生端：镜像比 SQLite 新时，取镜像那份（按修订号）',async()=>{
  const device=newDevice();
  const a=app(device);
  setState(a,[order({store:'较新副本店'})]);
  await a.run('save()');
  // 把 SQLite 里的副本改旧，镜像保持较新
  a.run(`Store.conn.db.prepare("UPDATE settings SET value=? WHERE scope='work' AND key='json'").run(JSON.stringify({orders:[],payments:[],threshold:15,revision:1}))`);
  const b=app(device);
  await b.run('loadState()');
  assert.equal(b.run('db.orders[0].store'),'较新副本店','应取修订号较新的副本');
});

test('原生端：SQLite 与镜像都读不出来时不写入，也不丢数据',async()=>{
  const device=newDevice();
  const a=app(device);
  setState(a);
  await a.run('save()');
  // 两份都损坏
  a.run(`Store.conn.db.prepare("UPDATE settings SET value=? WHERE scope='work' AND key='json'").run('{坏数据')`);
  a.local.set('tanji_v3_work_json','{坏数据');
  const b=app(device);
  await b.run('loadState()');
  assert.equal(b.run('Store.blocked'),true,'两份都不可信时必须暂停写入');
});

/* ---------- 导出 ---------- */

test('原生导出：二进制内容必须不传 encoding，由插件按 base64 解码后写入原始字节',async()=>{
  const a=app();
  setState(a);
  const bytes=Array.from(new Uint8Array([0x53,0x51,0x4c,0x69,0x74,0x65]));
  await a.run(`download('探记.db',${JSON.stringify(bytes)},'application/x-sqlite3')`);
  await tick();
  const written=a.device.written[a.device.written.length-1];
  // @capacitor/filesystem v8 的 getEncoding 缺省值是 .byteBuffer（base64 解码）；
  // 一旦传 encoding 就会被当作文本原样落盘，导出的 .db 会变成 base64 文本。
  assert.equal(written.encoding,undefined,'二进制导出不能传 encoding，否则 .db 会变成 base64 文本');
  assert.equal(typeof written.data,'string');
});

test('原生导出：文本导出带 UTF-8 BOM，与 Web 版一致（Excel 打开 CSV 不乱码）',async()=>{
  const a=app();
  setState(a);
  await a.run(`download('探记-工作.csv','商家,金额\\n测试店,1000','text/csv')`);
  await tick();
  const written=a.device.written[a.device.written.length-1];
  assert.equal(written.encoding,'utf8');
  assert.ok(String(written.data).startsWith('\ufeff'),'文本导出应带 BOM，与 Web 版行为一致');
});

/* ---------- 工作流 v0.5:出片配置/送审/发布/24h 出片提醒 ---------- */

test('工作流:旧库自动迁移,缺列 ALTER 补齐后新字段可读写',async()=>{
  const device=newDevice();
  // 预置 v0.4 旧表(无工作流新列)
  device.db.exec(`CREATE TABLE orders(
    mode TEXT NOT NULL, id INTEGER NOT NULL, store TEXT NOT NULL, category TEXT, contact TEXT,
    price REAL NOT NULL, deposit REAL DEFAULT 0,
    appt_at TEXT, shot_at TEXT, submitted_at TEXT, short_sent_at TEXT, long_sent_at TEXT,
    deposit_paid_at TEXT, final_paid_at TEXT, settle_via TEXT DEFAULT 'private', remind_at TEXT,
    channel TEXT, partner TEXT, note TEXT, created_at TEXT, updated_at TEXT,
    PRIMARY KEY(mode,id))`);
  device.db.exec(`CREATE TABLE payments(mode TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, kind TEXT, amount REAL, paid_at TEXT, method TEXT, note TEXT)`);
  device.db.exec(`CREATE TABLE settings(scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(scope,key))`);
  const a=app(device);
  setState(a,[order({location:'万象城 3 层',deliverSub:false,reviewResult:'pass',publishedAt:'2026-11-02T10:00'})]);
  assert.equal(await a.run('save()'),true,'写入不应因旧库缺列而失败');
  const cols=a.run(`Store.conn.db.prepare("PRAGMA table_info(orders)").all().map(r=>r.name)`);
  for(const col of ['location','deliver_main','deliver_sub','review_result','published_at']){
    assert.ok(cols.includes(col),`迁移后缺列 ${col}`);
  }
  assert.equal(await a.run('loadState()'),true);
  assert.equal(a.run('db.orders[0].location'),'万象城 3 层');
  assert.equal(a.run('db.orders[0].deliverSub'),false);
  assert.equal(a.run('db.orders[0].reviewResult'),'pass');
  assert.equal(a.run('db.orders[0].publishedAt'),'2026-11-02T10:00');
});

test('工作流:旧数据缺正/副片配置时默认都要(保持 v0.4 语义)',async()=>{
  const a=app();
  await a.run('db={orders:[{id:1,store:"旧单",cat:"餐饮",contact:"",channel:"直客",partner:"",price:1000,deposit:0,settleVia:"private",appt:"2026-11-01T10:00",shotAt:"2026-11-01T11:00",submittedAt:"2026-11-01T20:00",shortAt:null,longAt:null,depositPaidAt:null,finalPaidAt:null,remindAt:null,note:""}],payments:[],threshold:15}');
  assert.equal(a.run('validateState(db).orders[0].deliverMain'),true);
  assert.equal(a.run('validateState(db).orders[0].deliverSub'),true);
  assert.equal(a.run('validateState(db).orders[0].reviewResult'),'');
});

test('工作流:仅正片单发完正片即算出齐(已交付),且不排出片提醒',async()=>{
  const a=app();
  setState(a,[order({deliverMain:true,deliverSub:false,shotAt:'2026-11-20T11:00',submittedAt:'2026-11-20T20:00'})]);
  await a.run('save()');await a.run('loadState()');
  assert.equal(a.run('workOf(db.orders[0])'),'发片中');
  a.run("db.orders[0].longAt='2026-11-21T10:00';Notify.syncDeliver();");
  await tick();
  assert.equal(a.run('workOf(db.orders[0])'),'已交付');
  assert.equal(a.device.pending.filter(n=>+n.id>=300000&&+n.id<400000).length,0,'出齐后不应残留出片提醒');
});

test('工作流:拍摄+24h 排出片提醒(id=300000+id),双片单须都出齐才撤',async()=>{
  const a=app();
  // 当前时间 2026-11-21T12:00,拍摄于 11-21T11:00 → 提醒时刻 11-22T11:00 在未来,应排程
  setState(a,[order({shotAt:'2026-11-21T11:00'})]);
  await a.run('save()');await a.run('loadState()');
  a.run('Notify.syncDeliver()');
  await tick();
  const pending=a.device.pending.filter(n=>+n.id===300001);
  assert.equal(pending.length,1,'应排出片提醒');
  assert.equal(new Date(pending[0].schedule.at).getTime(),new Date('2026-11-22T11:00').getTime(),'提醒时刻应为拍摄+24h');
  a.run("db.orders[0].shortAt='2026-11-21T13:00';Notify.syncDeliver();");
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===300001).length,1,'仅出副片不算出齐,提醒仍在');
  a.run("db.orders[0].longAt='2026-11-21T14:00';Notify.syncDeliver();");
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===300001).length,0,'正副片出齐后提醒应撤销');
});

test('工作流:删除订单撤销其出片提醒',async()=>{
  const a=app();
  setState(a,[order({shotAt:'2026-11-21T11:00'})]);
  await a.run('save()');await a.run('loadState()');
  a.run('Notify.syncDeliver()');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===300001).length,1);
  a.run('db.orders=[];Notify.cancelOrder(1);');
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id===300001).length,0,'删单后不应残留出片提醒');
});

test('工作流:送审结果/发布时间经备份往返保留,非法值被拒',async()=>{
  const a=app();
  setState(a,[order({reviewResult:'fail',publishedAt:'2026-11-03T09:00'})]);
  await a.run('save()');await a.run('loadState()');
  assert.equal(a.run('db.orders[0].reviewResult'),'fail');
  assert.equal(a.run('validateState(backupDocument()).orders[0].reviewResult'),'fail');
  assert.equal(a.run('validateState(backupDocument()).orders[0].publishedAt'),'2026-11-03T09:00');
  assert.throws(()=>a.run(`validateState({orders:[order({reviewResult:'weird'})],payments:[]})`),'非法送审结果应被拒');
  assert.throws(()=>a.run(`validateState({orders:[order({publishedAt:'2026-13-40T10:00'})],payments:[]})`),'非法发布时间应被拒');
});

/* ---------- 账号体系 v0.6 ---------- */

test('账号:资料与头像随备份往返,订单挂账号可读回',async()=>{
  const a=app();
  const av='data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  setState(a,[order({accountId:1})]);
  a.run(`db.accounts=[{id:1,name:'大王叫我逛深圳',phone:'13800006678',douyin:'dawang',color:0,avatar:'${av}',createdAt:'2026-11-22T10:00:00.000Z'}];db.providers=['自定义MCN'];`);
  assert.equal(await a.run('save()'),true);
  const accRow=a.run(`Store.conn.db.prepare("SELECT name,avatar FROM accounts WHERE mode='work'").all()`);
  assert.equal(accRow.length,1,'accounts 表应落一行');
  assert.equal(accRow[0].name,'大王叫我逛深圳');
  assert.equal(accRow[0].avatar,av,'头像 dataURL 应原样落库');
  assert.equal(await a.run('loadState()'),true);
  assert.equal(a.run('db.accounts.length'),1);
  assert.equal(a.run('db.accounts[0].avatar'),av);
  assert.equal(a.run('db.orders[0].accountId'),1);
  assert.equal(a.run("db.providers.includes('自定义MCN')"),true,'自定义服务商应记入预设');
});

test('账号:悬空 accountId 归一为未指定,非法资料被拒',()=>{
  const a=app();
  setState(a,[order({accountId:99})]);
  assert.equal(a.run('validateState(db).orders[0].accountId'),null,'指向不存在账号应归一为 null');
  assert.throws(()=>a.run(`validateState({orders:[],payments:[],accounts:[{id:1,name:''}]})`),'空昵称应被拒');
  assert.throws(()=>a.run(`validateState({orders:[],payments:[],accounts:[{id:1,name:'x',avatar:'http://x/y.png'}]})`),'非 dataURL 头像应被拒');
  assert.equal(a.run("validateState({orders:[],payments:[]}).accounts.length"),0,'旧备份无 accounts 键时默认空');
});

test('账号:旧库迁移后 accounts 表自动建出,orders 补 account_id 列',async()=>{
  const device=newDevice();
  device.db.exec(`CREATE TABLE orders(
    mode TEXT NOT NULL, id INTEGER NOT NULL, store TEXT NOT NULL, category TEXT, contact TEXT,
    price REAL NOT NULL, deposit REAL DEFAULT 0,
    appt_at TEXT, shot_at TEXT, submitted_at TEXT, short_sent_at TEXT, long_sent_at TEXT,
    deposit_paid_at TEXT, final_paid_at TEXT, settle_via TEXT DEFAULT 'private', remind_at TEXT,
    channel TEXT, partner TEXT, note TEXT, created_at TEXT, updated_at TEXT,
    PRIMARY KEY(mode,id))`);
  device.db.exec(`CREATE TABLE payments(mode TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, kind TEXT, amount REAL, paid_at TEXT, method TEXT, note TEXT)`);
  device.db.exec(`CREATE TABLE settings(scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(scope,key))`);
  const a=app(device);
  setState(a);
  assert.equal(await a.run('save()'),true);
  const tables=a.run(`Store.conn.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name)`);
  assert.ok(tables.includes('accounts'),'迁移后应有 accounts 表');
  const cols=a.run(`Store.conn.db.prepare("PRAGMA table_info(orders)").all().map(r=>r.name)`);
  assert.ok(cols.includes('account_id'),'orders 应补 account_id 列');
});

test('账号:一键拷贝文本跳过空字段',()=>{
  const a=app();
  assert.equal(a.run(`accountCopyText({name:'大西瓜',douyin:'daxigua',phone:''})`),'昵称:大西瓜\n抖音:daxigua');
  assert.equal(a.run(`accountCopyText({name:'只有昵称'})`),'昵称:只有昵称');
});

test('账号:备份文档包含 accounts/providers',async()=>{
  const a=app();
  setState(a,[order({accountId:1})]);
  a.run(`db.accounts=[{id:1,name:'A号',color:1}];`);
  await a.run('save()');
  const doc=a.json('backupDocument()');
  assert.equal(doc.accounts.length,1);
  assert.deepEqual(doc.providers,[]);
  // 版本号必须与数据结构一起走:v0.6 起才有 accounts/providers,导出的文档要标 0.6,
  // 且必须能被当前代码读回;未知版本仍要拒绝(白名单只增不减)。
  assert.equal(doc.version,'0.6','备份文档版本应与数据结构同步为 0.6');
  assert.equal(a.json(`validateState({version:'0.6',orders:[],payments:[]}).threshold`),15,'0.6 备份必须能导入');
  assert.throws(()=>a.run(`validateState({version:'0.7',orders:[],payments:[]})`),/暂不支持这个备份版本/,'未知版本必须拒绝');
  assert.equal(a.json(`validateState(${JSON.stringify({orders:[order({accountId:42})],payments:[],accounts:[],providers:[]})}).orders[0].accountId`),null,'导入含悬空引用的备份应安全归一');
});

test('随手拍:只接受烘焙过的小图,非法格式或超限直接拒绝',()=>{
  const a=app();
  const ok='data:image/jpeg;base64,'+'A'.repeat(2400);        // ≈2.4KB 字符,典型成品
  const tooBig='data:image/jpeg;base64,'+'A'.repeat(14000);   // 超过 12KB 上限
  const badFormat='data:image/svg+xml;base64,AAAA';
  const kept=a.json(`validateState({orders:[${JSON.stringify(order({photoThumb:ok}))}],payments:[]}).orders[0].photoThumb`);
  assert.equal(kept,ok,'合法缩略图应保留');
  assert.throws(()=>a.run(`validateState({orders:[${JSON.stringify(order({photoThumb:tooBig}))}],payments:[]})`),/随手拍照片无效或过大/,'超限必须拒绝');
  assert.throws(()=>a.run(`validateState({orders:[${JSON.stringify(order({photoThumb:badFormat}))}],payments:[]})`),/随手拍照片无效或过大/,'非 jpeg/png/webp 必须拒绝');
  // 没有随手拍的订单不应写入空字段,保持与旧备份同构
  const none=a.json(`validateState({orders:[${JSON.stringify(order())}],payments:[]}).orders[0]`);
  assert.equal('photoThumb' in none,false);
});

test('到店定位:gps_place 落库、重启读回,且与手填地点并存',async()=>{
  const device=newDevice();
  const a=app(device);
  setState(a,[order({location:'万象城 3 层',gpsPlace:'22.543096,114.057865'})]);
  assert.equal(await a.run('save()'),true);
  const row=a.run(`Store.conn.db.prepare('SELECT location,gps_place FROM orders').all()[0]`);
  assert.equal(row.location,'万象城 3 层','手填地点不能被定位覆盖');
  assert.equal(row.gps_place,'22.543096,114.057865');

  const b=app(device);                                   // 重启
  await b.run('loadState()');
  assert.equal(b.run('db.orders[0].gpsPlace'),'22.543096,114.057865','重启后定位应读回');
  assert.equal(b.run('db.orders[0].location'),'万象城 3 层');

  // 插件返回的坐标统一裁到 6 位小数(存储格式固定,导出与解析都不必再猜精度)
  assert.equal(await a.run('TanJiGeo.locate()'),'22.543096,114.057865');

  // 脏坐标只丢这一段,不能让整份快照读不出来
  const norm=a.json(`validateState({orders:[${JSON.stringify(order({gpsPlace:'万象城3层'}))}],payments:[]}).orders[0]`);
  assert.equal('gpsPlace' in norm,false,'非法定位串应被丢弃而不是抛错');
});

test('账号:标识色板渲染出 8 个带颜色的可点色块(曾因缺样式整块不可见)',()=>{
  const a=app();
  a.run(`db.accounts=[{id:1,name:'吃货号',color:2}];openAccount(1);`);
  const html=a.run(`$('#a-pal').innerHTML`);
  assert.equal((html.match(/class="sw/g)||[]).length,8,'应渲染 8 个色块');
  // 色块必须是 button + 内联墨色,否则在浅底卡片上等于隐形
  assert.match(html,/<button type="button" class="sw[^"]*"[^>]*data-act="pal-pick"/);
  assert.match(html,/background:#339966/,'第 3 色(抹茶)应带墨色底');
  assert.match(html,/class="sw sel"[^>]*data-i="2"/,'当前色应有选中态');
  assert.match(a.run(`$('#a-pal-name').innerHTML`),/抹茶/,'应显示当前色名');
});

test('催收跟进/预计到账:旧库补列,数组按 JSON 落一列,重启读回',async()=>{
  const device=newDevice();
  // v0.5 时代的旧库:没有 location/gps_place/remind_log/expect_pay_at
  device.db.exec(`CREATE TABLE orders(
    mode TEXT NOT NULL, id INTEGER NOT NULL, store TEXT NOT NULL, category TEXT, contact TEXT,
    price REAL NOT NULL, deposit REAL DEFAULT 0,
    appt_at TEXT, shot_at TEXT, submitted_at TEXT, short_sent_at TEXT, long_sent_at TEXT,
    deposit_paid_at TEXT, final_paid_at TEXT, settle_via TEXT DEFAULT 'private', remind_at TEXT,
    channel TEXT, partner TEXT, note TEXT, created_at TEXT, updated_at TEXT,
    PRIMARY KEY(mode,id))`);
  device.db.exec(`CREATE TABLE payments(mode TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, kind TEXT, amount REAL, paid_at TEXT, method TEXT, note TEXT)`);
  device.db.exec(`CREATE TABLE settings(scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(scope,key))`);
  const a=app(device);
  const log=[{at:'2026-11-10T10:00',note:'说这周给'},{at:'2026-11-18T18:30',note:'财务走流程'}];
  setState(a,[order({settleVia:'douyin',remindLog:log,expectPayAt:'2026-11-30T10:00'})]);
  assert.equal(await a.run('save()'),true);
  const cols=a.run(`Store.conn.db.prepare("PRAGMA table_info(orders)").all().map(r=>r.name)`);
  assert.ok(cols.includes('remind_log'),'旧库应先 ALTER 补出 remind_log 列');
  assert.ok(cols.includes('expect_pay_at'),'旧库应先 ALTER 补出 expect_pay_at 列');
  const row=a.run(`Store.conn.db.prepare('SELECT remind_log,expect_pay_at FROM orders').all()[0]`);
  assert.deepEqual(JSON.parse(row.remind_log),log,'催收痕迹按 JSON 存一列');
  assert.equal(row.expect_pay_at,'2026-11-30T10:00');

  const b=app(device);                                   // 重启
  await b.run('loadState()');
  assert.deepEqual(b.json('db.orders[0].remindLog'),log,'重启后催收痕迹应读回');
  assert.equal(b.run('db.orders[0].expectPayAt'),'2026-11-30T10:00');
  assert.deepEqual(b.json('parseRemindLog("{bad")'),[],'坏 JSON 只丢这一列,不能让整单读崩');
});

test('旧库补列:deliver_sub 缺省为 1,不能把旧单的副片要求静默关掉',async()=>{
  const device=newDevice();
  // v0.4 旧表:没有工作流列,库里有已存在的旧单
  device.db.exec(`CREATE TABLE orders(
    mode TEXT NOT NULL, id INTEGER NOT NULL, store TEXT NOT NULL, category TEXT, contact TEXT,
    price REAL NOT NULL, deposit REAL DEFAULT 0,
    appt_at TEXT, shot_at TEXT, submitted_at TEXT, short_sent_at TEXT, long_sent_at TEXT,
    deposit_paid_at TEXT, final_paid_at TEXT, settle_via TEXT DEFAULT 'private', remind_at TEXT,
    channel TEXT, partner TEXT, note TEXT, created_at TEXT, updated_at TEXT,
    PRIMARY KEY(mode,id))`);
  device.db.exec(`CREATE TABLE payments(mode TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, kind TEXT, amount REAL, paid_at TEXT, method TEXT, note TEXT)`);
  device.db.exec(`CREATE TABLE settings(scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(scope,key))`);
  device.db.exec(`INSERT INTO orders(mode,id,store,price,appt_at) VALUES('work',1,'v0.4 旧单',1000,'2026-11-01T10:00')`);
  const a=app(device);
  await a.run('nativeOpen()');
  const row=a.run(`Store.conn.db.prepare('SELECT deliver_main,deliver_sub FROM orders WHERE id=1').all()[0]`);
  assert.equal(row.deliver_main,1,'旧单补列缺省应为 1(需要正片)');
  assert.equal(row.deliver_sub,1,'旧单补列缺省应为 1:JSON 层的 v0.4 语义是正副片都要,DEFAULT 0 会静默关掉老单的副片要求');
});

test('催收跟进:满 50 条后计数如实显示,不再把第 51 次报成第 50 次',async()=>{
  const a=app();
  const pad2=n=>String(n).padStart(2,'0');
  const log=Array.from({length:50},(_,i)=>({at:`2026-10-${pad2(1+Math.floor(i/2))}T${i%2?'15:00':'09:00'}`,note:`第 ${i+1} 次`}));
  setState(a,[order({remindLog:log})]);
  a.run('openRemind(1)');
  assert.ok(a.element('#remind-sub').textContent.includes('已催 50+ 次'),'封顶后的计数要显示 50+ 而不是停在 50');
  a.element('#remind-note').value='再问一次';
  a.run('saveRemind()');
  assert.equal(a.run('db.orders[0].remindLog.length'),50,'存储仍只保留最近 50 条');
  assert.ok(a.element('#toast').textContent.includes('最早一条已被挤出'),'封顶后 toast 要说清挤出了最早一条,而不是谎报第 50 次');

  setState(a,[order({remindLog:log.slice(0,3)})]);
  a.run('openRemind(1)');
  assert.ok(a.element('#remind-sub').textContent.includes('已催 3 次'),'未封顶时计数照常');
  a.element('#remind-note').value='';
  a.run('saveRemind()');
  assert.ok(a.element('#toast').textContent.includes('已记录第 4 次催收'),'未封顶时 toast 报真实序号');
});

