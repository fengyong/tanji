/* ================= 渲染:首页(P0 §3) ================= */
import {$,esc,fmtMoney as fmtMoneyBase,fmtD,fmtHM,now,TODAY,dowOf,greeting} from '../util.js';
import {db} from '../storage.js';
import {ui} from '../ui.js';
import {isOver,snoozed,owedOf,overdueDays,workOf,unDep,payChip,workChip,deliverLate,accMatch,deliveredAll,needMain,needSub} from '../derived.js';
import {accBar,accTint,accOrderTag,accChipbarHTML} from '../accounts.js';
import {priceCell,stepBtn} from '../detail.js';
import {statsFor,headBtns} from '../stats.js';
/* 隐私模式:本文件全部金额渲染经此包装(P0 修复:双参化后调用点必须带 ui.privacy) */
const fmtMoney=n=>fmtMoneyBase(n,ui.privacy);

/* ================= 渲染:首页 ================= */
export function renderHome(){
  const flt=db.orders.filter(accMatch);
  const overAll=flt.filter(isOver);
  const over=overAll.filter(o=>!snoozed(o));
  const overSum=over.reduce((s,o)=>s+owedOf(o),0);
  const maxOver=over.length?Math.max(...over.map(overdueDays)):0;
  // 今日全部单:拍过的也留着(置灰),否则首页数量会随拍照一路减少,看着像"今天只接了一单"
  const todays=flt.filter(o=>o.appt.slice(0,10)===TODAY).sort((a,b)=>a.appt.localeCompare(b.appt));
  const todoToday=todays.filter(o=>!o.shotAt);
  const sending=flt.filter(o=>['后期中','发片中'].includes(workOf(o))).sort((a,b)=>(a.shotAt||'').localeCompare(b.shotAt||''));
  const m=statsFor('M',flt);
  const totOwed=flt.reduce((s,o)=>s+owedOf(o),0);

  let alertCard;
  if(over.length){
    alertCard=`<div class="alert-card" data-act="goto-collect">
      <svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg>
      <div class="alert-main"><div class="alert-t">${over.length} 笔尾款逾期 · 待催收 ${fmtMoney(overSum)}</div>
      <div class="alert-s">最长已欠 ${maxOver} 天${overAll.length>over.length?` · 另有 ${overAll.length-over.length} 笔已设提醒`:''} · 点击进入催收清单</div></div>
      <svg class="ic" style="opacity:.9" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>
    </div>`;
  }else if(overAll.length){
    const soon=overAll.map(o=>o.remindAt).sort()[0];
    alertCard=`<div class="alert-card amber" data-act="goto-collect">
      <svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/></svg>
      <div class="alert-main"><div class="alert-t">${overAll.length} 笔尾款已设催收提醒</div>
      <div class="alert-s">最早 ${fmtD(soon)} 再提醒 · 点击查看清单</div></div>
      <svg class="ic" style="opacity:.9" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>
    </div>`;
  }else{
    alertCard=`<div class="alert-card calm">
      <svg class="ic" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
      <div class="alert-main"><div class="alert-t">收款状态健康</div><div class="alert-s">暂无逾期尾款,共待收 ${fmtMoney(totOwed)}</div></div>
    </div>`;
  }

  const todayRows=todays.length?todays.map(o=>{
    const depChip=unDep(o)>0?`<span class="chip c-red">待定金 ${fmtMoney(unDep(o))}</span>`:'';
    // 到店第一件事就是打卡:首页行内一键完成,顺手记下当时的 GPS(详情页仍可补拍)
    const punch=o.shotAt?'':`<button class="mini-btn" style="padding:6px 10px;font-size:12px" data-act="mark-shot" data-oid="${esc(o.id)}">打卡</button>`;
    return `<div class="row${accBar(o)}" style="${accTint(o)}${o.shotAt?';opacity:.66':''}" data-act="open" data-oid="${o.id}">
      <div class="rside" style="width:52px"><div class="rprice" style="color:var(--brand)">${fmtHM(o.appt)}</div><div class="rsub" style="margin:0">预约</div></div>
      <div class="rmain"><div class="rname">${esc(o.store)}</div>
        <div class="chiprow">${accOrderTag(o)}${workChip(o)}${depChip||payChip(o)}<span class="chip c-gray">${esc(o.cat)}</span></div></div>
      <div class="rside">${priceCell(o)}</div>
      ${punch||'<svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>'}
    </div>`;}).join('')
    : `<div class="empty"><div class="e-ic">🌙</div>今日无拍摄安排<br>去「行程」页看看接下来的档期</div>`;

  const sendRows=sending.length?sending.slice(0,4).map(o=>{
    const miss=[!o.submittedAt?'待提审':'',
      needMain(o)&&!o.longAt?'待正片':'',
      needSub(o)&&!o.shortAt?'待副片':'',
      deliveredAll(o)&&!o.publishedAt?'待发布':''].filter(Boolean)
      .map(t=>`<span class="chip c-orange">${t}</span>`).join('');
    const late=deliverLate(o)?`<span class="chip c-red">超24h</span>`:'';
    // 回家批量交付:行内直接点下一个动作,不用每单都进详情
    return `<div class="row${accBar(o)}" style="${accTint(o)}" data-act="open" data-oid="${o.id}">
      <div class="rmain"><div class="rname">${esc(o.store)}</div><div class="rsub">拍摄于 ${fmtD(o.shotAt)} · ${fmtMoney(o.price)}</div>
        <div class="chiprow">${accOrderTag(o)}${late}${miss}</div></div>
      ${stepBtn(o,'padding:8px 12px')||'<svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>'}
    </div>`;}).join('')+(sending.length>4?`<div class="row" data-act="tab" data-tab="orders">
      <div class="rmain"><div class="rsub">还有 ${sending.length-4} 单待发片 · 查看全部</div></div>
      <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg></div>`:'')
    : `<div class="empty">没有待发片的订单 🎉</div>`;

  $('#v-home').innerHTML=`
    <div class="htop-row">
      <div><div class="eyebrow">${now.getMonth()+1}月${now.getDate()}日 周${dowOf(TODAY)}</div>
      <h1 class="big">${greeting()},达人</h1>
      <div class="hsub">今日 ${todays.length} 单${todays.length?` · ${todoToday.length?`待拍 ${todoToday.length}`:'已全部拍完'}`:''} · ${over.length?`${over.length} 笔待催收`:'收款正常'}</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        ${headBtns(true)}
        <button class="btn-pill" data-act="new-order"><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>预约</button>
      </div>
    </div>
    ${accChipbarHTML()}
    ${alertCard}
    <div class="sec-title">今日拍摄${todays.length?` <span class="rsub" style="font-weight:600">${todays.length-todoToday.length}/${todays.length} 已拍</span>`:''} <span class="more" data-act="tab" data-tab="trip">行程 ›</span></div>
    <div class="card rows">${todayRows}</div>
    <div class="sec-title">待发片 <span class="more" data-act="tab" data-tab="orders">全部 ›</span></div>
    <div class="card rows">${sendRows}</div>
    <div class="sec-title">本月速览 <span class="more" data-act="tab" data-tab="stats">统计 ›</span></div>
    <div class="mini-grid">
      <div class="mini"><div class="mv" style="color:#239648">${fmtMoney(m.paidSum)}</div><div class="ml">本月实收 · ${m.paid.length} 笔</div></div>
      <div class="mini"><div class="mv">${fmtMoney(m.dealSum)}</div><div class="ml">本月成交 · ${m.deals.length} 单</div></div>
      <div class="mini"><div class="mv" style="color:var(--red)">${fmtMoney(totOwed)}</div><div class="ml">当前待收款</div></div>
      <div class="mini"><div class="mv" style="color:var(--orange)">${sending.length}</div><div class="ml">待发片订单</div></div>
    </div>`;
}
