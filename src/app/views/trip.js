/* ================= 渲染:行程 ================= */
import {$,esc,pad,dOff,TODAY,dowOf,toISO,fmtMoney as fmtMoneyBase,fmtHM,fmtD} from '../util.js';
import {db} from '../storage.js';
import {ui} from '../ui.js';
import {workChip,payChip,owedOf,unDep,upcoming7,accOrderIds,accMatch} from '../derived.js';
import {accBar,accTint,accOrderTag,accChipbarHTML,dayBadge} from '../accounts.js';
import {headBtns} from '../stats.js';
const fmtMoney=n=>fmtMoneyBase(n,ui.privacy);

export function orderRowTrip(o){
  const depChip=unDep(o)>0?`<span class="chip c-red">待定金 ${fmtMoney(unDep(o))}</span>`:'';
  return `<div class="row trip-row${accBar(o)}" style="${accTint(o)}" data-act="open" data-oid="${o.id}">
    <div class="trip-row-head">
      <div class="rside" style="width:52px"><div class="rprice" style="color:var(--brand-ink);font-family:var(--display);font-size:21px;letter-spacing:-.5px">${fmtHM(o.appt)}</div><div class="rsub" style="margin:3px 0 0">${esc(o.cat)}</div></div>
      <div class="rmain"><div class="rname">${esc(o.store)}</div>${o.location?`<div class="rsub trip-place">${esc(o.location)}</div>`:''}</div>
      <div class="rside"><div class="rprice">${fmtMoney(o.price)}</div><div class="rsub">${owedOf(o)>0?'待收 '+fmtMoney(owedOf(o)):'已结清'}</div></div>
      <button class="icon-btn" style="background:var(--brand-soft);color:var(--brand-ink);box-shadow:none;border-color:transparent" data-act="edit-order" data-oid="${esc(o.id)}" aria-label="编辑 ${esc(o.store)}" title="编辑订单"><svg class="ic" viewBox="0 0 24 24"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/></svg></button>
    </div>
    <div class="chiprow trip-chips">${accOrderTag(o)}${workChip(o)}${depChip||payChip(o)}${o.channel&&o.channel!=='直客'?`<span class="chip c-gray">${esc(o.channel)}</span>`:''}</div>
  </div>`;
}

export function renderTrip(){
  const {y,m}=ui.vMon,first=new Date(y,m-1,1),off=(first.getDay()+6)%7,dim=new Date(y,m,0).getDate();
  const mOrders=db.orders.filter(accMatch).filter(o=>+o.appt.slice(0,4)===y&&+o.appt.slice(5,7)===m);
  const mSum=mOrders.reduce((s,o)=>s+o.price,0),mPrefix=`${y}-${pad(m)}`;
  const mPaidSum=db.payments.filter(p=>accOrderIds().has(p.oid)&&String(p.at||'').slice(0,7)===mPrefix).reduce((s,p)=>s+p.amount,0);
  const byDay={};mOrders.forEach(o=>{const k=o.appt.slice(0,10);if(!byDay[k])byDay[k]={n:0,s:0};byDay[k].n++;byDay[k].s+=o.price});
  let bFire=0,bMoney=0;Object.values(byDay).forEach(v=>{const b=dayBadge(v.n,v.s);if(b&&b.e==='🔥')bFire++;if(b&&b.e==='💰')bMoney++});
  const mBadges=(bFire?' · 🔥'+bFire:'')+(bMoney?' · 💰'+bMoney:'');
  let cells='';for(let i=0;i<off;i++)cells+='<div class="mc"></div>';
  for(let d=1;d<=dim;d++){
    const iso=`${y}-${pad(m)}-${pad(d)}`,ds=mOrders.filter(o=>o.appt.slice(0,10)===iso),dv=byDay[iso]||{n:0,s:0},bdg=dayBadge(dv.n,dv.s);
    cells+=`<button class="mc ${iso===ui.selDay?'sel':''} ${iso===TODAY?'today':''}" data-act="day" data-day="${iso}" title="${bdg?bdg.t:''}" aria-label="${iso}，${ds.length} 个预约">
      <span class="n">${d}</span><span class="d">${ds.length?'<i></i>'.repeat(Math.min(ds.length,6)):''}</span>${bdg?`<span class="bdg">${bdg.e}</span>`:''}</button>`;
  }
  const list=db.orders.filter(accMatch).filter(o=>o.appt.slice(0,10)===ui.selDay).sort((a,b)=>a.appt.localeCompare(b.appt));
  const listHtml=list.length?list.map(orderRowTrip).join(''):`<div class="empty"><div class="e-ic">◌</div>这一天暂无拍摄安排<br>点右上角预约，把下一趟记下来</div>`;
  const daySum=list.reduce((s,o)=>s+o.price,0),dayBadgeInfo=dayBadge(list.length,daySum);
  const tomorrow=dOff(1).slice(0,10);
  let up='';const mdays=[...new Set(mOrders.map(o=>o.appt.slice(0,10)))].sort();
  for(const iso of mdays){
    const ds=mOrders.filter(o=>o.appt.slice(0,10)===iso).sort((a,b)=>a.appt.localeCompare(b.appt)),d=new Date(iso+'T00:00');
    const tag=iso===TODAY?' · 今天':(iso===tomorrow?' · 明天':'');
    up+=`<div class="sec-title">${d.getMonth()+1}月${d.getDate()}日 · 周${dowOf(iso)}${tag}</div><div class="card rows">${ds.map(orderRowTrip).join('')}</div>`;
  }
  if(!up)up=`<div class="empty">${m} 月暂无档期 · 点右上角「预约」新增</div>`;
  const week=upcoming7(),weekCount=week.reduce((s,d)=>s+d.count,0),weekSum=week.reduce((s,d)=>s+d.sum,0);
  const weekHtml=`<div class="sec-title" style="margin-top:18px;margin-bottom:7px"><span>未来 7 天${weekCount?` · ${weekCount} 单`:' · 暂无档期'}</span>${weekSum?`<span style="font-weight:650">${esc(fmtMoney(weekSum))}</span>`:''}</div>
    <div class="n7">${week.map((d,i)=>{const wd=i===0?'今天':i===1?'明天':`周${dowOf(d.day)}`;return `<button class="n7d ${d.day===ui.selDay?'on':''}" data-act="day" data-day="${d.day}"><div class="w">${wd}</div><div class="d">${d.day.slice(5,7)}-${d.day.slice(8,10)}</div><div class="c">${d.count?`${d.count} 单`:'空'}</div></button>`}).join('')}</div>`;

  $('#v-trip').innerHTML=`
    <div class="app-header"><div><div class="eyebrow">Monthly schedule / 整月档期</div><h1 class="big">行程</h1><div class="hsub">左右滑动切日 · 点日期查看当天安排</div></div>
      <div class="app-actions">${headBtns(true)}<button class="btn-pill" data-act="new-order"><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>预约</button></div></div>
    ${accChipbarHTML()}
    <div class="mgrid">
      <div class="mhead"><div class="mtitle">${y}年 ${m}月<span class="msum">${mOrders.length} 个档期 · 成交 ${fmtMoney(mSum)} · 实收 ${fmtMoney(mPaidSum)}${mBadges}</span></div>
        <div class="mnav"><button data-act="mnav" data-d="-1" aria-label="上个月">‹</button><button data-act="mtoday" class="mtod">今天</button><button data-act="mnav" data-d="1" aria-label="下个月">›</button></div></div>
      <div class="mgrid-dow">${'一二三四五六日'.split('').map(x=>`<span>周${x}</span>`).join('')}</div><div class="mgrid-c">${cells}</div>
    </div>
    ${weekHtml}
    <div class="sec-title" style="margin-top:20px"><span>${ui.selDay===TODAY?'今日行程':`${+ui.selDay.slice(5,7)}月${+ui.selDay.slice(8,10)}日 · 周${dowOf(ui.selDay)}`}${dayBadgeInfo?` · ${dayBadgeInfo.e} ${dayBadgeInfo.t}`:''}</span><span class="more" role="button" tabindex="0" data-act="share">分享当日 ›</span></div>
    <div class="card rows">${listHtml}</div>
    <div class="sec-title">${m} 月全部档期 <span class="rsub">往下滚看整月</span></div>${up}`;
}

export function tripSwipeStep(dx,dy,duration){
  const ax=Math.abs(dx),ay=Math.abs(dy);
  if(duration<0||duration>800||ax<56||ay>48||ax<ay*1.35)return 0;
  return dx<0?1:-1;
}
export function shiftTripDay(step){
  if(step!==1&&step!==-1)return;
  const date=new Date(ui.selDay+'T00:00:00');if(Number.isNaN(date.getTime()))return;
  date.setDate(date.getDate()+step);ui.selDay=toISO(date);ui.vMon={y:date.getFullYear(),m:date.getMonth()+1};renderTrip();
}
export function initTripGestures(){
  const view=$('#v-trip');if(!view)return;let start=null;const reset=()=>{start=null};
  view.addEventListener('touchstart',event=>{
    if(ui.tab!=='trip'||event.touches.length!==1||event.target.closest?.('.n7,.chipbar')){reset();return}
    const touch=event.touches[0];start={id:touch.identifier,x:touch.clientX,y:touch.clientY,at:event.timeStamp};
  },{passive:true});
  view.addEventListener('touchmove',event=>{if(start&&event.touches.length!==1)reset()},{passive:true});
  view.addEventListener('touchend',event=>{
    if(!start||ui.tab!=='trip'){reset();return}
    const touch=Array.from(event.changedTouches).find(item=>item.identifier===start.id);if(!touch){reset();return}
    const step=tripSwipeStep(touch.clientX-start.x,touch.clientY-start.y,event.timeStamp-start.at);reset();if(!step)return;
    event.preventDefault();shiftTripDay(step);
  },{passive:false});
  view.addEventListener('touchcancel',reset,{passive:true});
}
