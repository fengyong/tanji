/* ================= 渲染:首页 ================= */
import {$,esc,fmtMoney as fmtMoneyBase,fmtD,fmtHM,now,TODAY,dowOf} from '../util.js';
import {db} from '../storage.js';
import {ui} from '../ui.js';
import {isOver,snoozed,owedOf,overdueDays,workOf,unDep,payChip,workChip,deliverLate,accMatch,deliveredAll,needMain,needSub} from '../derived.js';
import {accBar,accTint,accOrderTag,accChipbarHTML,accTagHTML,accById} from '../accounts.js';
import {priceCell,stepBtn} from '../detail.js';
import {statsFor,headBtns} from '../stats.js';
const fmtMoney=n=>fmtMoneyBase(n,ui.privacy);

function todayRow(o){
  const depChip=unDep(o)>0?`<span class="chip c-orange">待定金 ${fmtMoney(unDep(o))}</span>`:'';
  const punch=o.shotAt?'':`<button class="mini-btn" data-act="mark-shot" data-oid="${esc(o.id)}">到店打卡</button>`;
  return `<div class="row today-row${accBar(o)}" style="${accTint(o)}${o.shotAt?';opacity:.62':''}" data-act="open" data-oid="${o.id}">
    <div class="rside today-time"><div class="rprice" style="color:var(--brand-ink);font-family:var(--display);font-size:19px">${fmtHM(o.appt)}</div><div class="rsub" style="margin:2px 0 0">预约</div></div>
    <div class="rmain"><div class="rname">${esc(o.store)}</div>
      <div class="chiprow">${accOrderTag(o)}${workChip(o)}${depChip||payChip(o)}<span class="chip c-gray">${esc(o.cat)}</span></div></div>
    ${priceCell(o)}
    ${punch||'<svg class="ic" style="color:var(--line-strong)"><path d="M9.5 6l6 6-6 6"/></svg>'}
  </div>`;
}

function nextCard(todays,nextUpcoming){
  const next=todays.find(o=>!o.shotAt);
  if(next){
    const a=accById(next.accountId);
    return `<div class="next-card" data-act="open" data-oid="${esc(next.id)}">
      <div class="next-top"><span class="section-kicker">Next stop / 下一站</span><span class="live-dot">待到店</span></div>
      <div class="next-main">
        <div class="next-time">${fmtHM(next.appt)}</div>
        <div class="next-info"><div class="next-store">${esc(next.store)}</div>
          <div class="next-meta">${esc(next.location||next.cat)}${a?` · ${esc(a.name)}`:''}</div></div>
      </div>
      <div class="next-actions"><button data-act="open" data-oid="${esc(next.id)}">查看预约</button><button class="primary" data-act="mark-shot" data-oid="${esc(next.id)}">到店打卡</button></div>
    </div>`;
  }
  if(todays.length){
    return `<div class="next-card">
      <div class="next-top"><span class="section-kicker">Today / 今日完成</span><span class="live-dot">全部拍完</span></div>
      <div class="next-empty"><strong>今天的店，都拍完了。</strong><span>接下来把交付和收款收好，就可以安心收工。</span></div>
      <div class="next-actions"><button data-act="tab" data-tab="orders">去推进待发片</button><button class="primary" data-act="tab" data-tab="trip">看接下来行程</button></div>
    </div>`;
  }
  if(nextUpcoming){
    return `<div class="next-card" data-act="open" data-oid="${esc(nextUpcoming.id)}">
      <div class="next-top"><span class="section-kicker">Next stop / 下一站</span><span class="live-dot">${esc(fmtD(nextUpcoming.appt))}</span></div>
      <div class="next-main"><div class="next-time">${fmtHM(nextUpcoming.appt)}</div>
        <div class="next-info"><div class="next-store">${esc(nextUpcoming.store)}</div><div class="next-meta">${esc(nextUpcoming.location||nextUpcoming.cat)}</div></div></div>
      <div class="next-actions"><button data-act="open" data-oid="${esc(nextUpcoming.id)}">提前看预约</button><button class="primary" data-act="tab" data-tab="trip">打开整月行程</button></div>
    </div>`;
  }
  return `<div class="next-card">
    <div class="next-top"><span class="section-kicker">A clear day / 空白档期</span><span class="live-dot">从容一点</span></div>
    <div class="next-empty"><strong>今天没有安排。</strong><span>可以提前录下一趟预约，也可以先把待发片清一清。</span></div>
    <div class="next-actions"><button data-act="new-order">新建预约</button><button class="primary" data-act="tab" data-tab="orders">看待发片</button></div>
  </div>`;
}

export function renderHome(){
  const flt=db.orders.filter(accMatch);
  const overAll=flt.filter(isOver),over=overAll.filter(o=>!snoozed(o));
  const overSum=over.reduce((s,o)=>s+owedOf(o),0);
  const maxOver=over.length?Math.max(...over.map(overdueDays)):0;
  const todays=flt.filter(o=>o.appt.slice(0,10)===TODAY).sort((a,b)=>a.appt.localeCompare(b.appt));
  const todoToday=todays.filter(o=>!o.shotAt);
  const nextUpcoming=flt.filter(o=>o.appt.slice(0,10)>TODAY&&!o.shotAt).sort((a,b)=>a.appt.localeCompare(b.appt))[0];
  const sending=flt.filter(o=>['后期中','发片中'].includes(workOf(o))).sort((a,b)=>(a.shotAt||'').localeCompare(b.shotAt||''));
  const m=statsFor('M',flt),totOwed=flt.reduce((s,o)=>s+owedOf(o),0);

  let alertCard;
  if(over.length){
    alertCard=`<div class="alert-card" data-act="goto-collect">
      <svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg>
      <div class="alert-main"><div class="alert-t">${over.length} 笔尾款逾期 · 待催收 ${fmtMoney(overSum)}</div>
        <div class="alert-s">最长已欠 ${maxOver} 天${overAll.length>over.length?` · 另有 ${overAll.length-over.length} 笔已设提醒`:''} · 点击进入催收清单</div></div>
      <svg class="ic" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg></div>`;
  }else if(overAll.length){
    const soon=overAll.map(o=>o.remindAt).sort()[0];
    alertCard=`<div class="alert-card amber" data-act="goto-collect">
      <svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/></svg>
      <div class="alert-main"><div class="alert-t">${overAll.length} 笔尾款已设催收提醒</div><div class="alert-s">最早 ${fmtD(soon)} 再提醒 · 点击查看清单</div></div>
      <svg class="ic" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg></div>`;
  }else{
    alertCard=`<div class="alert-card calm">
      <svg class="ic" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
      <div class="alert-main"><div class="alert-t">收款状态健康</div><div class="alert-s">暂无逾期尾款 · 共待收 ${fmtMoney(totOwed)}</div></div></div>`;
  }

  const todayRows=todays.length?todays.map(todayRow).join('')
    :`<div class="empty"><div class="e-ic">◌</div>今天暂无拍摄安排<br>去行程页看看接下来的档期</div>`;

  const sendRows=sending.length?sending.slice(0,4).map(o=>{
    const miss=[!o.submittedAt?'待提审':'',needMain(o)&&!o.longAt?'待正片':'',needSub(o)&&!o.shortAt?'待副片':'',deliveredAll(o)&&!o.publishedAt?'待发布':''].filter(Boolean)
      .map(t=>`<span class="chip c-orange">${t}</span>`).join('');
    const late=deliverLate(o)?'<span class="chip c-red">超 24h</span>':'';
    return `<div class="row${accBar(o)}" style="${accTint(o)}" data-act="open" data-oid="${o.id}">
      <div class="rmain"><div class="rname">${esc(o.store)}</div><div class="rsub">拍摄于 ${fmtD(o.shotAt)} · ${fmtMoney(o.price)}</div>
        <div class="chiprow">${accOrderTag(o)}${late}${miss}</div></div>
      ${stepBtn(o,'padding:8px 12px')||'<svg class="ic" style="color:var(--line-strong)"><path d="M9.5 6l6 6-6 6"/></svg>'}
    </div>`;
  }).join('')+(sending.length>4?`<div class="row" data-act="tab" data-tab="orders"><div class="rmain"><div class="rsub">还有 ${sending.length-4} 单待推进 · 查看全部</div></div><svg class="ic"><path d="M9.5 6l6 6-6 6"/></svg></div>`:'')
    :`<div class="empty"><div class="e-ic">✓</div>待发片已清空，做得漂亮。</div>`;

  $('#v-home').innerHTML=`
    <div class="app-header">
      <div><div class="eyebrow">${now.getMonth()+1}月${now.getDate()}日 · 周${dowOf(TODAY)}</div><h1 class="big">今日安排</h1>
        <div class="hsub">${todays.length?`${todays.length} 个预约 · ${todoToday.length?`待拍 ${todoToday.length}`:'已全部拍完'}`:'今天没有预约，按自己的节奏来'}</div></div>
      <div class="app-actions">${headBtns(true)}<button class="btn-pill" data-act="new-order"><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>预约</button></div>
    </div>
    ${accChipbarHTML()}
    ${nextCard(todays,nextUpcoming)}
    ${alertCard}
    <div class="sec-title">今日拍摄 <span class="rsub">${todays.length-todoToday.length}/${todays.length} 已拍</span><span class="more" role="button" tabindex="0" data-act="tab" data-tab="trip">整月行程 ›</span></div>
    <div class="card rows">${todayRows}</div>
    <div class="sec-title">待发片 <span class="more" role="button" tabindex="0" data-act="tab" data-tab="orders">全部 ›</span></div>
    <div class="card rows">${sendRows}</div>
    <div class="sec-title">本月速览 <span class="more" role="button" tabindex="0" data-act="tab" data-tab="stats">统计 ›</span></div>
    <div class="mini-grid">
      <div class="mini"><div class="mv" style="color:var(--green)">${fmtMoney(m.paidSum)}</div><div class="ml">本月实收 · ${m.paid.length} 笔</div></div>
      <div class="mini"><div class="mv">${fmtMoney(m.dealSum)}</div><div class="ml">本月成交 · ${m.deals.length} 单</div></div>
      <div class="mini"><div class="mv" style="color:var(--orange)">${fmtMoney(totOwed)}</div><div class="ml">当前待收款</div></div>
      <div class="mini"><div class="mv" style="color:var(--brand-ink)">${sending.length}</div><div class="ml">待发片订单</div></div>
    </div>`;
}
