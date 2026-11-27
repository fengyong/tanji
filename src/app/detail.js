import {$,esc,fmtMoney as fmtMoneyBase,fmtD,fmtHM,fmtDT} from './util.js';
import {db} from './storage.js';
import {ui} from './ui.js';
import {byId,overdueDays,orderMoney,moneyCents,unDep,unFin,isOver,payOf,remindLogOf,expectOverdue,snoozed,owedOf,workChip,payChip,deliverLate,REVIEW_LABEL,gpsText,needMain,needSub,deliveredAll} from './derived.js';
import {accMulti,accTagHTML,accById} from './accounts.js';
import {showSheet} from './sheets.js';
const fmtMoney=n=>fmtMoneyBase(n,ui.privacy);

export const MILE_LABEL={shotAt:'拍摄',submittedAt:'提审',shortAt:'副片发出',longAt:'正片发出',publishedAt:'发布'};
const MILE_COLOR={
  shotAt:{c:'var(--brand-ink)',soft:'var(--brand-soft)'},
  submittedAt:{c:'var(--blue)',soft:'var(--blue-soft)'},
  shortAt:{c:'var(--purple)',soft:'var(--purple-soft)'},
  longAt:{c:'var(--green)',soft:'var(--green-soft)'},
  publishedAt:{c:'var(--ink-2)',soft:'#E8EDE8'}
};
const MILE_BIG=new Set(['shortAt','longAt']);
function mileStep(oid,key,label,time,done,nowFlag){
  const tone=MILE_COLOR[key]||{c:'var(--brand-ink)',soft:'var(--brand-soft)'};
  const big=MILE_BIG.has(key)?'big':'';
  const target=byId(oid);
  const photo=key==='shotAt'&&done&&target&&target.photoThumb
    ? `<img src="${target.photoThumb}" alt="">`
    : (done?'✓':(nowFlag?'·':''));
  const clickable=done||nowFlag;
  return `<button class="mstep ${big} ${done?'done':''} ${!done&&nowFlag?'now':''}" ${clickable?'':'aria-disabled="true"'} data-act="mile" data-oid="${esc(oid)}" data-key="${esc(key)}" style="background:none;border:none;padding:0;${clickable?'':'opacity:.45;'}--c:${tone.c};--soft:${tone.soft}">
    <div class="mdotwrap"><div class="mdot">${photo}</div></div>
    <div class="mlab">${esc(label)}</div><div class="mtime">${done?esc(fmtDT(time)):(nowFlag?'点击标记':'')}</div></button>`;
}
export function priceCell(o){
  const money=fmtMoney(o.price);
  return o.photoThumb
    ? `<div class="rprice shot" style="background-image:url('${o.photoThumb}')"><span>${money}</span></div>`
    : `<div class="rprice">${money}</div>`;
}
function detailActions(o){
  if(!o.shotAt)return `<button class="btn primary" data-act="mark-shot" data-oid="${esc(o.id)}">到店了，标记已拍摄</button>`;
  if(!o.submittedAt)return `<button class="btn primary" data-act="mark-submit" data-oid="${esc(o.id)}">已选完，标记提审</button>`;
  const btns=[];
  if(needSub(o))btns.push(`<button class="btn ${o.shortAt?'ghost':'tint'}" data-act="mark-short" data-oid="${esc(o.id)}" ${o.shortAt?'disabled':''}>${o.shortAt?'副片已发':'标记发副片'}</button>`);
  if(needMain(o))btns.push(`<button class="btn ${o.longAt?'ghost':'tint'}" data-act="mark-long" data-oid="${esc(o.id)}" ${o.longAt?'disabled':''}>${o.longAt?'正片已发':'标记发正片'}</button>`);
  if(deliveredAll(o)&&!o.publishedAt)btns.push(`<button class="btn primary" data-act="mile" data-oid="${esc(o.id)}" data-key="publishedAt">标记已发布</button>`);
  return btns.length?`<div class="btn2">${btns.join('')}</div>`:'';
}
function nextStep(o){
  if(!o.shotAt)return null;
  if(!o.submittedAt)return {act:'mark-submit',label:'提审'};
  if(needSub(o)&&!o.shortAt)return {act:'mark-short',label:'发副片'};
  if(needMain(o)&&!o.longAt)return {act:'mark-long',label:'发正片'};
  if(deliveredAll(o)&&!o.publishedAt)return {act:'mile',key:'publishedAt',label:'发布'};
  return null;
}
export function stepBtn(o,extra=''){
  const step=nextStep(o);
  if(!step)return '';
  return `<button class="mini-btn" style="${extra}" data-act="${step.act}" data-oid="${esc(o.id)}"${step.key?` data-key="${step.key}"`:''}>${step.label}</button>`;
}
function detailSection(title,content,more=''){
  return `<div class="detail-section"><div class="detail-section-title"><h3>${title}</h3>${more}</div>${content}</div>`;
}

export function openDetail(id){
  const o=byId(id);if(!o){ui.detail=null;return}
  ui.detail=id;ui.payCtx=null;ui.editId=null;
  const od=overdueDays(o),money=orderMoney(o);
  const steps=[['shotAt',o.shotAt],['submittedAt',o.submittedAt],['shortAt',needSub(o)?(o.shortAt||''):'skip'],['longAt',needMain(o)?(o.longAt||''):'skip'],['publishedAt',o.publishedAt]];
  const visibleSteps=steps.filter(s=>s[1]!=='skip');
  const nextIdx=visibleSteps.findIndex(s=>!s[1]);
  const mile=visibleSteps.map((s,i)=>mileStep(o.id,s[0],MILE_LABEL[s[0]],s[1],!!s[1],i===nextIdx)).join('');
  let lastDone=-1;visibleSteps.forEach((s,i)=>{if(s[1])lastDone=i});
  const progress=lastDone<0?0:((lastDone+0.5)/visibleSteps.length)*72;
  const received=db.payments.filter(p=>p.oid===o.id).reduce((s,p)=>s+(moneyCents(p.amount)||0),0)/100;
  const lateDays=expectOverdue(o);

  const payBtns=[];
  if(unDep(o)>0)payBtns.push(`<button class="btn tint-blue" data-act="open-pay" data-oid="${esc(o.id)}" data-kind="deposit">收定金 ${esc(fmtMoney(unDep(o)))}</button>`);
  if(unFin(o)>0)payBtns.push(`<button class="btn ${isOver(o)?'primary':'pay'}" data-act="open-pay" data-oid="${esc(o.id)}" data-kind="final">收尾款<span class="pmoney">${esc(fmtMoney(unFin(o)))}</span></button>`);
  if(!payBtns.length)payBtns.push(`<div style="text-align:center;color:var(--green);font-weight:800;font-size:14px;padding:6px 0">款项已全部结清</div>`);

  let snoozeHtml='';
  if(payOf(o)==='待尾款'){
    const log=remindLogOf(o),last=log[log.length-1],recent=log.slice(-4).reverse();
    snoozeHtml=detailSection('催收跟进',`<div class="card">
        <div class="rsub" style="margin:0${recent.length?' 0 8px':''};line-height:1.5;white-space:normal">${log.length?`已催 ${log.length>=50?'50+':log.length} 次 · 最近 ${esc(fmtDT(last.at))}`:'还没催过；第一次跟进也记一笔，对方怎么答下次不用重新问'}</div>
        ${recent.map(entry=>`<div class="rline"><span class="rt">${esc(fmtD(entry.at))} ${esc(fmtHM(entry.at))}</span><span class="rn">${entry.note?esc(entry.note):'已催'}</span></div>`).join('')}
        ${log.length>recent.length?`<div class="rsub" style="margin-top:6px">另有 ${log.length-recent.length} 次更早的跟进</div>`:''}
      </div>
      <div class="rsub" style="margin:11px 2px 7px">下次提醒（以打开 App 查看为准）</div>
      <div class="btn2"><button class="btn ghost" data-act="snooze" data-oid="${esc(o.id)}" data-d="1">1 天后</button><button class="btn ghost" data-act="snooze" data-oid="${esc(o.id)}" data-d="3">3 天后</button><button class="btn ghost" data-act="snooze" data-oid="${esc(o.id)}" data-d="7">7 天后</button></div>
      ${snoozed(o)?`<div class="rsub" style="text-align:center;margin-top:9px">已设提醒：${esc(fmtD(o.remindAt))} 再催收 <button class="mini-btn" style="background:rgba(23,53,47,.06);color:var(--sub)" data-act="clear-remind" data-oid="${esc(o.id)}">清除</button></div>`:''}`,
      `<span class="more" role="button" tabindex="0" data-act="remind-open" data-oid="${esc(o.id)}">记录这次跟进 ›</span>`);
  }

  let expectHtml='';
  if(o.settleVia==='douyin'){
    expectHtml=detailSection('平台到账',`<div class="card"><div class="rsub" style="margin:0;line-height:1.6;white-space:normal">${o.expectPayAt
        ?`预计 ${esc(fmtD(o.expectPayAt))} 到账${lateDays>0?` · <b style="color:var(--red)">已超期 ${lateDays} 天</b>，去平台后台看结算状态`:''}`
        :'还没填预计到账日。填上之后，首页与收款页会提示「预计哪天到账」。'}</div></div>
      <div class="btn2" style="margin-top:8px"><button class="btn ghost" data-act="expect-open" data-oid="${esc(o.id)}">${o.expectPayAt?'修改预计到账日':'设置预计到账日'}</button>${o.expectPayAt?`<button class="btn ghost" data-act="expect-clear" data-oid="${esc(o.id)}">清除</button>`:''}</div>`);
  }

  const financeCard=`<div class="info-grid" style="margin-top:0">
      <div class="ig"><div class="k">订单总价</div><div class="v">${esc(fmtMoney(o.price))}</div></div>
      <div class="ig"><div class="k">定金</div><div class="v">${esc(fmtMoney(o.deposit))}</div></div>
      <div class="ig"><div class="k">尾款</div><div class="v">${esc(fmtMoney(money?money.final/100:0))}</div></div>
      <div class="ig"><div class="k">已收合计</div><div class="v" style="color:var(--green)">${received>0?esc(fmtMoney(received)):'—'}</div></div>
      <div class="ig"><div class="k">当前待收</div><div class="v" style="${owedOf(o)>0?(isOver(o)?'color:var(--red)':'color:var(--orange)'):'color:var(--green)'}">${owedOf(o)>0?esc(fmtMoney(owedOf(o))):'已结清'}</div></div>
      <div class="ig"><div class="k">结算方式</div><div class="v">${o.settleVia==='douyin'?'抖音商单':'私收'}</div></div>
    </div><div style="margin-top:10px">${payBtns.join('')}</div>`;

  const infoCard=`<div class="info-grid" style="margin-top:0">
      <div class="ig"><div class="k">预约时间</div><div class="v">${esc(fmtD(o.appt))} ${esc(fmtHM(o.appt))}</div></div>
      <div class="ig"><div class="k">实际拍摄</div><div class="v">${esc(fmtDT(o.shotAt))}</div></div>
      ${accMulti()?`<div class="ig"><div class="k">账号</div><div class="v" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${accTagHTML(accById(o.accountId))}<button class="mini-btn" data-act="copy-account" data-id="${o.accountId??''}">拷贝</button></div></div>`:''}
      <div class="ig"><div class="k">地点</div><div class="v">${esc(o.location||'—')}${o.location?`<button class="mini-btn" style="margin:5px 0 0 6px" data-act="nav-place" data-oid="${esc(o.id)}">导航</button>`:''}</div></div>
      <div class="ig"><div class="k">到店定位</div><div class="v">${o.gpsPlace?`${esc(gpsText(o))}<button class="mini-btn" style="margin:5px 0 0 6px" data-act="nav-place" data-oid="${esc(o.id)}" data-gps="1">看位置</button>`:`<button class="mini-btn" style="margin-top:5px" data-act="locate-now" data-oid="${esc(o.id)}">记录当前位置</button>`}</div></div>
      <div class="ig"><div class="k">发布时间</div><div class="v">${esc(fmtDT(o.publishedAt))}</div></div>
      <div class="ig"><div class="k">服务商</div><div class="v">${esc(o.channel||'直客')}</div></div>
      <div class="ig"><div class="k">组队 / 出镜</div><div class="v">${esc(o.partner||(o.note&&o.note.includes('不组队')?'不组队':'—'))}</div></div>
      <div class="ig"><div class="k">定金到账</div><div class="v">${o.depositPaidAt?esc(fmtD(o.depositPaidAt)):'—'}</div></div>
      <div class="ig"><div class="k">尾款到账</div><div class="v">${o.finalPaidAt?esc(fmtD(o.finalPaidAt)):'—'}</div></div>
    </div>`;

  $('#detail-body').innerHTML=`
    <div class="detail-hero">
      <div class="detail-title-row"><div style="min-width:0"><div class="eyebrow">Order / #${esc(o.id)}</div><div class="detail-title">${esc(o.store)}</div><div class="detail-sub">${esc(o.cat)}${o.contact?' · '+esc(o.contact):''}</div></div>
        <div class="detail-tools"><button class="sheet-close" data-act="copy-order" data-oid="${esc(o.id)}" title="复制订单" aria-label="复制订单"><svg class="ic" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="12" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
        <button class="sheet-close" data-act="edit-order" data-oid="${esc(o.id)}" title="编辑" aria-label="编辑订单" style="background:var(--brand-soft);color:var(--brand-ink)"><svg class="ic" viewBox="0 0 24 24"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/></svg></button>
        <button class="sheet-close" data-act="close-sheet" aria-label="关闭"><svg class="ic" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>
      <div class="chiprow">${workChip(o)}${payChip(o)}${o.reviewResult?`<span class="chip ${o.reviewResult==='pass'?'c-green':'c-red'}">${REVIEW_LABEL[o.reviewResult]}</span>`:''}${deliverLate(o)?`<span class="chip c-red">超 24h 未出片</span>`:''}${isOver(o)?`<span class="chip c-red">欠款 ${esc(od)} 天</span>`:''}${o.settleVia==='douyin'&&o.expectPayAt&&unFin(o)>0?`<span class="chip ${lateDays>0?'c-red':'c-blue'}">预计 ${esc(fmtD(o.expectPayAt))} 到账${lateDays>0?` · 超期 ${esc(lateDays)} 天`:''}</span>`:''}${snoozed(o)?'<span class="chip c-gray">已设提醒</span>':''}</div>
    </div>
    ${isOver(o)?`<div class="banner-red"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/></svg><span>尾款自拍摄日（${esc(fmtD(o.shotAt))}）起已欠 <b>${esc(od)} 天</b>，达到 ${esc(db.threshold)} 天催收阈值，建议电话跟进。${snoozed(o)?`已备忘：${esc(fmtD(o.remindAt))} 再提醒。`:''}</span></div>`:''}
    <div class="mile-wrap"><div class="section-kicker" style="margin:0 6px 10px">交付轨道 / Delivery track</div><div class="mile" style="--p:${progress.toFixed(1)}%">${mile}</div></div>
    <div class="shotline"><button class="mini-btn" data-act="shot-pick" data-oid="${esc(o.id)}">${o.photoThumb?'重拍门口照':'随手拍 · 到店门口来一张'}</button>${o.photoThumb?`<button class="mini-btn" style="background:rgba(23,53,47,.06);color:var(--sub)" data-act="shot-clear" data-oid="${esc(o.id)}">删除照片</button>`:''}</div>
    ${detailActions(o)?`<div class="detail-next">${detailActions(o)}</div>`:''}
    ${o.submittedAt?detailSection('送审结果',`<div class="btn2"><button class="btn ${o.reviewResult==='pass'?'green':'ghost'}" data-act="set-review" data-oid="${esc(o.id)}" data-v="pass">${o.reviewResult==='pass'?'✓ 合格':'合格'}</button><button class="btn ${o.reviewResult==='fail'?'danger-ghost':'ghost'}" data-act="set-review" data-oid="${esc(o.id)}" data-v="fail">${o.reviewResult==='fail'?'✗ 不合格':'不合格'}</button></div>`):''}
    ${detailSection('收款',financeCard)}
    ${snoozeHtml}${expectHtml}
    ${detailSection('预约与店铺',infoCard)}
    ${o.note?`<div class="detail-section"><div class="detail-section-title"><h3>备注</h3></div><div class="card"><div class="rsub" style="white-space:normal;line-height:1.7">${esc(o.note)}</div></div></div>`:''}
    <div style="padding-top:18px;text-align:center"><button class="btn danger-ghost" data-act="del-order" data-oid="${esc(o.id)}">删除订单</button></div>`;
  showSheet('sheet-detail');
}

export function rerenderDetail(){
  if(ui.detail!=null&&ui.editId==null&&byId(ui.detail)){
    const body=$('#detail-body'),top=body?body.scrollTop:0;
    openDetail(ui.detail);
    if(body)body.scrollTop=top;
  }
}
