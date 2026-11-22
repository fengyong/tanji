/* ================= UI 状态(P0 §3:ui 对象 + 时钟/日切 + Tab 路由/全量重绘) ================= */
import {$,now,TODAY,tickClock} from './util.js';
import {db,Store,Notify,setStorageStatus} from './storage.js';

export const ui={tab:'home',chip:'all',bucket:'all',period:'7',selDay:TODAY,q:'',detail:null,payCtx:null,privacy:false,shareUrl:null,shareBlob:null,vMon:{y:now.getFullYear(),m:now.getMonth()+1},accFilter:null,editAccountId:null,draftAvatar:null,draftColor:0,draftProv:'',draftAccId:null,assignAcc:null,remindOid:null,expectOid:null};

/* 每日 09:00 催收汇总是一条 repeats:true 的重复通知,body 在排程那一刻就冻结了。
   订单跨过催收阈值是「时间推移」而不是「数据变化」,没有任何数据事件会触发重排 ——
   订单拍完第 16 天时,汇总里仍然不计入它(上次同步时没逾期的话,连通知都不存在)。
   这里按自然日节流补排一次:跨零点、或 App 整夜开着从后台回到前台时重排,
   保证 09:00 响的那条用的是当天口径,而不是昨天冻结的那份。 */
export let lastDailySyncDay='';
export function syncDailyOnNewDay(){
  if(lastDailySyncDay===TODAY)return;
  lastDailySyncDay=TODAY;
  Notify.syncDaily();
}
/* 特许调整 B(§4):refreshClock 留在 ui,时钟前拨经 tickClock,逐行等价。 */
export function refreshClock(){
  const {changed,previous}=tickClock();
  if(changed&&ui.selDay===previous){ui.selDay=TODAY;ui.vMon={y:now.getFullYear(),m:now.getMonth()+1}}
}

/* §5 规则 1:五个 render* 由 main.js 注册注入,ui 不 import views */
const RENDERERS={};
export function registerRenderers(renderers){Object.assign(RENDERERS,renderers)}

/* ================= Tab 路由 ================= */
export function showTab(t){
  refreshClock();
  ui.tab=t;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $('#v-'+t).classList.add('active');
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));
}
/* P1-T2-B:逾期角标的口径依赖 derived(isOver/snoozed),而 derived 需 import 本模块 —
   角标改组合根注入,保持 ui 不依赖 derived,环从根上不成。 */
let badgeCounter=null;
export function registerBadgeCounter(fn){badgeCounter=fn}

export function renderAll(){
  refreshClock();setStorageStatus(Store.status);
  RENDERERS.home();RENDERERS.trip();RENDERERS.orders();RENDERERS.pay();RENDERERS.stats();
  // 角标跟随当前账号筛选:拆账号查看时,数字必须只数当前账号的逾期单
  const n=badgeCounter?badgeCounter():0;
  const b=$('#pay-bdg');b.style.display=n?'flex':'none';b.textContent=n;
}

/* §5 规则 2:详情重绘同样由 main.js 注入 */
let detailRerender=null;
export function registerDetailRerender(fn){detailRerender=fn}

export function refreshVisible(){
  if(!Store.ready||Store.busy||document.visibilityState==='hidden')return;
  refreshClock();
  // 日切重排每日催收汇总:排在 input 检查之前,否则用户正打着字,汇总就永远停在昨天的口径
  syncDailyOnNewDay();
  if(document.activeElement?.matches('input,textarea,select'))return;
  renderAll();if($('#sheet-detail').classList.contains('show'))detailRerender();
}

/* 启动序列原句是 lastDailySyncDay=TODAY(main.js);ESM 下外部不得赋值本模块的
   let,改为经此函数等价落地(DEVIATIONS 记录)。 */
export function markDailySynced(day=TODAY){lastDailySyncDay=day}
