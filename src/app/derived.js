/* ================= 派生逻辑(双轨状态机,P0 §3:含 byId/gpsText/storeOf) ================= */
import {now,TODAY,nowStr} from './util.js';
import {db} from './storage.js';
import {ui} from './ui.js';

/* ================= 派生逻辑(双轨状态机) =================
 * 规则实现集中在 logic.js(纯函数,不碰 DOM/全局)。这里只保留「读全局 → 调规则」
 * 的薄包装,保证既有调用点与签名不变。改口径请改 logic.js 并补测试:那是将来
 * 换 SwiftUI 时唯一需要逐条翻译的规格文件。 */
export function workOf(o){return TanJiLogic.workOf(o)}
export function moneyCents(value,blankZero){return TanJiLogic.moneyCents(value,blankZero)}
export function orderMoney(o){return TanJiLogic.orderMoney(o)}
export function paymentSpec(kind){return TanJiLogic.paymentSpec(kind)}
export function hasReceipt(o,kind){return TanJiLogic.hasReceipt(o,kind,db.payments)}
export function hasAnyReceipt(o){return TanJiLogic.hasAnyReceipt(o,db.payments)}
export function unDep(o){return TanJiLogic.unDep(o,db.payments)}
export function unFin(o){return TanJiLogic.unFin(o,db.payments)}
export function owedOf(o){return TanJiLogic.owedOf(o,db.payments)}
export function payOf(o){return TanJiLogic.payOf(o,db.payments)}
export function overdueDays(o){return TanJiLogic.overdueDays(o,db.payments,now)}
export function snoozed(o){return TanJiLogic.snoozed(o,nowStr())}
export function isOver(o){return TanJiLogic.isOver(o,db.payments,db.threshold,now)}
export function remindLogOf(o){return TanJiLogic.remindLogOf(o)}
export function lastRemind(o){return TanJiLogic.lastRemind(o)}
export function expectOverdue(o){return TanJiLogic.expectOverdue(o,db.payments,now)}
/* 账号筛选是全局口径:首页/订单/收款/统计/行程都只数当前账号的数据。
   上面的 accMatch 按订单筛,流水要按「这张单属于哪个账号」筛,不能直接拿 db.payments。 */
/* 账号筛选谓词:只依赖 ui.accFilter,与订单谓词同层(P1-T2-B 自 accounts.js 归位) */
export const accMatch=o=>ui.accFilter==null||o.accountId===ui.accFilter;
export const accOrderIds=()=>new Set(db.orders.filter(accMatch).map(o=>o.id));
export function upcoming7(){return TanJiLogic.upcomingByDay(db.orders.filter(accMatch),TODAY,7)}

export const WORK_CLS={'待拍摄':'c-blue','后期中':'c-purple','发片中':'c-orange','已交付':'c-green'};
export const PAY_CLS={'待定金':'c-gray','待尾款':'c-orange','平台结算':'c-blue','已逾期':'c-red','已结清':'c-green'};
export const METHODS=['微信','支付宝','银行卡','抖音商单','其他'];
export const METHOD_CLS={'微信':'c-green','支付宝':'c-blue','银行卡':'c-orange','抖音商单':'c-ink','其他':'c-gray'};
export function payChip(o){const s=payOf(o);const label=isOver(o)?'已逾期':s;return `<span class="chip ${PAY_CLS[label]}">${label}</span>`}
export function workChip(o){return `<span class="chip ${WORK_CLS[workOf(o)]}">${workOf(o)}</span>`}
/* 工作流 v0.5:拍摄完成超 24h 仍未出齐(按该单正/副片配置)→ 红色角标;正/副片 = 长片/短片 */
export function deliverLate(o){return TanJiLogic.deliverLate(o,Date.now())}
export const REVIEW_LABEL={pass:'送审合格',fail:'送审不合格'};

export const byId=id=>db.orders.find(o=>o.id===id);
/* 到店定位的可读文本:geo.js 缺失时也返回空串,不让详情页/导出因为一个可选模块崩掉 */
export const gpsText=o=>(o&&o.gpsPlace&&typeof TanJiGeo!=='undefined')?TanJiGeo.label(o.gpsPlace):'';
export const storeOf=id=>{const o=byId(id);return o?o.store:''};
