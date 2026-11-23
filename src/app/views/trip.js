/* ================= 渲染:行程(P0 §3) ================= */
import {$,esc,pad,dOff,TODAY,dowOf,fmtMoney as fmtMoneyBase,fmtHM,fmtD} from '../util.js';
import {db} from '../storage.js';
import {ui} from '../ui.js';
import {workChip,payChip,owedOf,unDep,upcoming7,accOrderIds,accMatch} from '../derived.js';
import {accBar,accTint,accChipbarHTML,dayBadge} from '../accounts.js';
import {headBtns} from '../stats.js';
/* 隐私模式:本文件全部金额渲染经此包装(P0 修复:双参化后调用点必须带 ui.privacy) */
const fmtMoney=n=>fmtMoneyBase(n,ui.privacy);

/* ================= 渲染:行程 ================= */
export function orderRowTrip(o){
  const depChip=unDep(o)>0?`<span class="chip c-red">待定金 ${fmtMoney(unDep(o))}</span>`:'';
  return `<div class="row${accBar(o)}" style="${accTint(o)}" data-act="open" data-oid="${o.id}">
    <div class="rside" style="width:52px"><div class="rprice" style="color:var(--brand)">${fmtHM(o.appt)}</div><div class="rsub" style="margin:0">${esc(o.cat)}</div></div>
    <div class="rmain"><div class="rname">${esc(o.store)}</div>
      <div class="chiprow">${workChip(o)}${depChip||payChip(o)}${o.channel&&o.channel!=='直客'?`<span class="chip c-gray">${esc(o.channel)}</span>`:''}</div></div>
    <div class="rside"><div class="rprice">${fmtMoney(o.price)}</div><div class="rsub">${owedOf(o)>0?'待收 '+fmtMoney(owedOf(o)):'已结清'}</div></div>
  </div>`;
}
export function renderTrip(){
  const {y,m}=ui.vMon;
  const first=new Date(y,m-1,1);
  const off=(first.getDay()+6)%7;
  const dim=new Date(y,m,0).getDate();
  const mOrders=db.orders.filter(accMatch).filter(o=>+o.appt.slice(0,4)===y&&+o.appt.slice(5,7)===m);
  const mSum=mOrders.reduce((s,o)=>s+o.price,0);
  // 日历头部原来只有成交额:排档期时更想知道"这个月已经收到多少"
  const mPrefix=`${y}-${pad(m)}`;
  const mPaidSum=db.payments.filter(p=>accOrderIds().has(p.oid)&&String(p.at||'').slice(0,7)===mPrefix).reduce((s,p)=>s+p.amount,0);
  const byDay={};mOrders.forEach(o=>{const k=o.appt.slice(0,10);if(!byDay[k])byDay[k]={n:0,s:0};byDay[k].n++;byDay[k].s+=o.price});
  let bFire=0,bMoney=0;Object.values(byDay).forEach(v=>{const b=dayBadge(v.n,v.s);if(b&&b.e==='🔥')bFire++;if(b&&b.e==='💰')bMoney++});
  const mBadges=(bFire?' 🔥'+bFire:'')+(bMoney?' 💰'+bMoney:'');
  let cells='';
  for(let i=0;i<off;i++)cells+='<div class="mc"></div>';
  for(let d=1;d<=dim;d++){
    const iso=`${y}-${pad(m)}-${pad(d)}`;
    const ds=mOrders.filter(o=>o.appt.slice(0,10)===iso);
    const dv=byDay[iso]||{n:0,s:0};
    const bdg=dayBadge(dv.n,dv.s);
    cells+=`<button class="mc ${iso===ui.selDay?'sel':''} ${iso===TODAY?'today':''}" data-act="day" data-day="${iso}" title="${bdg?bdg.t:''}">
      <span class="n">${d}</span><span class="d">${ds.length?'<i></i>'.repeat(Math.min(ds.length,6)):''}</span>${bdg?`<span class="bdg">${bdg.e}</span>`:''}</button>`;
  }
  const list=db.orders.filter(accMatch).filter(o=>o.appt.slice(0,10)===ui.selDay).sort((a,b)=>a.appt.localeCompare(b.appt));
  const listHtml=list.length?list.map(orderRowTrip).join('')
    : `<div class="empty"><div class="e-ic">📭</div>这一天暂无拍摄安排</div>`;
  const tomorrow=dOff(1).slice(0,10);
  // 整月时间线:所浏览月份的全部档期按日分组(可一路滚到月初/月末)
  let up='';
  const mdays=[...new Set(mOrders.map(o=>o.appt.slice(0,10)))].sort();
  for(const iso of mdays){
    const ds=mOrders.filter(o=>o.appt.slice(0,10)===iso).sort((a,b)=>a.appt.localeCompare(b.appt));
    const d=new Date(iso+'T00:00');
    const tag=iso===TODAY?' · 今天':(iso===tomorrow?' · 明天':'');
    up+=`<div class="sec-title">${d.getMonth()+1}月${d.getDate()}日 周${dowOf(iso)}${tag}</div>
    <div class="card rows">${ds.map(orderRowTrip).join('')}</div>`;
  }
  if(!up)up=`<div class="empty">${m}月暂无档期 · 点右上角「预约」新增</div>`;
  // 未来 7 天横滑条:排下周拍摄不必逐日点日历,先看"这周几单、忙在哪天"
  const week=upcoming7(),weekCount=week.reduce((s,d)=>s+d.count,0),weekSum=week.reduce((s,d)=>s+d.sum,0);
  const weekHtml=`<div class="sec-title" style="margin-top:14px;margin-bottom:6px"><span>未来 7 天${weekCount?` · ${weekCount} 单`:' · 暂无档期'}</span>${weekSum?`<span style="font-weight:600">${esc(fmtMoney(weekSum))}</span>`:''}</div>
    <div class="n7">${week.map((d,i)=>{
      const wd=i===0?'今天':i===1?'明天':`周${dowOf(d.day)}`;
      return `<button class="n7d ${d.day===ui.selDay?'on':''}" data-act="day" data-day="${d.day}">
        <div class="w">${wd}</div><div class="d">${d.day.slice(5,7)}-${d.day.slice(8,10)}</div><div class="c">${d.count?`${d.count} 单`:'空'}</div></button>`;
    }).join('')}</div>`;
  $('#v-trip').innerHTML=`
    <div class="htop-row">
      <div><div class="eyebrow">整月档期 · ‹ › 可翻月</div><h1 class="big">行程</h1>
      <div class="hsub">点按日期查看当日 · 分享按钮可生成当日行程图</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        ${headBtns(true)}
        <button class="btn-pill" data-act="new-order"><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>预约</button>
      </div>
    </div>
    ${accChipbarHTML()}
    <div class="mgrid">
      <div class="mhead">
        <div class="mtitle">${y}年${m}月<span class="msum">${mOrders.length} 个档期 · 成交 ${fmtMoney(mSum)} · 已收 ${fmtMoney(mPaidSum)}${mBadges}</span></div>
        <div class="mnav">
          <button data-act="mnav" data-d="-1">‹</button>
          <button data-act="mtoday" class="mtod">今天</button>
          <button data-act="mnav" data-d="1">›</button>
        </div>
      </div>
      <div class="mgrid-dow">${'一二三四五六日'.split('').map(x=>`<span>周${x}</span>`).join('')}</div>
      <div class="mgrid-c">${cells}</div>
    </div>
    ${weekHtml}
    <div class="sec-title">${ui.selDay===TODAY?'今日行程':`${+ui.selDay.slice(5,7)}月${+ui.selDay.slice(8,10)}日 周${dowOf(ui.selDay)}`}${list.length&&dayBadge(list.length,list.reduce((s,o)=>s+o.price,0))?` · ${dayBadge(list.length,list.reduce((s,o)=>s+o.price,0)).e} ${dayBadge(list.length,list.reduce((s,o)=>s+o.price,0)).t}`:''}</div>
    <div class="card rows">${listHtml}</div>
    <div class="sec-title">${m}月全部档期 · 往下滚看整月</div>
    ${up}`;
}
