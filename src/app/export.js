/* ================= 导出(P0 §3) ================= */
import {CAP,isNative} from './env.js';
import {$,toISO,TODAY,fmtD,fmtMoney} from './util.js';
import {db,Store,backupDocument,validateState,replaceData,readSnapshot} from './storage.js';
import {gpsText,REVIEW_LABEL,workOf,payOf,owedOf,isOver,overdueDays,remindLogOf,lastRemind,storeOf,needMain,needSub} from './derived.js';
import {accById} from './accounts.js';
import {buildSqliteBytes} from './sqlite-bytes.js';
import {ui} from './ui.js';
import {showSheet,toast} from './sheets.js';

/* ================= 导出 ================= */
function blobToBase64(blob){
  return new Promise((res,rej)=>{
    const fr=new FileReader();
    fr.onload=()=>res(String(fr.result).split(',')[1]||'');
    fr.onerror=rej;fr.readAsDataURL(blob);
  });
}
async function nativeShareFile(name,content){
  const {Filesystem,Directory,Encoding,Share}=CAP;
  const opts={path:name,directory:Directory.Cache};
  // 与 Web 版保持一致：文本导出带 UTF-8 BOM，Excel/Numbers 打开 CSV 才不会把中文认成乱码。
  // 二进制(.db / 分享图 PNG)不传 encoding —— 插件缺省按 base64 解码后写入原始字节；
  // 一旦传了 encoding 反而会被当作文本原样落盘。
  if(typeof content==='string'){opts.data='\ufeff'+content;opts.encoding=Encoding.UTF8}
  else{opts.data=await blobToBase64(new Blob([content]))}
  const res=await Filesystem.writeFile(opts);
  await Share.share({title:name,url:res.uri,dialogTitle:'分享导出'});
}
export function download(name,content,type){
  if(isNative&&CAP&&CAP.Filesystem&&CAP.Share){ // 原生:全部导出走系统分享面板
    nativeShareFile(name,content).then(()=>toast('已调起系统分享 ✓'))
      .catch(e=>{console.error('导出失败',e);toast('导出失败:'+(e&&e.message||e))});
    return;
  }
  const isText=typeof content==='string';
  const blob=new Blob([isText?"\ufeff"+content:content],{type});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2500);
}
function q(v){const text=String(v??'');return `"${(typeof v==='string'&&/^[\s]*[=+@-]/.test(text)?"'"+text:text).replace(/"/g,'""')}"`}
export function exportCsv(){
  const head=['ID','品名/商家','类型','结算方式','服务商','组队','账号','地点','到店定位','联系方式','总价','定金','预约时间','实际拍摄','提审时间','副片发出','正片发出','出片要求','送审结果','发布时间','工作状态','收款状态','待收金额','欠款天数','催收备忘','催收次数','最近催收','预计到账','备注'];
  const lines=db.orders.map(o=>[o.id,o.store,o.cat,o.settleVia==='douyin'?'抖音商单':'私收',o.channel||'',o.partner||'',(accById(o.accountId)||{}).name||'',o.location||'',gpsText(o),o.contact,o.price,o.deposit,o.appt,o.shotAt,o.submittedAt,o.shortAt,o.longAt,
    [needMain(o)?'正片':'',needSub(o)?'副片':''].filter(Boolean).join('+')||'未配置',
    o.reviewResult?REVIEW_LABEL[o.reviewResult]:'',o.publishedAt||'',workOf(o),payOf(o),owedOf(o),isOver(o)?overdueDays(o):0,o.remindAt?fmtD(o.remindAt):'',
    remindLogOf(o).length,lastRemind(o)?fmtD(lastRemind(o).at):'',o.expectPayAt?fmtD(o.expectPayAt):'',o.note].map(q).join(','));
  const phead=['序号','订单ID','商家','类型','金额','到账时间','收款方式'];
  const plines=db.payments.map((p,i)=>[i+1,p.oid,storeOf(p.oid),p.kind,p.amount,p.at,p.method].map(q).join(','));
  download(`探记-导出-${TODAY}.csv`,[head.map(q).join(','),...lines,'','',phead.map(q).join(','),...plines].join('\n'),'text/csv;charset=utf-8');
  toast('已导出 CSV(订单 + 流水)✓');
}
export async function exportJson(){
  const name=`探记-备份-${toISO(new Date())}.json`;
  const content=JSON.stringify(backupDocument(),null,2);
  if(isNative){
    try{
      const result=await CAP.Capacitor.registerPlugin('BackupFiles').saveBackup({name,content});
      toast(`已保存到「文件 › 探记 HG」：${result?.name||name}`);
    }catch(error){console.error('保存备份失败',error);toast('保存失败:'+(error&&error.message||error))}
    return;
  }
  download(name,content,'application/json');
  toast('已导出 JSON 备份');
}
export function exportDb(){
  const bytes=buildSqliteBytes();
  if(!bytes){toast('SQLite 引擎还在加载,几秒后再试');return}
  download(`探记-${TODAY}.db`,bytes,'application/octet-stream');
  toast('已导出 SQLite 数据库 ✓');
}
const SCHEMA=`<span class="c">-- 探记 TanJi · 本机 SQLite 结构(v0.6 · 单数据集视图)</span>
<span class="c">-- 注意:App 内真实库在同一个 .db 里用 mode 列区分两套数据,
--       orders/accounts 主键为 (mode,id),payments 带 mode,settings 主键为 (scope,key);
--       本页与「导出 .db」展示的是去掉 mode 的单数据集视图。
--       跨设备搬运请用 JSON 备份(统计页可导入),不要直接对拷 .db。</span>
CREATE TABLE orders (
  id             INTEGER PRIMARY KEY,
  store          TEXT NOT NULL,  <span class="c">-- 品名/商家名称</span>
  category       TEXT,           <span class="c">-- 店铺类型</span>
  contact        TEXT,           <span class="c">-- 联系人/电话</span>
  price          REAL NOT NULL,  <span class="c">-- 成交总价</span>
  deposit        REAL DEFAULT 0, <span class="c">-- 定金</span>
  appt_at        TEXT,           <span class="c">-- 预约时间</span>
  shot_at        TEXT,           <span class="c">-- 实际拍摄时间</span>
  submitted_at   TEXT,           <span class="c">-- 提审时间</span>
  short_sent_at  TEXT,           <span class="c">-- 副片(短片)发出</span>
  long_sent_at   TEXT,           <span class="c">-- 正片(长片)发出</span>
  deposit_paid_at TEXT,          <span class="c">-- 定金到账时间</span>
  final_paid_at  TEXT,           <span class="c">-- 尾款到账时间</span>
  settle_via     TEXT DEFAULT 'private',
                 <span class="c">-- 结算方式:private 私收 / douyin 抖音商单(平台结算,不催收)</span>
  remind_at      TEXT,           <span class="c">-- 催收备忘:下次提醒时间(1/3/7 天)</span>
  channel        TEXT,           <span class="c">-- 服务商:蜂向、小爱、金城、食物、直客…</span>
  partner        TEXT,           <span class="c">-- 组队/出镜搭档:花花、邱邱…(空=不组队/未记)</span>
  location       TEXT,           <span class="c">-- 地点:门店地址/楼层(手填,导航按它查)</span>
  gps_place      TEXT,           <span class="c">-- 到店定位 拍摄时自动记录的 GPS 坐标串 与手填 location 并存</span>
  deliver_main   INTEGER DEFAULT 1, <span class="c">-- 出片要求:1=需要正片</span>
  deliver_sub    INTEGER DEFAULT 1, <span class="c">-- 出片要求:1=需要副片(缺省 1=旧单正副片都要)</span>
  review_result  TEXT DEFAULT '',   <span class="c">-- 送审结果:''待审 / pass 合格 / fail 不合格</span>
  published_at   TEXT,              <span class="c">-- 发布时间(里程碑可改)</span>
  account_id     INTEGER,           <span class="c">-- 所属账号(accounts.id,空=未指定)</span>
  note           TEXT,
  remind_log     TEXT,           <span class="c">-- 催收跟进痕迹:JSON 数组 每条含 at 时间与 note 答复</span>
  expect_pay_at  TEXT,           <span class="c">-- 平台单(抖音商单)预计到账时间;过了这天仍未到账会提示</span>
  created_at     TEXT, updated_at TEXT
);
CREATE TABLE accounts (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,  <span class="c">-- 昵称(必填)</span>
  level      TEXT DEFAULT 'Lv.5', <span class="c">-- 对外登记等级，不参与勋章计算</span>
  phone      TEXT,           <span class="c">-- 手机号(选填,一键拷贝用)</span>
  douyin     TEXT,           <span class="c">-- 抖音账号(选填)</span>
  color      INTEGER DEFAULT 0, <span class="c">-- 标识色序号(轻柔色板 0-7,列表底色随它)</span>
  avatar     TEXT,           <span class="c">-- 头像 dataURL(相册选图自动裁圆压缩,仅存本机)</span>
  created_at TEXT
);
CREATE TABLE payments (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id),
  kind     TEXT,  <span class="c">-- 实际存中文标签:'定金' / '尾款'(与 method 一样只作记录,不做支付)</span>
  amount   REAL, paid_at TEXT,
  method   TEXT,   <span class="c">-- 微信 / 支付宝 / 银行卡 / 抖音商单 / 其他(仅记录,不做支付)</span>
  note     TEXT
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
<span class="c">-- 导出视图；App 内真实表是 settings(scope,key)：scope=mode，key=json / backup</span>
<span class="c">-- collect_threshold_days = 15 · medal_rules = 四项勋章门槛 JSON · app_version = 0.6</span>

<span class="c">-- 常用查询:长期未收尾款(私收单)</span>
SELECT store, price - deposit AS due,
       julianday('now') - julianday(shot_at) AS days
FROM orders
WHERE final_paid_at IS NULL AND shot_at IS NOT NULL AND settle_via='private'
ORDER BY days DESC;`;
$('#schema-pre').innerHTML=SCHEMA;

/* ================= 导入 / 替换前备份(T2-A 自 storage.js 搬入) ================= */
export async function openImportPicker(){
  if(!isNative){const input=$('#import-file');input.value='';input.click();return}
  try{
    const picked=await CAP.Capacitor.registerPlugin('BackupFiles').pickBackup();
    await previewImport({name:picked.name,size:picked.size,text:async()=>picked.content});
  }catch(error){if(error?.code!=='PICK_CANCELED')toast('不能导入：'+(error&&error.message||error))}
}
export async function previewImport(file){
  if(!file)return;
  try{
    if(file.size>10*1024*1024)throw new Error('备份文件不能超过 10 MB');
    const parsed=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
    const state=validateState(parsed);
    for(const order of state.orders){
      for(const [kind,key,expected] of [['定金','depositPaidAt',order.deposit],['尾款','finalPaidAt',order.price-order.deposit]]){
        const entries=state.payments.filter(p=>p.oid===order.id&&p.kind===kind);
        const total=entries.reduce((sum,p)=>sum+Math.round(p.amount*100),0);
        if(entries.length>1||(entries.length>0&&!order[key])||total!==Math.round((order[key]?expected:0)*100))throw new Error(`订单「${order.store}」的${kind}流水与已收状态不一致，请先核对备份`);
      }
    }
    // 保留“旧备份没有门槛字段”的信息,替换时沿用当前配置而不是回落默认值。
    Store.pending=parsed.medalRules===undefined?{...state,medalRules:undefined}:state;
    const total=state.payments.reduce((sum,p)=>sum+p.amount,0);
    document.querySelector('#import-summary').textContent=`${file.name}：${state.orders.length} 笔订单、${state.payments.length} 笔流水、实收 ${fmtMoney(total,ui.privacy)}、催收阈值 ${state.threshold} 天。将替换当前数据，替换前自动保存一份本机备份。`;
    showSheet('sheet-import');
  }catch(error){Store.pending=null;toast(`不能导入：${error.message}`)}
}
export async function confirmImport(){
  if(!Store.pending||Store.busy)return;
  const state=Store.pending;
  if(await replaceData(state)){Store.pending=null;toast('备份已恢复，替换前数据可在统计页恢复')}
}
export async function restoreCheckpoint(){
  if(Store.busy||Store.blocked)return;
  Store.busy=true;
  let saved;
  try{saved=await readSnapshot(Store.mode,'backup')}finally{Store.busy=false}
  if(saved.uncertain){toast('部分备份无法读取，已暂停恢复；请导出替换前备份并重试');return}
  if(!saved.value){toast('没有可用的替换前备份');return}
  if(!confirm(`恢复替换前的 ${saved.value.orders.length} 笔订单和 ${saved.value.payments.length} 笔流水？当前数据将作为新的替换前备份保留。`))return;
  if(await replaceData(saved.value))toast('已恢复替换前数据');
}
export async function exportCheckpoint(){
  const mode=Store.mode;
  const saved=await readSnapshot(mode,'backup');
  if(!saved.value){toast('没有可用的替换前备份');return}
  download('探记-替换前备份.json',JSON.stringify(backupDocument(saved.value),null,2),'application/json');
  toast('已导出替换前备份，原存储未改动');
}
