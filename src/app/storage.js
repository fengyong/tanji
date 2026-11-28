/* P0 §3 机械改动 1:CAP/isNative 上移 env.js,本模块改从那里 import。 */
import {CAP,isNative} from './env.js';
import {fmtMoney,validDateTime} from './util.js';
import {demoSeed} from './demo.js';
export const ACCOUNT_LEVELS=['Lv.5','Lv.6','Lv.7'];
export const DEFAULT_MEDAL_RULES={busyOrders:3,salesAmount:1000,hotOrders:5,aceAmount:2500};
const isMoneyAmount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&Number.isSafeInteger(Math.round(value*100))&&Math.abs(value*100-Math.round(value*100))<0.00001;
export function validateMedalRules(input=DEFAULT_MEDAL_RULES){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('勋章门槛格式无效');
  const count=(key,label)=>{const value=input[key]??DEFAULT_MEDAL_RULES[key];if(!Number.isSafeInteger(value)||value<1)throw new Error(`${label}必须是大于 0 的整数`);return value};
  const money=(key,label)=>{const value=input[key]??DEFAULT_MEDAL_RULES[key];if(!isMoneyAmount(value)||value<=0)throw new Error(`${label}必须是大于 0 的金额`);return Math.round(value*100)/100};
  const rules={busyOrders:count('busyOrders','忙碌日单数'),salesAmount:money('salesAmount','千元日金额'),hotOrders:count('hotOrders','爆单单数'),aceAmount:money('aceAmount','王牌日金额')};
  if(rules.hotOrders<=rules.busyOrders)throw new Error('爆单单数必须大于忙碌日单数');
  if(rules.aceAmount<rules.salesAmount)throw new Error('王牌日金额不能低于千元日金额');
  return rules;
}
export let db={orders:[],payments:[],threshold:15,medalRules:{...DEFAULT_MEDAL_RULES}};
export const Store={sqlite3:null,mode:'demo',revision:0,queue:Promise.resolve(),ready:false,busy:false,blocked:false,lockedOut:false,backup:null,status:'正在读取本机数据…',pending:null};
/* P1-T1 组合根注入(消除 globalThis 挂回):
   afterLoad = loadState/switchMode/replaceData 后的 UI 刷新(renderAll/showTab);
   bytesBuilder = SQLite 字节构建(buildSqliteBytes 的实现住在 sqlite-bytes.js,
   它 import 本模块,不能反向 import —— 注入是单向依赖下唯一合法的回调通道)。 */
let afterLoad=null,bytesBuilder=null;
export function registerStorageHooks(hooks){afterLoad=hooks}
export function registerBytesBuilder(fn){bytesBuilder=fn}

export async function acquireWriter(){
  if(isNative)return;
  if(!navigator.locks){Store.lockedOut=true;return}
  await new Promise(resolve=>{
    navigator.locks.request('tanji-data-writer',{ifAvailable:true},async lock=>{
      Store.lockedOut=!lock;resolve();
      if(lock)await new Promise(()=>{});
    }).catch(()=>{Store.lockedOut=true;resolve()});
  });
}
export const storageKey=(mode,suffix='json')=>`tanji_v3_${mode}_${suffix}`;
export const cloneState=value=>JSON.parse(JSON.stringify(value));
export const idb={
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
export function validateState(input){
  if(!input||typeof input!=='object'||!Array.isArray(input.orders)||!Array.isArray(input.payments))throw new Error('备份必须包含订单与收款流水数组');
  // 版本白名单只增不减:0.2~0.4 是老 Web 版备份(无工作流/账号字段,缺省值兜底),
  // 0.5 起带正/副片与送审发布字段,0.6 起带 accounts/providers。旧备份必须继续可导入。
  if(input.version&&!['0.2','0.3','0.4','0.5','0.6'].includes(input.version))throw new Error('暂不支持这个备份版本');
  if(input.v!==undefined&&input.v!==2&&input.v!==3)throw new Error('暂不支持这个数据版本');
  const threshold=input.threshold??input.collectThresholdDays??15;
  if(![7,15,30,45].includes(threshold))throw new Error('催收阈值应为 7、15、30 或 45 天');
  const amount=isMoneyAmount;
  const medalRules=validateMedalRules(input.medalRules);
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
    if(account.level!=null&&!ACCOUNT_LEVELS.includes(account.level))throw new Error(`${label}的等级应为 Lv.5、Lv.6 或 Lv.7`);
    accountIds.add(account.id);
    const clean={id:account.id,name:account.name,level:ACCOUNT_LEVELS.includes(account.level)?account.level:'Lv.5',
      phone:text(account.phone,`${label}的手机号`),douyin:text(account.douyin,`${label}的抖音账号`),
      color:Number.isSafeInteger(account.color)?Math.max(0,Math.min(7,account.color)):index%8,
      createdAt:text(account.createdAt,`${label}的创建时间`)||null};
    if(account.avatar!=null){
      // 与随手拍同一套严格口径(MIME/字符集/体积):头像会被原样拼进 <img src="…">,
      // 只查前缀的话,带引号和事件属性的字符串能从一份备份一路走到 innerHTML。
      // 空串是老备份的合法值,继续放行。
      if(typeof account.avatar!=='string'||(account.avatar!==''&&!(typeof TanJiImage!=='undefined'&&TanJiImage.isValidStored(account.avatar))))throw new Error(`${label}的头像数据无效`);
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
    // 上界与新建订单(saveOrder)同口径:NOTIFY_OFFSET 分段要求 orderId<100000,只拦新建不拦导入的话,
    // 手工构造的备份能带进高单号——备忘段会撞进出片段、work 段会撞进 demo 段,分段防线整体失效
    if(!order||!Number.isSafeInteger(order.id)||order.id<1||order.id>=100000||ids.has(order.id))throw new Error(`${label}的 ID 无效、重复或超过上限(99999)`);
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
    // 平台单预计到账日:与其它日期同样校验,但缺省时不造键(旧备份原样往返)
    if(order.expectPayAt!=null&&order.expectPayAt!==''){
      if(!validDateTime(order.expectPayAt))throw new Error(`${label}的预计到账时间无效`);
      clean.expectPayAt=order.expectPayAt;
    }
    // 催收跟进痕迹 [{at,note}]:附加信息,坏条目丢弃不抛错(与到店定位一致),
    // 否则一条记录时间写坏就让整份备份读不出来。只留最近 50 条,避免无界增长。
    if(Array.isArray(order.remindLog))clean.remindLog=cloneState(order.remindLog)
      .filter(entry=>entry&&validDateTime(entry.at))
      .map(entry=>({at:entry.at,note:typeof entry.note==='string'?entry.note.slice(0,200):''}))
      .slice(-50);
    // 随手拍:只存烘焙过淡化的小图(≤12KB 字符);原图不入库,避免备份和全量重写被撑爆
    if(order.photoThumb!=null){
      const ok=typeof TanJiImage!=='undefined'&&TanJiImage.isValidStored(order.photoThumb,TanJiImage.LIMIT.door);
      if(!ok)throw new Error(`${label}的随手拍照片无效或过大`);
      clean.photoThumb=order.photoThumb;
    }
    // 到店定位:固定 `lat,lng`(geo.js 负责解析)。这里只做归一,脏值丢弃不抛错 ——
    // 位置是附加信息,不能因为一条坏坐标就让整份快照读不出来。
    if(typeof order.gpsPlace==='string'&&order.gpsPlace.trim()){
      const place=order.gpsPlace.trim();
      if(typeof TanJiGeo!=='undefined'&&TanJiGeo.isValid(place))clean.gpsPlace=place;
      else console.warn(`[TanJi] ${label}的到店定位格式无效,已忽略`,place);
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
  return {orders,payments,threshold,notifyEnabled,accounts,providers,medalRules};
}
export function setStorageStatus(message){
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
      const localOK=localWrite(storageKey(payload.mode),payload);
      // 原生端也必须像 Web 一样把写入结果告诉用户：SQLite 写失败若静默吞掉，
      // 用户会以为账目已经存上，实际只留在内存里，一关 App 就没了。
      // 第二副本写失败(本机存储空间可能已满)同样要说:双副本是这套存储的安全承诺,
      // 悄悄退化成单副本,用户却以为有两份保险。
      if(Store.mode===payload.mode&&Store.revision===payload.revision&&!Store.blocked){
        if(!ok)setStorageStatus('保存失败：改动仅在当前页面，请勿关闭，先导出 JSON 备份再重试。');
        else if(!localOK)setStorageStatus('第二副本保存失败（本机存储空间可能已满）：改动已写进数据库，但备份副本没写成。请先导出 JSON 备份，并清理本机空间。');
        else setStorageStatus('');
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
    const bytes=bytesBuilder?bytesBuilder(payload):null;
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
export function save(){
  if(Store.blocked)return Promise.resolve(false);
  setStorageStatus('正在保存…');
  const payload=snapshot();
  if(Store.backup)payload.previous=Store.backup;
  return persistSnapshot(payload);
}
export function persistFull(){return save()}
export async function readSnapshot(mode,suffix='json'){
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
/* P3:Store 布尔旗标的显式状态视图(只读派生,不改控制流)。
   状态图:loading → ready ⇄ writing;ready/writing 可转 read-only(blocked);
   locked-out 是终态(多 Tab 抢锁失败,只能刷新页面)。
   不变量:lockedOut ⇒ blocked(写锁丢了写入必须停)。 */
export function storePhase(){
  if(Store.lockedOut)return 'locked-out';
  if(!Store.ready)return 'loading';
  if(Store.blocked)return 'read-only';
  return Store.busy?'writing':'ready';
}

export async function loadState(){
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
        // 返回值要照实:blocked(Web 多 Tab 抢锁失败)时 save/rememberMode 都是 false,
        // 却 return true 会谎报迁移成功 —— 旧数据只加载进内存(只读),下次启动还会再走一遍
        const saved=await save();
        if(saved)await rememberMode('work');
        return saved;
      }catch(error){source.ok=false}
    }
    if(sources.some(s=>!s.ok||s.value!==null)||work.uncertain||demo.uncertain)return blockLoad();
  }
  Store.mode=mode;
  if(state.value){db=validateState(state.value);Store.revision=Math.max(Store.revision,state.value.revision);Store.backup=state.value.previous}
  else if(state.uncertain)return blockLoad();
  else db=mode==='work'?{orders:[],payments:[],threshold:15,notifyEnabled:true,accounts:[],providers:[],medalRules:{...DEFAULT_MEDAL_RULES}}:{...demoSeed(),notifyEnabled:true,accounts:[],providers:[],medalRules:{...DEFAULT_MEDAL_RULES}};
  Store.ready=true;Store.blocked=Store.blocked||state.uncertain;
  setStorageStatus(state.uncertain?'部分本机副本不可读，当前仅供查看；已暂停写入，请先导出备份并重试读取。':'');
  return !!state.value;
}
function blockLoad(){
  Store.blocked=true;Store.ready=true;
  db={orders:[],payments:[],threshold:15,notifyEnabled:true,accounts:[],providers:[],medalRules:{...DEFAULT_MEDAL_RULES}};
  setStorageStatus('本机数据读取失败，已暂停写入以保护原数据。请重试，或先导出替换前备份留存。');
  return false;
}
export async function switchMode(mode){
  if(Store.busy||Store.blocked||mode===Store.mode)return;
  Store.busy=true;
  try{
    if(!await save())return;
    const target=await readSnapshot(mode);
    if(target.uncertain){setStorageStatus('目标数据读取失败，未切换或覆盖数据。');return}
    if(!await rememberMode(mode)){setStorageStatus('无法保存切换状态，请导出备份后重试。');return}
    Store.mode=mode;db=target.value?validateState(target.value):mode==='work'?{orders:[],payments:[],threshold:15,notifyEnabled:true,accounts:[],providers:[],medalRules:{...DEFAULT_MEDAL_RULES}}:{...demoSeed(),notifyEnabled:true,accounts:[],providers:[],medalRules:{...DEFAULT_MEDAL_RULES}};
    Store.revision=Math.max(Store.revision,target.value?.revision||0);Store.backup=target.value?.previous||null;
    afterLoad&&afterLoad.closeSheets();afterLoad&&afterLoad.resetFilters();await save();afterLoad&&(afterLoad.renderAll(),afterLoad.showTab('home'));afterLoad&&(afterLoad.notify.syncDaily(),afterLoad.notify.syncDeliver());
    afterLoad&&afterLoad.toast('已切换数据空间，原数据未改动');
  }finally{Store.busy=false}
}
export async function replaceData(state){
  if(Store.busy||Store.blocked)return false;
  const validated=validateState(state);
  // 导入的备份若没带通知开关（比如别的机器导出的 Web 版备份），沿用本机当前设置，
  // 免得一次导入把用户明确关掉的每日催收提醒又打开。
  if(!state||state.notifyEnabled===undefined)validated.notifyEnabled=db.notifyEnabled!==false;
  if(!state||state.medalRules===undefined)validated.medalRules={...(db.medalRules||DEFAULT_MEDAL_RULES)};
  Store.busy=true;
  try{
    await Store.queue;
    const before=snapshot(),next=snapshot(validated);
    next.previous=before;
    if(!await persistSnapshot(next)){
      // SQLite 写失败时内存仍是替换前的数据,但 nativePersistSnapshot 之后的那次镜像写入
      // 不受影响 —— 镜像里已经是新数据、修订号还更大,下次启动按修订号取镜像:
      // 这次「失败」的导入就静默生效了。把镜像退回替换前那份,保证「失败 = 哪里都没变」。
      // (Web 端要两份副本都写失败才会走到这里,没有可退的残留。)
      if(isNative)localWrite(storageKey(Store.mode),before);
      setStorageStatus('替换失败：数据未被改动。请重试；持续失败请先导出 JSON 备份。');
      return false;
    }
    Store.backup=before;db=validated;afterLoad&&afterLoad.closeSheets();afterLoad&&afterLoad.resetFilters();afterLoad&&afterLoad.renderAll();
    // 数据被整体替换(导入/恢复/清空)后,已排的通知还指着旧数据:已删订单的备忘、
    // 出片提醒会在半夜凭空响起来。先撤掉当前模式的通知,再按新数据重排每日汇总与出片提醒。
    // 只撤当前模式:另一套数据(work/demo)没被替换,它的通知仍然有效。
    if(afterLoad){await afterLoad.notify.cancelMode();afterLoad.notify.syncDaily();afterLoad.notify.syncDeliver()}
    // 催收备忘要按新数据重排:数据里还带着 remindAt 的单,若只撤不排,
    // 它会被 snoozed 排除出催收清单、同时永远收不到提醒 —— 这笔钱就从视野里消失了。
    // 只排仍然有效的(remindAt 在未来);已过期的留着数据,等用户下次设置再排。
    const stamp=TanJiLogic.nowStr();
    for(const o of (validated.orders||[])){
      if(!o.remindAt)continue;
      // 备忘只对「尾款仍待收的私收单」有意义。已结清 / 平台单带着的 remindAt 是旧数据里的残留:
      // 既不排(会为一笔不欠钱的单弹「尾款该跟进了」),也顺手归一为空(与悬空 accountId 同一口径)——
      // 否则详情页挂着「已设提醒」,却没有清除入口。
      if(o.settleVia==='douyin'||TanJiLogic.unFin(o,validated.payments)<=0){o.remindAt=null;continue}
      if(o.remindAt>stamp)afterLoad&&afterLoad.notify.scheduleSnooze(o);
    }
    return true;
  }finally{Store.busy=false}
}
export function backupDocument(state=db){return {app:'探记 TanJi',version:'0.6',exportedAt:new Date().toISOString(),threshold:state.threshold,notifyEnabled:state.notifyEnabled!==false,accounts:cloneState(state.accounts||[]),providers:cloneState(state.providers||[]),medalRules:cloneState(state.medalRules||DEFAULT_MEDAL_RULES),orders:cloneState(state.orders),payments:cloneState(state.payments)}}
/* 账号资料一键拷贝文本:昵称/等级/抖音/手机,空字段自动跳过。 */
export function accountCopyText(account){
  const lines=[];
  if(account.name)lines.push(`昵称:${account.name}`);
  lines.push(`等级:${ACCOUNT_LEVELS.includes(account.level)?account.level:'Lv.5'}`);
  if(account.douyin)lines.push(`抖音:${account.douyin}`);
  if(account.phone)lines.push(`手机:${account.phone}`);
  return lines.join('\n');
}
/* --- 原生:Capacitor SQLite(双数据集:mode 列;settings 以 mode:suffix 为键) --- */
const NATIVE_DB='tanji';
const ORD_COLS=['id','store','category','contact','price','deposit','appt_at','shot_at','submitted_at','short_sent_at','long_sent_at','deposit_paid_at','final_paid_at','settle_via','remind_at','channel','partner','location','gps_place','deliver_main','deliver_sub','review_result','published_at','account_id','note','remind_log','expect_pay_at','created_at','updated_at'];
let nativeOpening=null;
export async function nativeOpen(){
  if(Store.conn)return Store.conn;
  if(nativeOpening)return nativeOpening;
  nativeOpening=(async()=>{
    const sqlite=new CAP.SQLiteConnection(CAP.CapacitorSQLite);
    let conn;
    try{
      conn=await sqlite.createConnection(NATIVE_DB,false,'no-encryption',1,false);
    }catch(error){
      if(!/already exists/i.test(String(error?.message||error)))throw error;
      console.warn('[TanJi] SQLite 存在页面重载前的残留连接，关闭后重建',error);
      await sqlite.closeConnection(NATIVE_DB,false);
      conn=await sqlite.createConnection(NATIVE_DB,false,'no-encryption',1,false);
    }
    try{
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
  location TEXT, gps_place TEXT, deliver_main INTEGER DEFAULT 1, deliver_sub INTEGER DEFAULT 1,
  review_result TEXT DEFAULT '', published_at TEXT,
  account_id INTEGER,
  note TEXT, remind_log TEXT, expect_pay_at TEXT, created_at TEXT, updated_at TEXT,
  PRIMARY KEY(mode,id))`,values:[]},
        {statement:`CREATE TABLE IF NOT EXISTS payments(
  mode TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER, kind TEXT, amount REAL, paid_at TEXT, method TEXT, note TEXT)`,values:[]},
        {statement:`CREATE TABLE IF NOT EXISTS accounts(
  mode TEXT NOT NULL,
  id INTEGER NOT NULL, name TEXT NOT NULL, level TEXT DEFAULT 'Lv.5', phone TEXT, douyin TEXT,
  color INTEGER DEFAULT 0, avatar TEXT, created_at TEXT,
  PRIMARY KEY(mode,id))`,values:[]},
        {statement:`CREATE TABLE IF NOT EXISTS settings(scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(scope,key))`,values:[]},
      ],true);
      // 旧库升级:v0.5 及之前的库没有工作流/账号新列与新表。重复 ADD COLUMN 会报 duplicate
      // column,逐条吞掉即可;新库建表已含这些列,ALTER 同样报重复,一起吞。
      for(const stmt of [
        'ALTER TABLE orders ADD COLUMN location TEXT',
        'ALTER TABLE orders ADD COLUMN gps_place TEXT',
        'ALTER TABLE orders ADD COLUMN deliver_main INTEGER DEFAULT 1',
        // 缺省必须是 1:v0.4 前的旧单语义是正副片都要(DEFAULT 0 会把老单的副片要求静默关掉)
        'ALTER TABLE orders ADD COLUMN deliver_sub INTEGER DEFAULT 1',
        `ALTER TABLE orders ADD COLUMN review_result TEXT DEFAULT ''`,
        'ALTER TABLE orders ADD COLUMN published_at TEXT',
        'ALTER TABLE orders ADD COLUMN account_id INTEGER',
        'ALTER TABLE orders ADD COLUMN remind_log TEXT',
        'ALTER TABLE orders ADD COLUMN expect_pay_at TEXT',
        `ALTER TABLE accounts ADD COLUMN level TEXT DEFAULT 'Lv.5'`,
      ]){try{await conn.execute(stmt,false)}catch(e){if(!/duplicate column name/i.test(String(e?.message||e)))throw e}}
    }catch(error){
      try{await sqlite.closeConnection(NATIVE_DB,false)}
      catch(cleanupError){console.error('[TanJi] SQLite 失败连接清理失败',cleanupError)}
      throw error;
    }
    Store.conn=conn;
    return conn;
  })();
  try{return await nativeOpening}
  finally{nativeOpening=null}
}
export function parseRemindLog(raw){
  if(raw==null||raw==='')return [];
  try{const value=typeof raw==='string'?JSON.parse(raw):raw;return Array.isArray(value)?value:[]}
  catch(e){console.warn('[TanJi] 催收跟进列内容无法解析,已忽略',e);return []}
}
function rowToOrder(mode,r){
  const remindLog=parseRemindLog(r.remind_log);
  return {id:r.id,store:r.store,cat:r.category??'',contact:r.contact??'',price:r.price??0,deposit:r.deposit??0,
    appt:r.appt_at??'',shotAt:r.shot_at??null,submittedAt:r.submitted_at??null,shortAt:r.short_sent_at??null,
    longAt:r.long_sent_at??null,depositPaidAt:r.deposit_paid_at??null,finalPaidAt:r.final_paid_at??null,
    settleVia:r.settle_via||'private',remindAt:r.remind_at??null,channel:r.channel||'直客',partner:r.partner??'',
    location:r.location??'',gpsPlace:r.gps_place??null,deliverMain:r.deliver_main!==0,deliverSub:r.deliver_sub!==0,
    reviewResult:r.review_result||'',publishedAt:r.published_at??null,
    accountId:r.account_id??null,
    ...(remindLog.length?{remindLog}:{}),
    expectPayAt:r.expect_pay_at??null,
    note:r.note??''};
}
async function nativePersistSnapshot(payload){
  try{
    const conn=await nativeOpen(),ts=new Date().toISOString();
    const set=[
      {statement:'DELETE FROM orders WHERE mode=?',values:[payload.mode]},
      {statement:'DELETE FROM payments WHERE mode=?',values:[payload.mode]},
    ];
    payload.orders.forEach(o=>set.push({statement:`INSERT INTO orders (mode,${ORD_COLS.join(',')}) VALUES (?,${ORD_COLS.map(()=>'?').join(',')})`,values:[payload.mode,o.id,o.store,o.cat||null,o.contact||null,o.price,o.deposit||0,o.appt||null,o.shotAt||null,o.submittedAt||null,o.shortAt||null,o.longAt||null,o.depositPaidAt||null,o.finalPaidAt||null,o.settleVia||'private',o.remindAt||null,o.channel||'直客',o.partner||null,o.location||null,o.gpsPlace||null,o.deliverMain===false?0:1,o.deliverSub===false?0:1,o.reviewResult||'',o.publishedAt||null,o.accountId||null,o.note||null,(o.remindLog&&o.remindLog.length?JSON.stringify(o.remindLog):null),o.expectPayAt||null,ts,ts]}));
    set.push({statement:'DELETE FROM accounts WHERE mode=?',values:[payload.mode]});
    (payload.accounts||[]).forEach(a=>set.push({statement:'INSERT INTO accounts (mode,id,name,level,phone,douyin,color,avatar,created_at) VALUES (?,?,?,?,?,?,?,?,?)',values:[payload.mode,a.id,a.name,a.level||'Lv.5',a.phone||null,a.douyin||null,a.color??0,a.avatar||null,a.createdAt||ts]}));
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
 * 通知 id 按「模式 × 类型」分段:
 *   work(base=0):每日汇总=1;催收备忘=100000+orderId;出片提醒=300000+orderId
 * 演示数据不排系统通知(2026-11-22 第四轮 review 起):demo 种子里有 41 天逾期的单,
 * 进过一次演示模式就会每天 09:00 推一条假催收(repeats:true),切回 work 后无从关闭。
 * demo 段(500001 / 600000+ / 800000+)只在 cancelMode('demo') 清理旧版本遗留通知时用到。
 * 同模式内备忘段与出片段按 orderId 各占一段、互不重叠(要求 orderId<100000,个人记账远达不到)。 ================= */
