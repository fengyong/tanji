let db={orders:[],payments:[],threshold:15};
const Store={sqlite3:null,mode:'demo',revision:0,queue:Promise.resolve(),ready:false,busy:false,blocked:false,lockedOut:false,backup:null,status:'正在读取本机数据…',pending:null};
async function acquireWriter(){
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
  if(input.version&&!['0.2','0.3','0.4'].includes(input.version))throw new Error('暂不支持这个备份版本');
  if(input.v!==undefined&&input.v!==2&&input.v!==3)throw new Error('暂不支持这个数据版本');
  const threshold=input.threshold??input.collectThresholdDays??15;
  if(![7,15,30,45].includes(threshold))throw new Error('催收阈值应为 7、15、30 或 45 天');
  const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&Number.isSafeInteger(Math.round(value*100))&&Math.abs(value*100-Math.round(value*100))<0.00001;
  const text=(value,label,fallback='')=>{if(value==null)return fallback;if(typeof value!=='string')throw new Error(`${label}必须是文本`);return value};
  const dates=['shotAt','submittedAt','shortAt','longAt','depositPaidAt','finalPaidAt','remindAt'];
  const ids=new Set();
  const orders=input.orders.map((order,index)=>{
    const label=`第 ${index+1} 笔订单`;
    if(!order||!Number.isSafeInteger(order.id)||order.id<1||ids.has(order.id))throw new Error(`${label}的 ID 无效或重复`);
    ids.add(order.id);
    if(typeof order.store!=='string'||!order.store.trim())throw new Error(`${label}缺少商家名称`);
    if(!amount(order.price)||!amount(order.deposit)||order.deposit>order.price)throw new Error(`${label}的总价或定金不合法`);
    if(!validDateTime(order.appt))throw new Error(`${label}的预约时间无效`);
    if(order.settleVia&&!['private','douyin'].includes(order.settleVia))throw new Error(`${label}的结算方式无效`);
    const clean={id:order.id,store:order.store,price:Math.round(order.price*100)/100,deposit:Math.round(order.deposit*100)/100,appt:order.appt,settleVia:order.settleVia||'private'};
    for(const field of ['cat','contact','channel','partner','note'])clean[field]=text(order[field],`${label}的${field}`,field==='cat'?'其他':field==='channel'?'直客':'');
    for(const field of dates){if(order[field]!=null&&!validDateTime(order[field]))throw new Error(`${label}的${field}时间无效`);clean[field]=order[field]??null}
    return clean;
  });
  const payments=input.payments.map((payment,index)=>{
    const label=`第 ${index+1} 笔流水`;
    if(!payment||!ids.has(payment.oid))throw new Error(`${label}找不到对应订单`);
    if(!['定金','尾款'].includes(payment.kind)||!amount(payment.amount)||!validDateTime(payment.at))throw new Error(`${label}的类型、金额或日期无效`);
    if(!['微信','支付宝','银行卡','抖音商单','其他'].includes(payment.method))throw new Error(`${label}的收款方式无效`);
    return {oid:payment.oid,kind:payment.kind,amount:Math.round(payment.amount*100)/100,at:payment.at,method:payment.method,...(payment.note!=null?{note:text(payment.note,`${label}备注`)}:{})};
  });
  return {orders,payments,threshold};
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
    closeSheets();ui.q='';ui.chip='all';ui.bucket='all';await save();renderAll();showTab('home');
    toast(mode==='work'?'已切换到工作数据':'已切换到独立演示数据，工作数据未改动');
  }finally{Store.busy=false}
}
async function replaceData(state){
  if(Store.busy||Store.blocked)return false;
  const validated=validateState(state);
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
function backupDocument(state=db){return {app:'探记 TanJi',version:'0.4',exportedAt:new Date().toISOString(),threshold:state.threshold,orders:cloneState(state.orders),payments:cloneState(state.payments)}}
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
