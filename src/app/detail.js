/* ================= 详情弹层(P0 §3,含 rerenderDetail) ================= */
import {$,esc,fmtMoney as fmtMoneyBase,fmtD,fmtHM,fmtDT} from './util.js';
import {db} from './storage.js';
import {ui} from './ui.js';
import {byId,overdueDays,orderMoney,moneyCents,unDep,unFin,isOver,payOf,remindLogOf,expectOverdue,snoozed,owedOf,workChip,payChip,deliverLate,REVIEW_LABEL,gpsText,needMain,needSub,deliveredAll} from './derived.js';
import {accMulti,accTagHTML,accById} from './accounts.js';
import {showSheet} from './sheets.js';
/* 隐私模式:本文件全部金额渲染经此包装(P0 修复:双参化后调用点必须带 ui.privacy) */
const fmtMoney=n=>fmtMoneyBase(n,ui.privacy);

/* ================= 详情弹层 ================= */
export const MILE_LABEL={shotAt:'拍摄',submittedAt:'提审',shortAt:'副片发出',longAt:'正片发出',publishedAt:'发布'};
/* 每个里程碑一种颜色:起点暖橙 → 审核蓝 → 两种交付物(紫/绿) → 终点中性灰蓝 */
const MILE_COLOR={
  shotAt:{c:'#E8663C',soft:'#FCEFE8'},
  submittedAt:{c:'#3B7DD8',soft:'#EDF3FC'},
  shortAt:{c:'#8B6BC4',soft:'#F3EEFA'},
  longAt:{c:'#2FA05F',soft:'#EAF6EE'},
  publishedAt:{c:'#5C6B7A',soft:'#EDEFF2'},
};
const MILE_BIG=new Set(['shortAt','longAt']);  // 发片是交付核心,圆点放大一号
function mileStep(oid,key,label,time,done,nowFlag){
  const tone=MILE_COLOR[key]||{c:'var(--brand)',soft:'var(--brand-soft)'};
  const big=MILE_BIG.has(key)?'big':'';
  // 拍摄完成且有随手拍 → 圆点直接显示门口照:流程条本身就能证明"到过店",不必再加文字
  const target=byId(oid);
  const photo=key==='shotAt'&&done&&target&&target.photoThumb
    ? `<img src="${target.photoThumb}" alt="">`
    : (done?'✓':(nowFlag?'·':''));
  // 未来节点用变暗表达"还没到这一步",但**不置 disabled**:置了按钮就点不动,
  // 用户只会看到"点了没反应";让点击交给 mark() 的前置守卫,至少能告诉他
  // 「请先完成『提审』再标记『副片发出』」——比默默吞掉点击有用得多。
  const clickable=done||nowFlag;
  return `<button class="mstep ${big} ${done?'done':''} ${!done&&nowFlag?'now':''}" ${clickable?'':'aria-disabled="true"'} data-act="mile" data-oid="${esc(oid)}" data-key="${esc(key)}" style="background:none;border:none;padding:0;${clickable?'':'opacity:.45;'}--c:${tone.c};--soft:${tone.soft}">
    <div class="mdotwrap"><div class="mdot">${photo}</div></div>
    <div class="mlab">${esc(label)}</div><div class="mtime">${done?esc(fmtDT(time)):(nowFlag?'点击标记':'')}</div></button>`;
}
/* 金额格:有随手拍就把淡化小图铺成底图,扫列表一眼分出"去过店"和"还没去" */
export function priceCell(o){
  const money=fmtMoney(o.price);
  return o.photoThumb
    ? `<div class="rprice shot" style="background-image:url('${o.photoThumb}')"><span>${money}</span></div>`
    : `<div class="rprice">${money}</div>`;
}
function detailActions(o){
  if(!o.shotAt)return `<button class="btn primary" data-act="mark-shot" data-oid="${esc(o.id)}">标记已拍摄(记录实际拍摄时间)</button>`;
  if(!o.submittedAt)return `<button class="btn primary" data-act="mark-submit" data-oid="${esc(o.id)}">标记已提审</button>`;
  const btns=[];
  if(needSub(o))btns.push(`<button class="btn ${o.shortAt?'ghost':'tint'}" data-act="mark-short" data-oid="${esc(o.id)}" ${o.shortAt?'disabled':''}>${o.shortAt?'副片已发':'标记发副片'}</button>`);
  if(needMain(o))btns.push(`<button class="btn ${o.longAt?'ghost':'tint'}" data-act="mark-long" data-oid="${esc(o.id)}" ${o.longAt?'disabled':''}>${o.longAt?'正片已发':'标记发正片'}</button>`);
  if(deliveredAll(o)&&!o.publishedAt)btns.push(`<button class="btn primary" data-act="mile" data-oid="${esc(o.id)}" data-key="publishedAt">标记已发布</button>`);
  return btns.length?`<div class="btn2">${btns.join('')}</div>`:'';
}
/**
 * 行内"下一步":把 detailActions 的判定提到列表层,让待发片的单不必进详情就能推进。
 * 顺序与详情页一致:提审 → 副片 → 正片 → 发布;返回 null 表示当前没有该做的事。
 */
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
export function openDetail(id){
  const o=byId(id);if(!o){ui.detail=null;return}
  ui.detail=id;ui.payCtx=null;ui.editId=null;
  const od=overdueDays(o),money=orderMoney(o);
  const steps=[['shotAt',o.shotAt],['submittedAt',o.submittedAt],['shortAt',needSub(o)?(o.shortAt||''):'skip'],['longAt',needMain(o)?(o.longAt||''):'skip'],['publishedAt',o.publishedAt]];
  const visibleSteps=steps.filter(s=>s[1]!=='skip');
  const nextIdx=visibleSteps.findIndex(s=>!s[1]);
  const mile=visibleSteps.map((s,i)=>mileStep(o.id,s[0],MILE_LABEL[s[0]],s[1],!!s[1],i===nextIdx)).join('');
  // 进度线画到"最后一个已完成节点的中心":可用宽度 = 100% - 左右各 14% 缩进
  let lastDone=-1;visibleSteps.forEach((s,i)=>{if(s[1])lastDone=i});
  const progress=lastDone<0?0:((lastDone+0.5)/visibleSteps.length)*72;
  const received=db.payments.filter(p=>p.oid===o.id).reduce((s,p)=>s+(moneyCents(p.amount)||0),0)/100;

  const payBtns=[];
  if(unDep(o)>0)payBtns.push(`<button class="btn tint-blue" data-act="open-pay" data-oid="${esc(o.id)}" data-kind="deposit">收定金 ${esc(fmtMoney(unDep(o)))}</button>`);
  if(unFin(o)>0)payBtns.push(`<button class="btn ${isOver(o)?'primary':'pay'}" data-act="open-pay" data-oid="${esc(o.id)}" data-kind="final">收尾款<span class="pmoney">${esc(fmtMoney(unFin(o)))}</span></button>`);
  if(!payBtns.length)payBtns.push(`<div style="text-align:center;color:#239648;font-weight:800;font-size:14px;padding:6px 0">款项已全部结清</div>`);

  // 催收跟进:remindAt 只回答"下次什么时候提醒",痕迹才回答"催过几次、对方怎么答"
  let snoozeHtml='';
  if(payOf(o)==='待尾款'){
    const log=remindLogOf(o),last=log[log.length-1],recent=log.slice(-4).reverse();
    // 「已设提醒」只认未到期的备忘:时间一过提醒就响完了,再写「MM-DD 再催收」说的是个过去的日期
    // (列表页/收款页的「已设提醒」标签都走 snoozed,这里是同一口径)
    snoozeHtml=`<div class="sec-title" style="margin-top:16px">催收跟进<span class="more" data-act="remind-open" data-oid="${esc(o.id)}">再催一次 ›</span></div>
      <div class="card" style="background:#F8F8FA;box-shadow:none;padding:12px 13px">
        <div class="rsub" style="margin:0${recent.length?' 0 8px':''};line-height:1.5">${log.length?`已催 ${log.length>=50?'50+':log.length} 次 · 最近 ${esc(fmtDT(last.at))}`:'还没催过;第一次跟进也记一笔,对方怎么答下次不用重新问'}</div>
        ${recent.map(entry=>`<div class="rline"><span class="rt">${esc(fmtD(entry.at))} ${esc(fmtHM(entry.at))}</span><span class="rn">${entry.note?esc(entry.note):'已催'}</span></div>`).join('')}
        ${log.length>recent.length?`<div class="rsub" style="margin-top:6px">另有 ${log.length-recent.length} 次更早的跟进</div>`:''}
      </div>
      <div class="sec-title" style="margin-top:14px">催收备忘(打开 App 时查看)</div>
      <div class="btn2">
        <button class="btn ghost" data-act="snooze" data-oid="${esc(o.id)}" data-d="1">1天后提醒</button>
        <button class="btn ghost" data-act="snooze" data-oid="${esc(o.id)}" data-d="3">3天后提醒</button>
        <button class="btn ghost" data-act="snooze" data-oid="${esc(o.id)}" data-d="7">7天后提醒</button>
      </div>
      ${snoozed(o)?`<div class="rsub" style="text-align:center;margin-top:8px">已设提醒:${esc(fmtD(o.remindAt))} 再催收 <button class="mini-btn" style="background:#F1F1F5;color:#7a7a82" data-act="clear-remind" data-oid="${esc(o.id)}">清除</button></div>`:''}`;
  }

  // 平台单(抖音商单)的钱不由达人催,但"说好 T+7 到账"必须能落成日期,
  // 否则现金流预测缺一块、过期没到账也无人提醒。
  let expectHtml='';
  const lateDays=expectOverdue(o);
  if(o.settleVia==='douyin'){
    const late=lateDays;
    expectHtml=`<div class="sec-title" style="margin-top:16px">平台到账</div>
      <div class="card" style="background:#F8F8FA;box-shadow:none;padding:12px 13px">
        <div class="rsub" style="margin:0;line-height:1.6">${o.expectPayAt
          ?`预计 ${esc(fmtD(o.expectPayAt))} 到账${late>0?` · <b style="color:var(--red)">已超期 ${late} 天</b>,去平台后台看结算状态`:''}`
          :'还没填预计到账日。填上之后:首页/收款页会提示"预计哪天到账",过期未到账标红提醒。'}</div>
      </div>
      <div class="btn2" style="margin-top:8px">
        <button class="btn ghost" data-act="expect-open" data-oid="${esc(o.id)}">${o.expectPayAt?'修改预计到账日':'设置预计到账日'}</button>
        ${o.expectPayAt?`<button class="btn ghost" data-act="expect-clear" data-oid="${esc(o.id)}">清除</button>`:''}
      </div>`;
  }

  $('#detail-body').innerHTML=`
    <div class="sheet-head" style="padding-left:0;padding-right:0">
      <div style="min-width:0">
        <div class="sheet-title" style="font-size:19px">${esc(o.store)}</div>
        <div class="hsub" style="margin-top:3px">${esc(o.cat)}${o.contact?' · '+esc(o.contact):''}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="sheet-close" data-act="copy-order" data-oid="${esc(o.id)}" title="复制订单" aria-label="复制订单"><svg class="ic" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="12" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
        <button class="sheet-close" data-act="edit-order" data-oid="${esc(o.id)}" title="编辑" style="background:var(--brand-soft);color:var(--brand)"><svg class="ic" viewBox="0 0 24 24"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/></svg></button>
        <button class="sheet-close" data-act="close-sheet"><svg class="ic" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
    </div>
    <div class="chiprow" style="margin:4px 0 2px">${workChip(o)}${payChip(o)}${o.reviewResult?`<span class="chip ${o.reviewResult==='pass'?'c-green':'c-red'}">${REVIEW_LABEL[o.reviewResult]}</span>`:''}${deliverLate(o)?`<span class="chip c-red">超24h未出片</span>`:''}${isOver(o)?`<span class="chip c-red">欠款 ${esc(od)} 天</span>`:''}${o.settleVia==='douyin'&&o.expectPayAt&&unFin(o)>0?`<span class="chip ${lateDays>0?'c-red':'c-blue'}">预计 ${esc(fmtD(o.expectPayAt))} 到账${lateDays>0?` · 超期 ${esc(lateDays)} 天`:''}</span>`:''}${snoozed(o)?`<span class="chip c-gray">已设提醒</span>`:''}</div>
    ${isOver(o)?`<div class="banner-red"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/></svg>
      <span>尾款自拍摄日(${esc(fmtD(o.shotAt))})起已欠 <b>${esc(od)} 天</b>,达到 ${esc(db.threshold)} 天催收阈值,建议电话跟进。${snoozed(o)?`已备忘:${esc(fmtD(o.remindAt))} 再提醒。`:''}</span></div>`:''}
    <div class="mile" style="--p:${progress.toFixed(1)}%">${mile}</div>
    <div class="shotline">
      <button class="mini-btn" data-act="shot-pick" data-oid="${esc(o.id)}">📷 ${o.photoThumb?'重拍门口照':'随手拍 · 到店门口来一张'}</button>
      ${o.photoThumb?`<button class="mini-btn" style="background:#F1F1F5;color:#7a7a82" data-act="shot-clear" data-oid="${esc(o.id)}">删除照片</button>`:''}
    </div>
    <div style="margin-top:10px">${detailActions(o)}</div>
    ${o.submittedAt?`<div class="sec-title" style="margin-top:14px">送审结果</div>
      <div class="btn2">
        <button class="btn ${o.reviewResult==='pass'?'green':'ghost'}" data-act="set-review" data-oid="${esc(o.id)}" data-v="pass">${o.reviewResult==='pass'?'✓ 合格':'合格'}</button>
        <button class="btn ${o.reviewResult==='fail'?'danger-ghost':'ghost'}" data-act="set-review" data-oid="${esc(o.id)}" data-v="fail">${o.reviewResult==='fail'?'✗ 不合格':'不合格'}</button>
      </div>`:''}
    <div class="sec-title" style="margin-top:16px">收款</div>
    ${payBtns.join('')}
    ${snoozeHtml}
    ${expectHtml}
    <div class="info-grid">
      <div class="ig"><div class="k">预约时间</div><div class="v">${esc(fmtD(o.appt))} ${esc(fmtHM(o.appt))}</div></div>
      <div class="ig"><div class="k">实际拍摄</div><div class="v">${esc(fmtDT(o.shotAt))}</div></div>
      ${accMulti()?`<div class="ig"><div class="k">账号</div><div class="v" style="display:flex;align-items:center;gap:6px">${accTagHTML(accById(o.accountId))}<button class="mini-btn" data-act="copy-account" data-id="${o.accountId??''}">拷贝</button></div></div>`:''}
      <div class="ig"><div class="k">地点</div><div class="v">${esc(o.location||'—')}${o.location?`<button class="mini-btn" style="padding:4px 9px;font-size:11.5px;margin-left:6px;vertical-align:middle" data-act="nav-place" data-oid="${esc(o.id)}">导航</button>`:''}</div></div>
      <div class="ig"><div class="k">到店定位</div><div class="v">${o.gpsPlace?`${esc(gpsText(o))}<button class="mini-btn" style="padding:4px 9px;font-size:11.5px;margin-left:6px;vertical-align:middle" data-act="nav-place" data-oid="${esc(o.id)}" data-gps="1">看位置</button>`:`<button class="mini-btn" style="padding:4px 9px;font-size:11.5px" data-act="locate-now" data-oid="${esc(o.id)}">记录当前位置</button>`}</div></div>
      <div class="ig"><div class="k">发布时间</div><div class="v">${esc(fmtDT(o.publishedAt))}</div></div>
      <div class="ig"><div class="k">服务商</div><div class="v">${esc(o.channel||'直客')}</div></div>
      <div class="ig"><div class="k">组队</div><div class="v">${esc(o.partner||(o.note&&o.note.includes('不组队')?'不组队':'—'))}</div></div>
      <div class="ig"><div class="k">总价</div><div class="v">${esc(fmtMoney(o.price))}</div></div>
      <div class="ig"><div class="k">定金 ${o.depositPaidAt?'· 已收 '+esc(fmtD(o.depositPaidAt)):''}</div><div class="v">${esc(fmtMoney(o.deposit))}</div></div>
      <div class="ig"><div class="k">尾款 ${o.finalPaidAt?'· 已收 '+esc(fmtD(o.finalPaidAt)):''}</div><div class="v">${esc(fmtMoney(money?money.final/100:0))}</div></div>
      <div class="ig"><div class="k">已收合计</div><div class="v" style="color:#239648">${received>0?esc(fmtMoney(received)):'—'}</div></div>
      <div class="ig"><div class="k">当前待收</div><div class="v" style="${owedOf(o)>0?'color:var(--red)':'color:#239648'}">${owedOf(o)>0?esc(fmtMoney(owedOf(o))):'已结清'}</div></div>
      <div class="ig"><div class="k">结算方式</div><div class="v">${o.settleVia==='douyin'?'抖音商单':'私收'}</div></div>
    </div>
    ${o.note?`<div class="card" style="margin-top:12px;background:#F8F8FA;box-shadow:none"><div class="rsub" style="white-space:normal;line-height:1.6">${esc(o.note)}</div></div>`:''}
    <div style="padding-top:16px"><button class="btn danger-ghost" data-act="del-order" data-oid="${esc(o.id)}">删除订单</button></div>`;
  showSheet('sheet-detail');
}

export function rerenderDetail(){if(ui.detail!=null&&ui.editId==null&&byId(ui.detail))openDetail(ui.detail)}
