/* ================= 渲染:收款(P0 §3) ================= */
import {$,esc,fmtD,fmtHM,fmtMoney} from '../util.js';
import {db} from '../storage.js';
import {ui} from '../ui.js';
import {isOver,snoozed,unDep,unFin,owedOf,overdueDays,expectOverdue,workOf,accOrderIds,METHOD_CLS,accMatch} from '../derived.js';
import {accBar,accTint,accOrderTag,accTagHTML,accById,accMulti,accChipbarHTML} from '../accounts.js';
import {headBtns} from '../stats.js';
import {storeOf} from '../derived.js';

/* ================= 渲染:收款 ================= */
export function renderPay(){
  const rows0=db.orders.filter(accMatch).filter(o=>owedOf(o)>0);
  const unDepSum=rows0.reduce((s,o)=>s+unDep(o),0);
  const unFinSum=rows0.reduce((s,o)=>s+unFin(o),0);
  const dySum=rows0.filter(o=>o.settleVia==='douyin').reduce((s,o)=>s+unFin(o),0);
  const overAll=db.orders.filter(accMatch).filter(isOver);
  const over=overAll.filter(o=>!snoozed(o));
  const overSum=over.reduce((s,o)=>s+unFin(o),0);

  const bucket=o=>{const d=overdueDays(o);return d>30?'g30':d>7?'m830':'s7'};
  const rows=rows0.filter(o=>ui.bucket==='all'||(ui.bucket==='over'?isOver(o)&&!snoozed(o):ui.bucket==='snoozed'?isOver(o)&&snoozed(o):bucket(o)===ui.bucket))
    .sort((a,b)=>(snoozed(a)-snoozed(b))||overdueDays(b)-overdueDays(a)||a.appt.localeCompare(b.appt));

  const listHtml=rows.length?rows.map(o=>{
    const d=overdueDays(o),isDep=unDep(o)>0&&!isOver(o),isDy=o.settleVia==='douyin',sn=snoozed(o);
    // 平台单:到账日超了就要顶上来提示,否则"平台会结"变成无限期等待
    const late=isDy?expectOverdue(o):0;
    const dyNote=isDy&&o.expectPayAt?` · 预计 ${fmtD(o.expectPayAt)} 到账${late>0?`(已超 ${late} 天)`:''}`:'';
    const due=isDep?{kind:'deposit',amt:unDep(o),sub:`预约 ${fmtD(o.appt)} ${fmtHM(o.appt)} · 定金`,btn:'标记已收'}
      :isDy?{kind:'final',amt:unFin(o),sub:`${o.shotAt?'拍摄 '+fmtD(o.shotAt):'待拍摄'} · 抖音商单结算${dyNote}`,btn:'标记到账'}
      :{kind:'final',amt:unFin(o),sub:`${o.shotAt?'拍摄 '+fmtD(o.shotAt):'预约 '+fmtD(o.appt)} · ${workOf(o)}`,btn:'标记已收'};
    const chip=isDep?'<span class="chip c-gray">待定金</span>'
      :isDy?`<span class="chip ${late>0?'c-red':'c-blue'}">平台结算${o.expectPayAt?` · ${fmtD(o.expectPayAt)}${late>0?' 已超期':''}`:''}</span>`
      :isOver(o)?(sn?`<span class="chip c-gray">已设提醒 · ${fmtD(o.remindAt)}再催</span>`:`<span class="chip c-red">逾期 · 欠 ${d} 天</span>`)
      :`<span class="chip ${d>7?'c-orange':'c-gray'}">${o.shotAt?'欠款 '+d+' 天':'未拍摄 · 尚未起算账期'}</span>`;
    return `<div class="row${accBar(o)}" style="${accTint(o)}" data-act="open" data-oid="${o.id}">
      <div class="rmain"><div class="rname">${esc(o.store)}</div>
        <div class="rsub">${due.sub} ${fmtMoney(due.amt)}</div>
        <div class="chiprow">${accOrderTag(o)}${chip}${!isDep&&unDep(o)>0?`<span class="chip c-gray">另待定金 ${fmtMoney(unDep(o))}</span>`:''}</div>
      </div>
      <button class="mini-btn green" data-act="open-pay" data-oid="${o.id}" data-kind="${due.kind}">${due.btn}</button>
    </div>`;}).join('')
    : `<div class="empty"><div class="e-ic">✅</div>该区间暂无待收款</div>`;

  const flow=[...db.payments].filter(p=>accOrderIds().has(p.oid)).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,8).map(p=>{
    const po=db.orders.find(x=>x.id===p.oid);
    return `<div class="row${accBar(po)}" style="${accTint(po)}">
      <div class="rmain"><div class="rname" style="font-size:14px">+${fmtMoney(p.amount)} · ${esc(storeOf(p.oid))}</div>
        <div class="rsub">${esc(p.kind)} · ${fmtD(p.at)} ${fmtHM(p.at)}${accMulti()?` · ${accTagHTML(po?accById(po.accountId):null)}`:''}</div></div>
      <span class="chip ${METHOD_CLS[p.method]||'c-gray'}">${esc(p.method)}</span>
    </div>`;}).join('');

  $('#v-pay').innerHTML=`
    <div class="htop-row"><div><div class="eyebrow">资金线 · 账期自实际拍摄日起算</div><h1 class="big">收款</h1></div>
    <div style="display:flex;gap:8px">${headBtns(false)}</div></div>
    ${accChipbarHTML()}
    <div class="card" style="padding:16px;margin-bottom:12px">
      <div style="font-size:12px;color:var(--sub)">待收款总额</div>
      <div style="font-size:32px;font-weight:800;letter-spacing:.3px;margin:4px 0 2px">${fmtMoney(unDepSum+unFinSum)}</div>
      <div class="chiprow">
        <span class="chip c-orange">尾款·私收 ${fmtMoney(unFinSum-dySum)}</span>
        ${dySum>0?`<span class="chip c-blue">抖音商单 ${fmtMoney(dySum)}</span>`:''}
        <span class="chip c-gray">定金 ${fmtMoney(unDepSum)}</span>
        ${over.length?`<span class="chip c-red">逾期 ${over.length} 笔 · ${fmtMoney(overSum)}</span>`:'<span class="chip c-green">无逾期</span>'}
        ${overAll.length>over.length?`<span class="chip c-gray">${overAll.length-over.length} 笔已设提醒</span>`:''}
      </div>
    </div>
    <div class="seg" style="margin-bottom:12px">
      ${[['all','全部'],['s7','≤7天'],['m830','8–30天'],['g30','30天+']].map(([k,l])=>`<button class="${ui.bucket===k?'on':''}" data-act="bucket" data-bucket="${k}">${l}</button>`).join('')}
    </div>
    <div class="chips" style="margin-bottom:12px"><button class="fchip ${ui.bucket==='over'?'on':''}" data-act="bucket" data-bucket="over">待催收 ${over.length}</button><button class="fchip ${ui.bucket==='snoozed'?'on':''}" data-act="bucket" data-bucket="snoozed">已设提醒 ${overAll.length-over.length}</button></div>
    <div class="card rows">${listHtml}</div>
    <div class="sec-title">收款流水 <span class="more" data-act="export-csv">导出 ›</span></div>
    <div class="card rows">${flow||'<div class="empty">暂无收款记录</div>'}</div>`;
}
