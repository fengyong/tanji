/* P0 测试线束:把 src/app 的 ESM 模块在 vm 沙箱里拼回"经典脚本全局面",
   让 reliability 测试保持原有写法(save()/loadState()/Store/idb 等)。
   仅测试使用,不进 www 产物;由 npm run build:test-harness 打包。
   加载等价于旧 index.html 的「启动段之前」:含事件委托,不含启动序列。 */
import * as storageNS from '../src/app/storage.js';
import * as utilNS from '../src/app/util.js';
import * as envNS from '../src/app/env.js';
import * as uiNS from '../src/app/ui.js';
import * as derivedNS from '../src/app/derived.js';
import * as demoNS from '../src/app/demo.js';
import * as accountsNS from '../src/app/accounts.js';
import * as orderFormsNS from '../src/app/order-forms.js';
import * as orderActionsNS from '../src/app/order-actions.js';
import * as detailNS from '../src/app/detail.js';
import * as sheetsNS from '../src/app/sheets.js';
import * as exportNS from '../src/app/export.js';
import * as sqliteNS from '../src/app/sqlite-bytes.js';
import * as statsNS from '../src/app/stats.js';
import * as shareNS from '../src/app/share-image.js';
import * as notifyNS from '../src/app/notify.js';
import '../src/app/actions.js'; // 顶层 click 委托(与旧加载顺序一致,启动段除外)
import * as homeNS from '../src/app/views/home.js';
import * as tripNS from '../src/app/views/trip.js';
import * as ordersNS from '../src/app/views/orders.js';
import * as payNS from '../src/app/views/pay.js';
import * as statsViewNS from '../src/app/views/stats.js';
const { renderHome } = homeNS, { renderTrip } = tripNS, { renderOrders } = ordersNS,
  { renderPay } = payNS, { renderStats } = statsViewNS;

Object.assign(globalThis, storageNS, utilNS, envNS, uiNS, derivedNS, demoNS, accountsNS,
  orderFormsNS, orderActionsNS, detailNS, sheetsNS, exportNS, sqliteNS, statsNS, shareNS, notifyNS,
  homeNS, tripNS, ordersNS, payNS, statsViewNS);

/* export let 是模块 live binding,Object.assign 只拷当前值,之后读到的是死副本。
   db 会被 loadState 整体重赋值;now/TODAY 被 tickClock 前拨;lastDailySyncDay 被
   syncDailyOnNewDay 更新 —— 这些一律挂活 getter;setter 报错,逼测试走变异写法。 */
for (const [name, get] of [
  ['db', () => storageNS.db],
  ['now', () => utilNS.now],
  ['TODAY', () => utilNS.TODAY],
]) {
  Object.defineProperty(globalThis, name, {
    get,
    set() { throw new Error(`不允许整体重赋值 ${name}:请用 __replaceDb / tickClock 等模块入口`); },
    configurable: true,
  });
}
/* lastDailySyncDay 有合法的写入入口 markDailySynced(day),setter 直接转发 */
Object.defineProperty(globalThis, 'lastDailySyncDay', {
  get: () => uiNS.lastDailySyncDay,
  set: v => uiNS.markDailySynced(v),
  configurable: true,
});
/* toastAction 同样会被 toast()/dismissToast 重写,挂活 getter */
Object.defineProperty(globalThis, 'toastAction', {
  get: () => sheetsNS.toastAction,
  set() { throw new Error('不允许外部赋值 toastAction'); },
  configurable: true,
});

/* 测试专用:整体替换 db 内容(清空 + 变异,语义等价旧经典脚本的 db=… 重赋值) */
globalThis.__replaceDb = state => {
  const cur = storageNS.db;
  for (const k of Object.keys(cur)) delete cur[k];
  Object.assign(cur, state);
};

// 组合根职责(与 src/app/main.js 相同,但不含启动序列)
uiNS.registerRenderers({ home: renderHome, trip: renderTrip, orders: renderOrders, pay: renderPay, stats: renderStats });
uiNS.registerDetailRerender(detailNS.rerenderDetail);
uiNS.registerBadgeCounter(() => storageNS.db.orders.filter(derivedNS.accMatch).filter(o => derivedNS.isOver(o) && !derivedNS.snoozed(o)).length);
uiNS.registerDailySync(() => notifyNS.Notify.syncDaily());

/* P1-T1:storage 的 UI 刷新/字节构建走注入;buildSqliteBytes 的全局 set 转发给
   当前实现,保住旧测试「buildSqliteBytes=stub」的猴子补丁语义 */
storageNS.registerStorageHooks({ renderAll: uiNS.renderAll, showTab: uiNS.showTab, toast: sheetsNS.toast, closeSheets: sheetsNS.closeSheets, notify: notifyNS.Notify, resetFilters() { uiNS.ui.q=''; uiNS.ui.chip='all'; uiNS.ui.bucket='all'; } });
let bytesImpl = sqliteNS.buildSqliteBytes;
Object.defineProperty(globalThis, 'buildSqliteBytes', {
  get: () => (...a) => bytesImpl(...a),
  set: v => { bytesImpl = v; },
  configurable: true,
});
storageNS.registerBytesBuilder((...a) => bytesImpl(...a));
