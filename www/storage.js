const CAP=(typeof window!=='undefined'&&window.TanjiCap)||null;
const isNative=!!(CAP&&CAP.Capacitor&&CAP.Capacitor.isNativePlatform&&CAP.Capacitor.isNativePlatform());
let db={orders:[],payments:[],threshold:15};
const Store={sqlite3:null,mode:'demo',revision:0,queue:Promise.resolve(),ready:false,busy:false,blocked:false,lockedOut:false,backup:null,status:'正在读取本机数据…',pending:null};
async function acquireWriter(){
  if(isNative)return;
  if(!navigator.locks){Store.lockedOut=true;return}
  await new Promise(resolve=>{
    navigator.locks.request('tanji-data-writer',{ifAvailable:true},async lock=>{
      Store.lockedOut=!lock;resolve();
      if(lock)await new Promise(()=>{});
    }).catch(()=>{Store.lockedOut=true;resolve()});
  });
}
const storageKey=(mode,suffix='json')=>`tanji_v3_${mode}_${suffix}`;
const cloneState=value=>JSON.parse(JSON.stringify(value));
const idb={
  _db:null,_opening:null,
  open(){
    if(this._db)return Promise.resolve(this._db);
    if(this._opening)return this._opening;
    this._opening=new Promise(resolve=>{
      try{
        const request=indexedDB.open('tanji',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('kv');
        request.onsuccess=()=>{this._db=request.result;this._db.onversionchange=()=>{this._db.close();this._db=null};resolve(this._db)};
        request.onerror=request.onblocked=()=>resolve(null);
      }catch(error){resolve(null)}
    }).then(value=>{this._opening=null;return value});
    return this._opening;
  },
  async get(key){
    const database=await this.open();
    if(!database)return {ok:false,value:null};
    return new Promise(resolve=>{
      try{
        const transaction=database.transaction('kv'),request=transaction.objectStore('kv').get(key);
        transaction.oncomplete=()=>resolve({ok:true,value:request.result??null});
        transaction.onerror=transaction.onabort=()=>resolve({ok:false,value:null});
      }catch(error){resolve({ok:false,value:null})}
    });
  },
  async setMany(entries){
    const database=await this.open();
    if(!database)return false;
    return new Promise(resolve=>{
      let transaction;
      try{
        transaction=database.transaction('kv','readwrite');
        transaction.oncomplete=()=>resolve(true);
        transaction.onerror=transaction.onabort=()=>resolve(false);
        for(const [key,value] of entries)transaction.objectStore('kv').put(value,key);
      }catch(error){if(transaction)transaction.abort();resolve(false)}
    });
  }
};
function localRead(key){
  try{const text=localStorage.getItem(key);return {ok:true,value:text===null?null:JSON.parse(text)}}
  catch(error){return {ok:false,value:null}}
}
function localWrite(key,value){
  try{localStorage.setItem(key,JSON.stringify(value));return true}catch(error){return false}
}
function validateState(input){
  if(!input||typeof input!=='object'||!Array.isArray(input.orders)||!Array.isArray(input.payments))throw new Error('备份必须包含订单与收款流水数组');
  // 版本白名单只增不减:0.2~0.4 是老 Web 版备份(无工作流/账号字段,缺省值兜底),
  // 0.5 起带正/副片与送审发布字段,0.6 起带 accounts/providers。旧备份必须继续可导入。
  if(input.version&&!['0.2','0.3','0.4','0.5','0.6'].includes(input.version))throw new Error('暂不支持这个备份版本');
  if(input.v!==undefined&&input.v!==2&&input.v!==3)throw new Error('暂不支持这个数据版本');
  const threshold=input.threshold??input.collectThresholdDays??15;
  if(![7,15,30,45].includes(threshold))throw new Error('催收阈值应为 7、15、30 或 45 天');
  const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&Number.isSafeInteger(Math.round(value*100))&&Math.abs(value*100-Math.round(value*100))<0.00001;
  const text=(value,label,fallback='')=>{if(value==null)return fallback;if(typeof value!=='string')throw new Error(`${label}必须是文本`);return value};
  const dates=['shotAt','submittedAt','shortAt','longAt','depositPaidAt','finalPaidAt','remindAt','publishedAt'];
  const ids=new Set();
  // 账号体系:昵称必填,手机/抖音/头像/标识色可选;头像为本地压缩后的 dataURL。
  // 订单 accountId 指向不存在的账号(如旧备份里删过账号)时归一为 null(未指定),不报错。
  const accountIds=new Set();
  const accounts=(Array.isArray(input.accounts)?input.accounts:[]).map((account,index)=>{
    const label=`第 ${index+1} 个账号`;
    if(!account||!Number.isSafeInteger(account.id)||account.id<1||accountIds.has(account.id))throw new Error(`${label}的 ID 无效或重复`);
    if(typeof account.name!=='string'||!account.name.trim())throw new Error(`${label}缺少昵称`);
    accountIds.add(account.id);
    const clean={id:account.id,name:account.name,
      phone:text(account.phone,`${label}的手机号`),douyin:text(account.douyin,`${label}的抖音账号`),
      color:Number.isSafeInteger(account.color)?Math.max(0,Math.min(7,account.color)):index%8,
      createdAt:text(account.createdAt,`${label}的创建时间`)||null};
    if(account.avatar!=null){
      if(typeof account.avatar!=='string'||(!account.avatar.startsWith('data:image/')&&account.avatar!==''))throw new Error(`${label}的头像数据无效`);
      if(account.avatar.length>200000)throw new Error(`${label}的头像图片过大`);
      clean.avatar=account.avatar;
    }
    return clean;
  });
  const seenProviders=new Set();
  const providers=(Array.isArray(input.providers)?input.providers:[]).filter(p=>{
    if(typeof p!=='string')throw new Error('服务商预设必须是文本');
    const v=p.trim();
    if(!v||seenProviders.has(v))return false;
    seenProviders.add(v);
    return true;
  });

  const orders=input.orders.map((order,index)=>{
    const label=`第 ${index+1} 笔订单`;
    if(!order||!Number.isSafeInteger(order.id)||order.id<1||ids.has(order.id))throw new Error(`${label}的 ID 无效或重复`);
    ids.add(order.id);
    if(typeof order.store!=='string'||!order.store.trim())throw new Error(`${label}缺少商家名称`);
    if(!amount(order.price)||!amount(order.deposit)||order.deposit>order.price)throw new Error(`${label}的总价或定金不合法`);
    if(!validDateTime(order.appt))throw new Error(`${label}的预约时间无效`);
    if(order.settleVia&&!['private','douyin'].includes(order.settleVia))throw new Error(`${label}的结算方式无效`);
    // 工作流字段:正片/副片要求(旧数据无此字段 → 都要,保持 v0.4 前语义)、送审结果、发布时间
    if(order.reviewResult!=null&&!['','pass','fail'].includes(order.reviewResult))throw new Error(`${label}的送审结果无效`);
    const clean={id:order.id,store:order.store,price:Math.round(order.price*100)/100,deposit:Math.round(order.deposit*100)/100,appt:order.appt,settleVia:order.settleVia||'private',
      location:text(order.location,`${label}的地点`),deliverMain:order.deliverMain!==false,deliverSub:order.deliverSub!==false,
      reviewResult:order.reviewResult||'',
      accountId:order.accountId!=null&&accountIds.has(order.accountId)?order.accountId:null};
    for(const field of ['cat','contact','channel','partner','note'])clean[field]=text(order[field],`${label}的${field}`,field==='cat'?'其他':field==='channel'?'直客':'');
    for(const field of dates){if(order[field]!=null&&!validDateTime(order[field]))throw new Error(`${label}的${field}时间无效`);clean[field]=order[field]??null}
    // 随手拍:只存烘焙过淡化的小图(≤12KB 字符);原图不入库,避免备份和全量重写被撑爆
    if(order.photoThumb!=null){
      const ok=typeof TanJiImage!=='undefined'&&TanJiImage.isValidStored(order.photoThumb,TanJiImage.LIMIT.door);
      if(!ok)throw new Error(`${label}的随手拍照片无效或过大`);
      clean.photoThumb=order.photoThumb;
    }
    return clean;
  });
  const payments=input.payments.map((payment,index)=>{
    const label=`第 ${index+1} 笔流水`;
    if(!payment||!ids.has(payment.oid))throw new Error(`${label}找不到对应订单`);
    if(!['定金','尾款'].includes(payment.kind)||!amount(payment.amount)||!validDateTime(payment.at))throw new Error(`${label}的类型、金额或日期无效`);
    if(!['微信','支付宝','银行卡','抖音商单','其他'].includes(payment.method))throw new Error(`${label}的收款方式无效`);
    return {oid:payment.oid,kind:payment.kind,amount:Math.round(payment.amount*100)/100,at:payment.at,method:payment.method,...(payment.note!=null?{note:text(payment.note,`${label}备注`)}:{})};
  });
  // notifyEnabled 是原生端的每日催收通知开关，必须跟着数据一起活过重启，
  // 否则用户关掉提醒后重启 App 又会被静默打开。
  const notifyEnabled=input.notifyEnabled===undefined?true:input.notifyEnabled!==false;
  return {orders,payments,threshold,notifyEnabled,accounts,providers};
}
function setStorageStatus(message){
  if(Store.lockedOut)message='当前为只读：请关闭其他探记标签页后刷新重试；浏览器须支持安全写入锁。';
  Store.status=message;
  const banner=document.querySelector('#storage-status');
  if(banner){banner.hidden=!message;banner.querySelector('span').textContent=message}
}
function snapshot(state=db,mode=Store.mode){
  Store.revision=Math.max(Date.now(),Store.revision+1);
  return {...cloneState(state),v:3,revision:Store.revision,savedAt:new Date().toISOString(),mode};
}
function persistSnapshot(payload){
  if(isNative){
    const write=async()=>{
      const ok=await nativePersistSnapshot(payload);
      // 无论 SQLite 写成功与否都先落一份 localStorage 镜像:它是原生端的第二副本,
      // SQLite 写失败时至少数据还在,下次启动能按修订号取回。
      localWrite(storageKey(payload.mode),payload);
      // 原生端也必须像 Web 一样把写入结果告诉用户：SQLite 写失败若静默吞掉，
      // 用户会以为账目已经存上，实际只留在内存里，一关 App 就没了。
      if(Store.mode===payload.mode&&Store.revision===payload.revision&&!Store.blocked){
        setStorageStatus(ok?'':'保存失败：改动仅在当前页面，请勿关闭，先导出 JSON 备份再重试。');
      }
      return ok;
    };
    Store.queue=Store.queue.then(write,write);
    return Store.queue;
  }
  const localOK=localWrite(storageKey(payload.mode),payload);
  const write=async()=>{
    const entries=[[storageKey(payload.mode),payload]];
    if(payload.previous)entries.push([storageKey(payload.mode,'backup'),payload.previous]);
    const bytes=buildSqliteBytes(payload);
    if(bytes)entries.push([storageKey(payload.mode,'sqlite'),bytes]);
    const indexedOK=await idb.setMany(entries);
    if(Store.mode===payload.mode&&Store.revision===payload.revision&&!Store.blocked){
      setStorageStatus(localOK&&indexedOK?'':localOK||indexedOK?'仅一份本机副本保存成功，请导出备份并重试。':'保存失败：改动仅在当前页面，请勿关闭，先导出 JSON 备份再重试。');
    }
    return localOK||indexedOK;
  };
  Store.queue=Store.queue.then(write,write);
  return Store.queue;
}
function save(){
  if(Store.blocked)return Promise.resolve(false);
  setStorageStatus('正在保存…');
  const payload=snapshot();
  if(Store.backup)payload.previous=Store.backup;
  return persistSnapshot(payload);
}
function persistFull(){return save()}
async function readSnapshot(mode,suffix='json'){
  if(isNative)return nativeReadSnapshot(mode,suffix);
  const key=storageKey(mode,suffix),local=localRead(key),indexed=await idb.get(key);
  const candidates=[];let invalid=false;
  const sources=[local,indexed];
  if(suffix==='backup'){
    const primary=localRead(storageKey(mode));
    if(primary.value?.previous)sources.push({ok:true,value:primary.value.previous});
  }
  for(const source of sources){
    if(source.value===null)continue;
    try{
      const data=validateState(source.value);
      const revision=source.value.revision;
      if(!Number.isSafeInteger(revision)||revision<0)throw new Error('无效修订号');
      candidates.push({...data,v:3,mode,revision,savedAt:source.value.savedAt,previous:source.value.previous??null});
    }catch(error){invalid=true}
  }
  candidates.sort((a,b)=>b.revision-a.revision);
  return {value:candidates[0]||null,uncertain:invalid||!local.ok||!indexed.ok};
}
async function rememberMode(mode){
  if(Store.blocked)return false;
  const value={mode,revision:Date.now()},localOK=localWrite('tanji_v3_mode',value);
  const indexedOK=await idb.setMany([['tanji_v3_mode',value]]);
  return localOK||indexedOK;
}
async function loadState(){
  Store.ready=false;Store.blocked=Store.lockedOut;Store.backup=null;
  const [work,demo,indexedMode]=await Promise.all([readSnapshot('work'),readSnapshot('demo'),idb.get('tanji_v3_mode')]);
  const localMode=localRead('tanji_v3_mode');
  const selected=[localMode.value,indexedMode.value].filter(v=>v&&['work','demo'].includes(v.mode)).sort((a,b)=>b.revision-a.revision)[0];
  let mode=selected?.mode||(work.value||work.uncertain?'work':'demo'),state=mode==='work'?work:demo;
  Store.mode=mode;
  if(!state.value&&mode==='work'&&state.uncertain)return blockLoad();
  if(!work.value&&!demo.value){
    const legacyLocal=localRead('tanji_v2'),legacyOld=localRead('tanstore_v1'),legacyIndexed=await idb.get('json');
    const sources=[legacyLocal,legacyOld,legacyIndexed];
    for(const source of sources){
      if(source.value===null)continue;
      try{
        db=validateState({...source.value,payments:source.value.payments??[]});Store.mode='work';Store.ready=true;
        await save();await rememberMode('work');return true;
      }catch(error){source.ok=false}
    }
    if(sources.some(s=>!s.ok||s.value!==null)||work.uncertain||demo.uncertain)return blockLoad();
  }
  Store.mode=mode;
  if(state.value){db=validateState(state.value);Store.revision=Math.max(Store.revision,state.value.revision);Store.backup=state.value.previous}
  else if(state.uncertain)return blockLoad();
  else db=mode==='work'?{orders:[],payments:[],threshold:15}:demoSeed();
  Store.ready=true;Store.blocked=Store.blocked||state.uncertain;
  setStorageStatus(state.uncertain?'部分本机副本不可读，当前仅供查看；已暂停写入，请先导出备份并重试读取。':'');
  return !!state.value;
}
function blockLoad(){
  Store.blocked=true;Store.ready=true;
  db={orders:[],payments:[],threshold:15};
  setStorageStatus('本机数据读取失败，已暂停写入以保护原数据。请重试，或先导出替换前备份留存。');
  return false;
}
async function switchMode(mode){
  if(Store.busy||Store.blocked||mode===Store.mode)return;
  Store.busy=true;
  try{
    if(!await save())return;
    const target=await readSnapshot(mode);
    if(target.uncertain){setStorageStatus('目标数据读取失败，未切换或覆盖数据。');return}
    if(!await rememberMode(mode)){setStorageStatus('无法保存切换状态，请导出备份后重试。');return}
    Store.mode=mode;db=target.value?validateState(target.value):mode==='work'?{orders:[],payments:[],threshold:15}:demoSeed();
    Store.revision=Math.max(Store.revision,target.value?.revision||0);Store.backup=target.value?.previous||null;
    closeSheets();ui.q='';ui.chip='all';ui.bucket='all';await save();renderAll();showTab('home');Notify.syncDaily();Notify.syncDeliver();
    toast(mode==='work'?'已切换到工作数据':'已切换到独立演示数据，工作数据未改动');
  }finally{Store.busy=false}
}
async function replaceData(state){
  if(Store.busy||Store.blocked)return false;
  const validated=validateState(state);
  // 导入的备份若没带通知开关（比如别的机器导出的 Web 版备份），沿用本机当前设置，
  // 免得一次导入把用户明确关掉的每日催收提醒又打开。
  if(!state||state.notifyEnabled===undefined)validated.notifyEnabled=db.notifyEnabled!==false;
  Store.busy=true;
  try{
    await Store.queue;
    const before=snapshot(),next=snapshot(validated);
    next.previous=before;
    if(!await persistSnapshot(next))return false;
    Store.backup=before;db=validated;closeSheets();ui.q='';ui.chip='all';ui.bucket='all';renderAll();
    return true;
  }finally{Store.busy=false}
}
function backupDocument(state=db){return {app:'探记 TanJi',version:'0.6',exportedAt:new Date().toISOString(),threshold:state.threshold,notifyEnabled:state.notifyEnabled!==false,accounts:cloneState(state.accounts||[]),providers:cloneState(state.providers||[]),orders:cloneState(state.orders),payments:cloneState(state.payments)}}
/* 账号资料一键拷贝文本:昵称/抖音/手机三行,空字段自动跳过(报名表、给服务商用) */
function accountCopyText(account){
  const lines=[];
  if(account.name)lines.push(`昵称:${account.name}`);
  if(account.douyin)lines.push(`抖音:${account.douyin}`);
  if(account.phone)lines.push(`手机:${account.phone}`);
  return lines.join('\n');
}
async function previewImport(file){
  if(!file)return;
  try{
    if(file.size>10*1024*1024)throw new Error('备份文件不能超过 10 MB');
    const state=validateState(JSON.parse((await file.text()).replace(/^\uFEFF/,'')));
    for(const order of state.orders){
      for(const [kind,key,expected] of [['定金','depositPaidAt',order.deposit],['尾款','finalPaidAt',order.price-order.deposit]]){
        const entries=state.payments.filter(p=>p.oid===order.id&&p.kind===kind);
        const total=entries.reduce((sum,p)=>sum+Math.round(p.amount*100),0);
        if(entries.length>1||(entries.length>0&&!order[key])||total!==Math.round((order[key]?expected:0)*100))throw new Error(`订单「${order.store}」的${kind}流水与已收状态不一致，请先核对备份`);
      }
    }
    Store.pending=state;
    const total=state.payments.reduce((sum,p)=>sum+p.amount,0);
    document.querySelector('#import-summary').textContent=`${file.name}：${state.orders.length} 笔订单、${state.payments.length} 笔流水、实收 ${fmtMoney(total)}、催收阈值 ${state.threshold} 天。将替换当前${Store.mode==='work'?'工作':'演示'}数据，替换前自动保存一份本机备份。`;
    showSheet('sheet-import');
  }catch(error){Store.pending=null;toast(`不能导入：${error.message}`)}
}
async function confirmImport(){
  if(!Store.pending||Store.busy)return;
  const state=Store.pending;
  if(await replaceData(state)){Store.pending=null;toast('备份已恢复，替换前数据可在统计页恢复')}
}
async function restoreCheckpoint(){
  if(Store.busy||Store.blocked)return;
  Store.busy=true;
  let saved;
  try{saved=await readSnapshot(Store.mode,'backup')}finally{Store.busy=false}
  if(saved.uncertain){toast('部分备份无法读取，已暂停恢复；请导出替换前备份并重试');return}
  if(!saved.value){toast('没有可用的替换前备份');return}
  if(!confirm(`恢复替换前的 ${saved.value.orders.length} 笔订单和 ${saved.value.payments.length} 笔流水？当前数据将作为新的替换前备份保留。`))return;
  if(await replaceData(saved.value))toast('已恢复替换前数据');
}
async function exportCheckpoint(){
  const mode=Store.mode;
  const saved=await readSnapshot(mode,'backup');
  if(!saved.value){toast('没有可用的替换前备份');return}
  download(`探记-${mode==='work'?'工作':'演示'}-替换前备份.json`,JSON.stringify(backupDocument(saved.value),null,2),'application/json');
  toast('已导出替换前备份，原存储未改动');
}

/* --- 原生:Capacitor SQLite(双数据集:mode 列;settings 以 mode:suffix 为键) --- */
const NATIVE_DB='tanji';
const ORD_COLS=['id','store','category','contact','price','deposit','appt_at','shot_at','submitted_at','short_sent_at','long_sent_at','deposit_paid_at','final_paid_at','settle_via','remind_at','channel','partner','location','deliver_main','deliver_sub','review_result','published_at','account_id','note','created_at','updated_at'];
async function nativeOpen(){
  if(Store.conn)return Store.conn;
  const sqlite=new CAP.SQLiteConnection(CAP.CapacitorSQLite);
  const conn=await sqlite.createConnection(NATIVE_DB,false,'no-encryption',1,false);
  await conn.open();
  // @capacitor-community/sqlite 的 iOS 实现要求 executeSet 的每一项都同时带
  // statement 与 values 两个键，缺 values 会整批 reject；DDL 用空数组占位。
  await conn.executeSet([
    {statement:`CREATE TABLE IF NOT EXISTS orders(
  mode TEXT NOT NULL,
  id INTEGER NOT NULL, store TEXT NOT NULL, category TEXT, contact TEXT,
  price REAL NOT NULL, deposit REAL DEFAULT 0,
  appt_at TEXT, shot_at TEXT, submitted_at TEXT, short_sent_at TEXT, long_sent_at TEXT,
  deposit_paid_at TEXT, final_paid_at TEXT, settle_via TEXT DEFAULT 'private', remind_at TEXT,
  channel TEXT, partner TEXT,
  location TEXT, deliver_main INTEGER DEFAULT 1, deliver_sub INTEGER DEFAULT 0,
  review_result TEXT DEFAULT '', published_at TEXT,
  account_id INTEGER,
  note TEXT, created_at TEXT, updated_at TEXT,
  PRIMARY KEY(mode,id))`,values:[]},
    {statement:`CREATE TABLE IF NOT EXISTS payments(
  mode TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER, kind TEXT, amount REAL, paid_at TEXT, method TEXT, note TEXT)`,values:[]},
    {statement:`CREATE TABLE IF NOT EXISTS accounts(
  mode TEXT NOT NULL,
  id INTEGER NOT NULL, name TEXT NOT NULL, phone TEXT, douyin TEXT,
  color INTEGER DEFAULT 0, avatar TEXT, created_at TEXT,
  PRIMARY KEY(mode,id))`,values:[]},
    {statement:`CREATE TABLE IF NOT EXISTS settings(scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(scope,key))`,values:[]},
  ],true);
  // 旧库升级:v0.5 及之前的库没有工作流/账号新列与新表。重复 ADD COLUMN 会报 duplicate
  // column,逐条吞掉即可;新库建表已含这些列,ALTER 同样报重复,一起吞。
  for(const stmt of [
    'ALTER TABLE orders ADD COLUMN location TEXT',
    'ALTER TABLE orders ADD COLUMN deliver_main INTEGER DEFAULT 1',
    'ALTER TABLE orders ADD COLUMN deliver_sub INTEGER DEFAULT 0',
    `ALTER TABLE orders ADD COLUMN review_result TEXT DEFAULT ''`,
    'ALTER TABLE orders ADD COLUMN published_at TEXT',
    'ALTER TABLE orders ADD COLUMN account_id INTEGER',
  ]){try{await conn.execute(stmt,false)}catch(e){/* 列已存在,忽略 */}}
  Store.conn=conn;
  return conn;
}
function rowToOrder(mode,r){
  return {id:r.id,store:r.store,cat:r.category??'',contact:r.contact??'',price:r.price??0,deposit:r.deposit??0,
    appt:r.appt_at??'',shotAt:r.shot_at??null,submittedAt:r.submitted_at??null,shortAt:r.short_sent_at??null,
    longAt:r.long_sent_at??null,depositPaidAt:r.deposit_paid_at??null,finalPaidAt:r.final_paid_at??null,
    settleVia:r.settle_via||'private',remindAt:r.remind_at??null,channel:r.channel||'直客',partner:r.partner??'',
    location:r.location??'',deliverMain:r.deliver_main!==0,deliverSub:r.deliver_sub!==0,
    reviewResult:r.review_result||'',publishedAt:r.published_at??null,
    accountId:r.account_id??null,
    note:r.note??''};
}
async function nativePersistSnapshot(payload){
  try{
    const conn=await nativeOpen(),ts=new Date().toISOString();
    const set=[
      {statement:'DELETE FROM orders WHERE mode=?',values:[payload.mode]},
      {statement:'DELETE FROM payments WHERE mode=?',values:[payload.mode]},
    ];
    payload.orders.forEach(o=>set.push({statement:`INSERT INTO orders (mode,${ORD_COLS.join(',')}) VALUES (?,${ORD_COLS.map(()=>'?').join(',')})`,values:[payload.mode,o.id,o.store,o.cat||null,o.contact||null,o.price,o.deposit||0,o.appt||null,o.shotAt||null,o.submittedAt||null,o.shortAt||null,o.longAt||null,o.depositPaidAt||null,o.finalPaidAt||null,o.settleVia||'private',o.remindAt||null,o.channel||'直客',o.partner||null,o.location||null,o.deliverMain===false?0:1,o.deliverSub===false?0:1,o.reviewResult||'',o.publishedAt||null,o.accountId||null,o.note||null,ts,ts]}));
    set.push({statement:'DELETE FROM accounts WHERE mode=?',values:[payload.mode]});
    (payload.accounts||[]).forEach(a=>set.push({statement:'INSERT INTO accounts (mode,id,name,phone,douyin,color,avatar,created_at) VALUES (?,?,?,?,?,?,?,?)',values:[payload.mode,a.id,a.name,a.phone||null,a.douyin||null,a.color??0,a.avatar||null,a.createdAt||ts]}));
    payload.payments.forEach(p=>set.push({statement:'INSERT INTO payments (mode,order_id,kind,amount,paid_at,method,note) VALUES (?,?,?,?,?,?,?)',values:[payload.mode,p.oid,p.kind,p.amount,p.at,p.method||null,p.note||null]}));
    const doc={...cloneState(payload),savedAt:ts};
    set.push({statement:'INSERT OR REPLACE INTO settings (scope,key,value) VALUES (?,?,?)',values:[payload.mode,'json',JSON.stringify(doc)]});
    if(payload.previous)set.push({statement:'INSERT OR REPLACE INTO settings (scope,key,value) VALUES (?,?,?)',values:[payload.mode,'backup',JSON.stringify(payload.previous)]});
    await conn.executeSet(set,true);
    return true;
  }catch(e){console.error('[TanJi] SQLite 写入失败',e);return false}
}
async function nativeReadSnapshot(mode,suffix='json'){
  try{
    const conn=await nativeOpen();
    if(suffix==='backup'){
      const r=await conn.query('SELECT value FROM settings WHERE scope=? AND key=?',[mode,'backup']);
      const raw=(r.values||[])[0];
      return {value:raw?JSON.parse(raw.value):null,uncertain:false};
    }
    // 原生端的第二副本是 localStorage 镜像(Web 版是 IndexedDB)。
    // 两份都读,按修订号取较新的一份:SQLite 写失败或落后时,下次启动仍能拿回数据。
    const sources=[];
    const r=await conn.query('SELECT value FROM settings WHERE scope=? AND key=?',[mode,'json']);
    const raw=(r.values||[])[0];
    if(raw)sources.push(raw.value);
    const mirror=localRead(storageKey(mode));
    if(mirror.ok&&mirror.value!==null)sources.push(mirror.value);
    const candidates=[];
    for(const source of sources){
      try{
        const parsed=typeof source==='string'?JSON.parse(source):source;
        const data=validateState(parsed);
        const revision=parsed.revision;
        if(!Number.isSafeInteger(revision)||revision<0)throw new Error('无效修订号');
        candidates.push({...data,v:3,mode,revision,savedAt:parsed.savedAt||null,previous:parsed.previous||null});
      }catch(error){console.warn('[TanJi] 副本内容无效,已跳过',error)}
    }
    if(!candidates.length)return {value:null,uncertain:sources.length>0};
    candidates.sort((a,b)=>b.revision-a.revision);
    return {value:candidates[0],uncertain:false};
  }catch(e){
    console.error('[TanJi] SQLite 读取失败',e);
    // SQLite 整个读不了时退回镜像;但无从得知 SQLite 里是否存着更新的数据,
    // 故标记 uncertain 暂停写入,让用户先导出备份,别用旧镜像盖掉新数据。
    try{
      const mirror=localRead(storageKey(mode));
      if(mirror.ok&&mirror.value){
        const parsed=mirror.value;
        const data=validateState(parsed);
        return {value:{...data,v:3,mode,revision:parsed.revision||0,savedAt:parsed.savedAt||null,previous:parsed.previous||null},uncertain:true};
      }
    }catch(e2){}
    return {value:null,uncertain:true};
  }
}

/* ================= 本地通知(仅 iOS 原生生效) =================
 * 每日 09:00 催收汇总(只报条数与最长天数,不含金额);
 * snooze 备忘在原生环境升级为一次性系统通知。
 * 通知 id:每日汇总=1;单订单催收=100000+orderId*100+天数;出片提醒=300000+orderId。 ================= */

/* ---- 出片要求(工作流 v0.5):规则实现在 logic.js,这里保留同名薄包装 ----
 * 业务规则统一收敛到 www/logic.js(纯函数),storage.js 只负责持久化与通知。 */
const needMain=o=>TanJiLogic.needMain(o);
const needSub=o=>TanJiLogic.needSub(o);
const deliveredAll=o=>TanJiLogic.deliveredAll(o);

const Notify={
  native(){return isNative&&CAP&&CAP.LocalNotifications},
  async ensurePermission(){
    const L=CAP.LocalNotifications;
    let p=await L.checkPermissions();
    if(p.display!=='granted')p=await L.requestPermissions();
    return p.display==='granted';
  },
  async syncDaily(){
    if(!this.native())return;
    try{
      const L=CAP.LocalNotifications;
      const pend=await L.getPending();
      const oldDaily=(pend.notifications||[]).filter(n=>+n.id===1);
      if(oldDaily.length)await L.cancel({notifications:oldDaily});
      const over=db.orders.filter(o=>isOver(o)&&!snoozed(o));
      if(!over.length||db.notifyEnabled===false)return;
      if(!await this.ensurePermission())return;
      const maxD=Math.max(...over.map(overdueDays));
      await L.schedule({notifications:[{
        id:1,title:'探记 · 尾款催收',
        body:`${over.length} 笔尾款已逾期，最长 ${maxD} 天 —— 今日安排一次跟进`,
        schedule:{on:{hour:9,minute:0},repeats:true,allowWhileIdle:true},
      }]});
    }catch(e){console.warn('[TanJi] 催收提醒排程失败',e)}
  },
  // 出片提醒:拍摄完成 +24h 仍未出齐(按该单的正/副片配置) → 一次性本地通知。
  // 已超期的不再排(应用内列表有红色角标),出齐/删单/清除拍摄时间后重排即撤销。
  async syncDeliver(){
    if(!this.native())return;
    try{
      const L=CAP.LocalNotifications;
      const pend=await L.getPending();
      const mine=(pend.notifications||[]).filter(n=>+n.id>=300000&&+n.id<400000);
      if(mine.length)await L.cancel({notifications:mine});
      if(!await this.ensurePermission())return;
      const now=Date.now();
      const list=db.orders
        .filter(o=>o.shotAt&&!deliveredAll(o))
        .map(o=>({o,at:new Date(new Date(o.shotAt).getTime()+864e5)}))
        .filter(x=>!isNaN(x.at.getTime())&&x.at.getTime()>now);
      if(!list.length)return;
      await L.schedule({notifications:list.map(({o,at})=>({
        id:300000+o.id,title:'探记 · 出片提醒',
        body:`「${o.store}」拍摄已超 24 小时,还有片子没出齐,记得跟进`,
        schedule:{at,allowWhileIdle:true},
      }))});
    }catch(e){console.warn('[TanJi] 出片提醒排程失败',e)}
  },
  async scheduleSnooze(o,d){
    if(!this.native())return;
    try{
      if(!await this.ensurePermission())return;
      const L=CAP.LocalNotifications;
      const pend=await L.getPending();
      const mine=(pend.notifications||[]).filter(n=>{const v=+n.id-100000;return v>=0&&Math.floor(v/100)===o.id&&v%100!==0});
      if(mine.length)await L.cancel({notifications:mine});
      const at=new Date(o.remindAt);
      if(isNaN(at))return;
      await L.schedule({notifications:[{
        id:100000+o.id*100+d,title:'探记 · 催收跟进',
        body:`「${o.store}」尾款该跟进了（${d} 天前设置的提醒）`,
        schedule:{at,allowWhileIdle:true},
      }]});
    }catch(e){console.warn('[TanJi] 单次提醒排程失败',e)}
  },
  async cancelAll(){
    if(!this.native())return;
    try{
      const L=CAP.LocalNotifications,pend=await L.getPending();
      const ours=(pend.notifications||[]).filter(n=>+n.id===1||+n.id>=100000);
      if(ours.length)await L.cancel({notifications:ours});
    }catch(e){}
  },
  async cancelOrder(id){
    if(!this.native())return;
    try{
      const L=CAP.LocalNotifications,pend=await L.getPending();
      const mine=(pend.notifications||[]).filter(n=>{const v=+n.id-100000;return (v>=0&&v<200000&&Math.floor(v/100)===+id&&v%100!==0)||+n.id===300000+(+id)});
      if(mine.length)await L.cancel({notifications:mine});
    }catch(e){}
  },
  async toggle(){
    db.notifyEnabled=(db.notifyEnabled===false);
    save();renderAll();
    if(db.notifyEnabled!==false)await this.syncDaily();
    else await this.cancelAll();
    toast(db.notifyEnabled!==false?'已开启每日催收提醒（每天 09:00）':'已关闭每日催收提醒');
  }
};
