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
    if(!elements.has(selector))elements.set(selector,{value:'',innerHTML:'',textContent:'',hidden:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelector:child=>element(selector+' '+child),addEventListener(){},focus(){},setSelectionRange(){},click(){},getContext:()=>new Proxy({fillText:text=>texts.push(text),createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>target[key]||(()=>{})}),toBlob:callback=>callback(new Blob(['image']))});
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
  run(storage+'\n'+script.slice(0,script.indexOf('/* ================= 启动')));
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
  depositPaidAt:null,finalPaidAt:null,remindAt:null,note:'',...overrides,
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

/* ---------- 通知与数据变更同步 ---------- */

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

test('清除催收备忘应撤销已排程的本地通知',async()=>{
  const a=app();
  setState(a,[OVERDUE]);
  await a.run('save()');
  await a.run('loadState()');
  a.run("db.orders[0].remindAt='2026-11-25T09:00';Notify.scheduleSnooze(db.orders[0],1);");
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id>=100000).length,1,'备忘应排一个一次性通知');

  a.run("db.orders[0].remindAt=null;Notify.cancelOrder(db.orders[0].id);");
  await tick();
  assert.equal(a.device.pending.filter(n=>+n.id>=100000).length,0,'清除备忘后不应残留通知');
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
