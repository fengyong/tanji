/* =====================================================================
 * 探记 TanJi · 业务规则层(纯函数,不碰 DOM、不读写全局状态)
 * ---------------------------------------------------------------------
 * 为什么单独成文件:
 *   1) 这里是产品口径的唯一真源(工作线/资金线/逾期/出片/统计/排期重叠),
 *      UI 只负责调用与渲染。将来换 SwiftUI 时可照本文件逐条翻译,不用在
 *      两千行 index.html 里逆向。
 *   2) 纯函数便于单测:orders / payments / threshold / today 全部由调用方传入。
 *
 * 约定:
 *   - 不引用 db / now / ui / document / window.TanjiCap;
 *   - 时间一律用本地时间字符串 'YYYY-MM-DDTHH:mm';
 *   - 金额:数据库与内部计算用「分」(moneyCents),展示用「元」。
 * 命名空间:window.TanJiLogic(浏览器与 Capacitor 均直接可用,无构建步骤)
 * ===================================================================== */
(function(root){
  'use strict';

  /* ---------------- 时间基础 ---------------- */
  const pad=n=>String(n).padStart(2,'0');
  const toISO=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  function nowStr(date=new Date()){
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /** 严格校验本地时间串,并回读一次确认不是 2026-02-30 这类非法日期 */
  function validDateTime(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(value))return false;
    const d=new Date(value);
    return Number.isFinite(d.getTime())&&toISO(d)===value.slice(0,10)&&`${pad(d.getHours())}:${pad(d.getMinutes())}`===value.slice(11,16);
  }

  /** 'YYYY-MM-DDTHH:mm' → 当天第几分钟(用于排期重叠判定) */
  function toMin(appt){return +appt.slice(11,13)*60 + +appt.slice(14,16)}

  /** 自然日差(跨时区安全:用 UTC 归一),未来日期返回 0 */
  function daysBetween(fromStr,today=new Date()){
    const f=new Date(fromStr);
    return Math.max(0,Math.round(
      (Date.UTC(today.getFullYear(),today.getMonth(),today.getDate())
       -Date.UTC(f.getFullYear(),f.getMonth(),f.getDate()))/864e5));
  }

  /* ---------------- 金额(以分为单位,避免浮点误差) ---------------- */
  function moneyCents(value,blankZero=false){
    if(typeof value!=='number'&&typeof value!=='string')return null;
    const text=String(value).trim();
    if(!text)return blankZero?0:null;
    if(!/^\d+(?:\.\d{1,2})?$/.test(text))return null;
    const [whole,fraction='']=text.split('.');
    const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
    return Number.isSafeInteger(cents)&&cents>=0?cents:null;
  }

  /** 报价与定金都合法且定金≤报价时,返回 {price,deposit,final}(分) */
  function orderMoney(o){
    const price=moneyCents(o.price),deposit=moneyCents(o.deposit);
    return price!==null&&deposit!==null&&deposit<=price?{price,deposit,final:price-deposit}:null;
  }

  /** 只有定金/尾款两期;流水里的 kind 存中文标签 */
  function paymentSpec(kind){
    if(kind==='deposit')return {field:'depositPaidAt',label:'定金'};
    if(kind==='final')return {field:'finalPaidAt',label:'尾款'};
    return null;
  }

  /* ---------------- 工作线(v0.5 正/副片可单独配置) ---------------- */
  function needMain(o){return o.deliverMain!==false}
  function needSub(o){return o.deliverSub!==false}

  /** 按该单的出片要求判断是否已出齐;两片都不要求时视为已出齐 */
  function deliveredAll(o){return (!needMain(o)||!!o.longAt)&&(!needSub(o)||!!o.shortAt)}

  /** 工作线四态:待拍摄 → 后期中 → 发片中 → 已交付 */
  function workOf(o){
    if(!o.shotAt)return '待拍摄';
    if(!o.submittedAt)return '后期中';
    if(deliveredAll(o))return '已交付';
    return '发片中';
  }

  /** 拍摄完成满 24h 仍未出齐 → 红色角标 */
  function deliverLate(o,nowMs=Date.now()){
    return !!o.shotAt&&!deliveredAll(o)&&nowMs-new Date(o.shotAt).getTime()>=864e5;
  }

  /* ---------------- 资金线 ---------------- */
  function hasReceipt(o,kind,payments=[]){
    const spec=paymentSpec(kind);
    return !!(spec&&(o[spec.field]||payments.some(p=>p.oid===o.id&&(p.kind===spec.label||p.kind===kind))));
  }
  function hasAnyReceipt(o,payments=[]){return !!(o.depositPaidAt||o.finalPaidAt||payments.some(p=>p.oid===o.id))}

  function unDep(o,payments=[]){const m=orderMoney(o);return m&&!hasReceipt(o,'deposit',payments)?m.deposit/100:0}
  function unFin(o,payments=[]){const m=orderMoney(o);return m&&!hasReceipt(o,'final',payments)?m.final/100:0}
  function owedOf(o,payments=[]){return Math.round((unDep(o,payments)+unFin(o,payments))*100)/100}

  /** 资金线四态;平台结算(douyin)的尾款不催收、不逾期 */
  function payOf(o,payments=[]){
    if(unDep(o,payments)>0)return '待定金';
    if(unFin(o,payments)<=0)return '已结清';
    if(o.settleVia==='douyin')return '平台结算';
    return '待尾款';
  }

  /** 逾期天数从拍摄日起算;未拍摄/已结清/平台结算返回 0 */
  function overdueDays(o,payments=[],today=new Date()){
    if(o.settleVia==='douyin'||unFin(o,payments)<=0||!validDateTime(o.shotAt))return 0;
    return daysBetween(o.shotAt,today);
  }

  function isOver(o,payments=[],threshold=15,today=new Date()){
    return o.settleVia!=='douyin'&&unFin(o,payments)>0&&validDateTime(o.shotAt)&&overdueDays(o,payments,today)>=threshold;
  }

  /** 已设 1/3/7 天备忘且未到期 → 首页不再催 */
  function snoozed(o,nowString){
    return !!(o.remindAt&&o.remindAt>nowString);
  }

  /* ---------------- 统计(窗口:period='M' 本月1日至今;其余按「近 N 天」) ---------------- */
  function statsFor({orders,payments,period,list,now}){
    const listOrders=list||orders;
    const start=new Date(now.getFullYear(),now.getMonth(),period==='M'?1:now.getDate()-(+period-1));
    const inWin=t=>t&&new Date(t)>=start&&new Date(t)<=now;
    const deals=listOrders.filter(o=>inWin(o.appt));
    const paid=(list?payments.filter(p=>listOrders.some(o=>o.id===p.oid)):payments).filter(p=>inWin(p.at));
    const done=listOrders.filter(o=>workOf(o)==='已交付'&&inWin(o.shortAt>o.longAt?o.shortAt:o.longAt));
    return {start,deals,paid,done,
      dealSum:deals.reduce((s,o)=>s+Math.round(o.price*100),0)/100,
      paidSum:paid.reduce((s,p)=>s+Math.round(p.amount*100),0)/100};
  }

  /* ---------------- 排期重叠(±120 分钟) ---------------- */
  function apptOverlap(orders,date,time,excludeId){
    if(!date)return {same:[],overlap:[]};
    const same=orders.filter(o=>validDateTime(o.appt)&&o.appt.slice(0,10)===date&&o.id!==excludeId);
    if(!same.length)return {same,overlap:[]};
    const t=toMin(date+'T'+time);
    return {same,overlap:same.filter(o=>Math.abs(toMin(o.appt)-t)<=120)};
  }

  root.TanJiLogic={
    // 时间
    pad,toISO,nowStr,validDateTime,toMin,daysBetween,
    // 金额
    moneyCents,orderMoney,paymentSpec,
    // 工作线
    needMain,needSub,deliveredAll,workOf,deliverLate,
    // 资金线
    hasReceipt,hasAnyReceipt,unDep,unFin,owedOf,payOf,overdueDays,isOver,snoozed,
    // 统计 / 排期
    statsFor,apptOverlap,
  };
})(typeof globalThis!=='undefined'?globalThis:this);
