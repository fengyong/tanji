/* ================= 启动(P0 §3:组合根) ================= */
import {isNative} from './env.js';
import {$,TODAY} from './util.js';
import {ui,renderAll,showTab,refreshVisible,registerRenderers,registerDetailRerender,markDailySynced} from './ui.js';
import {Store,save,loadState,persistFull,acquireWriter,storageKey,setStorageStatus,Notify,nativeOpen,previewImport,backupDocument,db as liveDb} from './storage.js';
import {accMatch} from './accounts.js';
import {isOver,snoozed,overdueDays} from './derived.js';
import {buildSqliteBytes} from './sqlite-bytes.js';
import {closeSheets,showSheet,toast} from './sheets.js';
import {download} from './export.js';
import {initAvatarInput} from './accounts.js';
import {initShotInput} from './order-forms.js';
import {initSheetGestures} from './sheets.js';
import {initSqlite} from './sqlite-bytes.js';
import {mark} from './order-actions.js';
import './actions.js'; // 副作用引入:注册全局 click 事件委托(无导出,esbuild 不引用即 tree-shake)
import {statsFor} from './stats.js';
import {rerenderDetail} from './detail.js';
import {renderHome} from './views/home.js';
import {renderTrip} from './views/trip.js';
import {renderOrders} from './views/orders.js';
import {renderPay} from './views/pay.js';
import {renderStats} from './views/stats.js';

/* P0 偏差 #1–#3(见 DEVIATIONS.md):storage.js / ui.js / derived.js 的函数体是
   逐字节搬运,仍按经典脚本时代的全局晚绑定调用下列符号;§3/§5 又禁止它们
   import 这些符号。在组合根统一挂回 globalThis —— 恢复原语义,不新增行为。 */
Object.assign(globalThis,{accMatch,isOver,snoozed,overdueDays,ui,closeSheets,showSheet,toast,download,
  mark,
  renderTrip,statsFor,backupDocument,previewImport,buildSqliteBytes});
/* 冒烟测试与 WKWebView 调试控制台依赖 Store.ready / Store.blocked / db.orders —
   经典脚本时代它们是天然全局,拆层后在这里挂回(见 DEVIATIONS #4)。
   db 会被 loadState 整体重赋值,必须挂活 getter。 */
Object.defineProperty(globalThis,'db',{get:()=>liveDb,configurable:true});
globalThis.Store=Store;

/* §5 规则 1/2:五个渲染器与详情重绘由组合根注入 */
registerRenderers({home:renderHome,trip:renderTrip,orders:renderOrders,pay:renderPay,stats:renderStats});
registerDetailRerender(rerenderDetail);
/* P1-T1:storage 的 UI 刷新与 SQLite 字节构建经注入回调,不再走 globalThis */
import {registerAfterLoad,registerBytesBuilder} from './storage.js';
registerAfterLoad({renderAll,showTab});
registerBytesBuilder(buildSqliteBytes);

/* ================= 启动 ================= */
if(!isNative&&'serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
  addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>toast('离线缓存安装失败，联网时仍可使用')));
}
$('#import-file').addEventListener('change',event=>previewImport(event.target.files[0]));
document.addEventListener('keydown',event=>{
  if((event.key==='Enter'||event.key===' ')&&event.target.matches('[role="button"][data-act]')){event.preventDefault();event.target.click()}
});
document.addEventListener('visibilitychange',refreshVisible);
addEventListener('pageshow',refreshVisible);
setInterval(refreshVisible,60000);
/* 切后台 / 关页前把待写队列排干。
   原生端每次 save() 都是一次异步 SQLite 写:界面早就显示「已收 ¥XXX」了,
   真正落盘却还在队列里 —— 用户点完「确认收款」立刻上滑杀 App,这一笔就没了。
   这里在 visibilitychange(hidden) 与 pagehide 时等一次队列,给写盘留出机会。
   没装 @capacitor/app(会多一个原生依赖),用 Web 标准事件兜;
   iOS 上 App 进后台会触发 visibilitychange。 */
async function flushPendingWrites(){
  try{if(Store.queue)await Store.queue}catch(e){}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushPendingWrites()});
addEventListener('pagehide',flushPendingWrites);
addEventListener('storage',event=>{
  if(event.key!==storageKey(Store.mode)||!event.newValue)return;
  try{if(JSON.parse(event.newValue).revision>Store.revision){Store.blocked=true;setStorageStatus('其他页面已更新数据，已暂停本页写入。请刷新读取最新数据。')}}catch(error){}
});
$('#f-date').value=TODAY;
(async()=>{
  try{if(isNative)await nativeOpen()}catch(e){console.error('[TanJi] SQLite 初始化失败',e)}
  await acquireWriter();
  const had=await loadState();
  renderAll();showTab('home');
  // 演示数据不排系统通知(Notify 各排程入口有守卫);这里再兜底清一次 demo 段,
  // 把旧版本升级前可能排过的演示通知撤干净——demo 段此后不可能再被新排
  Notify.cancelMode('demo');
  Notify.syncDaily();
  markDailySynced();        // 启动这一次已经用当天口径排过,日切前不必再排(见 DEVIATIONS)
  Notify.syncDeliver();
  initAvatarInput();
  initShotInput();
  initSheetGestures();
  if(!had&&!Store.blocked)await save();
  initSqlite().then(s=>{if(s){Store.sqlite3=s;if(!Store.blocked&&!Store.busy)persistFull()}else if(!isNative)toast('SQLite 引擎未能加载，JSON 保存和备份仍可用')});
})();
