/* ================= 状态操作 + 催收跟进/平台预计到账 + 到店定位回写(P0 §3) ================= */
import {$,esc,fmtMoney as fmtMoneyBase,fmtD,fmtDT,nowStr,validDateTime,dOff} from './util.js';
import {db,save} from './storage.js';
import {Notify} from './notify.js';
import {ui,renderAll} from './ui.js';
import {byId,paymentSpec,orderMoney,hasReceipt,METHODS,remindLogOf,lastRemind,unFin,deliveredAll} from './derived.js';
import {toast,showSheet,closeSheets} from './sheets.js';
import {MILE_LABEL,rerenderDetail,openDetail} from './detail.js';
/* 隐私模式:本文件全部金额渲染经此包装(P0 修复:双参化后调用点必须带 ui.privacy) */
const fmtMoney=n=>fmtMoneyBase(n,ui.privacy);

/* ================= 状态操作 ================= */
/* 里程碑前置依赖:时间线只能向前走,不允许跳过中间节点直接标记,
   否则会出现"未拍摄就已发布"这类发布时间早于拍摄的脏数据。 */
const MILE_PRE={shotAt:null,submittedAt:'shotAt',shortAt:'submittedAt',longAt:'submittedAt',publishedAt:'submittedAt'};
/* 时间线全序:清除上游节点时,其后的下游记录一并清掉(截断),
   否则会残留"未拍摄已发布"这类脏时间线——mark 的前置守卫只挡正向标记 */
export const MILE_ORDER=['shotAt','submittedAt','shortAt','longAt','publishedAt'];
export function mark(id,key,label){
  const o=byId(id);
  if(!o||!Object.prototype.hasOwnProperty.call(MILE_LABEL,key)||o[key])return false;
  const pre=MILE_PRE[key];
  if(pre&&!o[pre]){toast(`请先完成「${MILE_LABEL[pre]}」再标记「${MILE_LABEL[key]}」`);return false}
  if(key==='publishedAt'&&!deliveredAll(o)){toast('正片/副片出齐后才能标记发布');return false}
  o[key]=nowStr();save();renderAll();rerenderDetail();Notify.syncDeliver();toast(label);
  return true;
}
export function pay(id,kind,method='微信'){
  const o=byId(id),spec=paymentSpec(kind);
  if(!o||!spec||!METHODS.includes(method)){toast('收款订单、类型或方式无效');return false}
  const m=orderMoney(o);
  if(!m||m[kind]<=0){toast('没有有效的待收金额，不能记账');return false}
  if(hasReceipt(o,kind)){toast('该笔款项已记录，请勿重复收款');return false}
  const t=nowStr(),amount=m[kind]/100;
  o[spec.field]=t;
  db.payments.push({oid:id,kind:spec.label,amount,at:t,method});
  save();renderAll();rerenderDetail();Notify.syncDaily();
  toast(`已收${spec.label} ${fmtMoney(amount)} · ${method}`,{label:'撤销',run:()=>undoPay(id,kind,t)});
  return true;
}
/**
 * 撤销刚记的一笔收款:用 (oid, kind, at) 三段定位那条流水,
 * 并确认订单上的标记字段仍是当初写入的时间 —— 期间若已被人改动就不再回滚,只提示。
 */
export function undoPay(id,kind,at){
  const spec=paymentSpec(kind),o=byId(id);
  if(!spec||!o)return false;
  const index=db.payments.findIndex(p=>p.oid===id&&p.kind===spec.label&&p.at===at);
  if(index<0||o[spec.field]!==at){toast('这笔收款已被改动,无法撤销');return false}
  db.payments.splice(index,1);
  o[spec.field]=null;
  save();renderAll();rerenderDetail();Notify.syncDaily();
  toast('已撤销该笔收款');
  return true;
}
export function openPay(oid,kind,keepMethod){
  ui.payCtx=null;
  const o=byId(oid),spec=paymentSpec(kind);
  if(!o||!spec){toast('收款订单或类型无效');return}
  const m=orderMoney(o);
  if(!m||m[kind]<=0||hasReceipt(o,kind)){toast('该笔款项没有待收金额或已经记录');return}
  const method=keepMethod===undefined?(o.settleVia==='douyin'?'抖音商单':'微信'):keepMethod;
  if(!METHODS.includes(method)){toast('请选择有效的收款方式');return}
  const amt=m[kind]/100;
  ui.payCtx={oid,kind,method};
  $('#pay-body').innerHTML=`
    <div style="text-align:center;padding:6px 0 2px">
      <div style="font-size:14px;font-weight:700">${esc(o.store)}</div>
      <div style="font-size:34px;font-weight:800;margin:8px 0 2px">${esc(fmtMoney(amt))}</div>
      <div style="font-size:12px;color:var(--sub)">${spec.label} · ${o.settleVia==='douyin'?'约定抖音商单结算':'私收款项'} · 仅作入账记录</div>
    </div>
    <div class="sec-title" style="justify-content:center">收款方式(记录用)</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">
      ${METHODS.map(m=>`<button class="mchip ${ui.payCtx.method===m?'on':''}" data-act="pay-method" data-m="${esc(m)}">${esc(m)}</button>`).join('')}
    </div>
    <div style="padding:18px 0 4px"><button class="btn green" data-act="confirm-pay">确认收款 ${esc(fmtMoney(amt))}</button></div>`;
  showSheet('sheet-pay');
}

/* ================= 催收跟进痕迹 / 平台预计到账 =================
 * 催收的真实动作是"问一次 → 对方说 X 号给 → 再问一次":remindAt 只能记"下次提醒",
 * 记不住"催过几次、对方怎么答"。remindLog 就是这条时间线,不带金额、不进流水。
 * 平台单(抖音商单)同理:钱不由达人催,但"说好哪天到账"必须落成日期。 */
const REMIND_QUICK=['说这周给','说月底统一结','财务走流程','没回复/不接','已转对公','说拍完再结'];
export function openRemind(oid){
  const o=byId(oid);
  if(!o){toast('订单不存在');return}
  const log=remindLogOf(o),last=log[log.length-1];
  ui.remindOid=oid;
  const note=$('#remind-note');if(note)note.value='';
  $('#remind-sub').textContent=`「${o.store}」${log.length?`已催 ${log.length>=50?'50+':log.length} 次,最近 ${fmtDT(last.at)}`:'还没催过'} · 记录时间自动取现在`;
  $('#remind-quick').innerHTML=REMIND_QUICK.map(t=>`<button class="fchip" data-act="remind-quick" data-v="${esc(t)}">${esc(t)}</button>`).join('');
  showSheet('sheet-remind');
}
export function saveRemind(){
  const id=ui.remindOid,o=byId(id);
  if(!o){closeSheets();return}
  const input=$('#remind-note');
  const note=(input&&input.value?input.value:'').trim().slice(0,200);
  const at=nowStr();
  // 追加前先取条数:封顶 slice(-50) 之后 length 不再增长,事后读会把「第 51 次」报成「第 50 次」
  const seq=remindLogOf(o).length;
  const capped=seq>=50;
  o.remindLog=[...remindLogOf(o),{at,note}].slice(-50);
  const back=ui.detail===id?id:null;
  save();renderAll();closeSheets();
  if(back!==null&&byId(back))openDetail(back);
  toast(capped?`已记录 · 最早一条已被挤出,只保留最近 50 次${note?` · ${note}`:''}`:`已记录第 ${seq+1} 次催收${note?` · ${note}`:''}`);
}
export function openExpect(oid){
  const o=byId(oid);
  if(!o){toast('订单不存在');return}
  ui.expectOid=oid;
  $('#expect-sub').textContent=`「${o.store}」抖音商单,尾款 ${fmtMoney(unFin(o))} 由平台结算`;
  $('#expect-date').value=o.expectPayAt?o.expectPayAt.slice(0,10):'';
  showSheet('sheet-expect');
}
export function saveExpect(){
  const id=ui.expectOid,o=byId(id);
  if(!o){closeSheets();return}
  const day=$('#expect-date').value;
  const at=day?`${day}T10:00`:'';
  if(!at||!validDateTime(at)){toast('先选一个有效的到账日期');return}
  const back=ui.detail===id?id:null;
  o.expectPayAt=at;save();renderAll();closeSheets();
  if(back!==null&&byId(back))openDetail(back);
  toast(`已记下预计 ${fmtD(at)} 到账`);
}
export function clearExpect(oid){
  const o=byId(oid);
  if(!o||!o.expectPayAt)return;
  o.expectPayAt=null;save();renderAll();rerenderDetail();toast('已清除预计到账日');
}

/**
 * 到店定位:拍摄动作发生时顺手记一次 GPS,存 `lat,lng` 到 order.gpsPlace。
 * - 失败/拒绝授权一律静默(位置是附加信息,不能影响"这单拍过了"这件事);
 * - 与手填 location 完全并存:location 是人写的地址,gpsPlace 是当时的位置;
 * - 已有 gpsPlace 时不覆盖拍照流程里的自动记录? 会覆盖 —— 重拍意味着"我又到店了",
 *   以最新一次为准,详情页里也可以手动重新定位。
 */
export function capturePlace(oid){
  if(typeof TanJiGeo==='undefined')return;
  TanJiGeo.locate().then(place=>{
    const cur=byId(oid);
    if(!cur||!place)return;
    cur.gpsPlace=place;
    save();renderAll();rerenderDetail();
    toast('已记录到店定位 ✓');
  }).catch(()=>{/* 无权限/超时/无信号:保持原值,可在详情页手动补 */});
}
