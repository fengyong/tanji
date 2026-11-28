/* ================= 渲染:统计 ================= */
import {$,esc,toISO,now,fmtD,fmtMoney as fmtMoneyBase} from '../util.js';
import {db} from '../storage.js';
import {ui} from '../ui.js';
import {owedOf,workOf,METHOD_CLS,accMatch} from '../derived.js';
import {statsFor,headBtns} from '../stats.js';
import {accChipbarHTML} from '../accounts.js';
const fmtMoney=n=>fmtMoneyBase(n,ui.privacy);

function dailyChartHTML(days,values,periodLabel,total){
  if(!values.some(v=>v>0))return `
    <div class="daily-head"><div><div class="daily-title">每日实收</div><div class="daily-meta">${periodLabel}</div></div><div class="daily-total"><span>合计</span><b>${fmtMoney(total)}</b></div></div>
    <div class="daily-empty" role="status"><span class="daily-empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V11M12 19V5M19 19v-5"/></svg></span><div><b>暂无收款</b><span>该区间还没有实收记录</span></div></div>`;
  const max=Math.max(...values),peak=values.indexOf(max),dense=days.length>14;
  const labelIndexes=days.length<=7?days.map((_,i)=>i):[...new Set([0,Math.floor((days.length-1)/3),Math.floor((days.length-1)*2/3),days.length-1])];
  const labels=new Set(labelIndexes);
  const bars=values.map((v,i)=>`<div class="bar ${v?'':'zero'} ${i===peak?'peak':''}" title="${days[i]} 实收 ${fmtMoney(v)}"><i style="--h:${v?Math.max(4,Math.round(v/max*100)):0}%"></i></div>`).join('');
  const axis=days.map((d,i)=>`<span class="${labels.has(i)?'':'axis-blank'}" aria-hidden="true">${labels.has(i)?fmtD(d):''}</span>`).join('');
  return `
    <div class="daily-head"><div><div class="daily-title">每日实收</div><div class="daily-meta">${periodLabel} · 最高 ${fmtMoney(max)}</div></div><div class="daily-total"><span>合计</span><b>${fmtMoney(total)}</b></div></div>
    <div class="daily-plot ${dense?'dense':''}" role="img" aria-label="${periodLabel}每日实收，合计 ${fmtMoney(total)}；${days[peak]} 最高 ${fmtMoney(max)}"><div class="daily-baseline"></div><div class="bars">${bars}</div></div>
    <div class="daily-axis">${axis}</div>`;
}

export function renderStats(){
  const st=statsFor(ui.period,db.orders.filter(accMatch)),avg=st.deals.length?Math.round(st.dealSum/st.deals.length*100)/100:0;
  let days=[];
  if(ui.period==='M'){const e=new Date(now.getFullYear(),now.getMonth(),now.getDate());for(let d=new Date(st.start);d<=e;d.setDate(d.getDate()+1))days.push(toISO(d))}
  else{for(let i=+ui.period-1;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-i);days.push(toISO(d))}}
  const daily=days.map(d=>st.paid.filter(p=>p.at.slice(0,10)===d).reduce((s,p)=>s+Math.round(p.amount*100),0)/100);
  const totOwed=db.orders.filter(accMatch).reduce((s,o)=>s+owedOf(o),0);
  const sending=db.orders.filter(accMatch).filter(o=>['后期中','发片中'].includes(workOf(o))).length;
  const segP=[['7','近 7 天'],['30','近 30 天'],['M','本月']].map(([k,l])=>`<button class="${ui.period===k?'on':''}" data-act="period" data-period="${k}">${l}</button>`).join('');
  const byM=Object.create(null);st.paid.forEach(p=>{byM[p.method]=(byM[p.method]||0)+p.amount});
  const entries=Object.entries(byM).sort((a,b)=>b[1]-a[1]),mxm=Math.max(...entries.map(e=>e[1]),1);
  const chRows=entries.length?entries.map(([m,v])=>`<div class="row" style="padding:10px 0"><span class="chip ${METHOD_CLS[m]||'c-gray'}" style="width:70px;justify-content:center">${esc(m)}</span><div style="flex:1;height:7px;background:rgba(23,53,47,.07);border-radius:4px;overflow:hidden"><i style="display:block;height:100%;width:${Math.max(4,Math.round(v/mxm*100))}%;background:var(--brand);border-radius:4px"></i></div><div class="rside" style="min-width:74px"><div class="rprice" style="font-size:13px">${fmtMoney(v)}</div></div></div>`).join(''):'<div class="empty" style="padding:18px 0">该区间暂无收款</div>';

  $('#v-stats').innerHTML=`
    <div class="app-header"><div><div class="eyebrow">Overview / 打开即刷新</div><h1 class="big">统计</h1><div class="hsub">看清收入，也看清还有多少没收回来。</div></div><div class="app-actions">${headBtns(false)}<button class="icon-btn" data-act="open-settings" aria-label="打开设置"><svg class="ic settings-gear" viewBox="0 0 24 24"><path d="M12 2.5a2.5 2.5 0 0 0-2.5 2.5v.6a6.4 6.4 0 0 0-1.2.7l-.5-.3a2.5 2.5 0 0 0-3.5 3.5l.3.5a6.4 6.4 0 0 0-.7 1.2h-.6a2.5 2.5 0 0 0 0 5h.6a6.4 6.4 0 0 0 .7 1.2l-.3.5a2.5 2.5 0 0 0 3.5 3.5l.5-.3a6.4 6.4 0 0 0 1.2.7v.6a2.5 2.5 0 0 0 5 0v-.6a6.4 6.4 0 0 0 1.2-.7l.5.3a2.5 2.5 0 0 0 3.5-3.5l-.3-.5a6.4 6.4 0 0 0 .7-1.2h.6a2.5 2.5 0 0 0 0-5h-.6a6.4 6.4 0 0 0-.7-1.2l.3-.5a2.5 2.5 0 0 0-3.5-3.5l-.5.3a6.4 6.4 0 0 0-1.2-.7V5A2.5 2.5 0 0 0 12 2.5Z"/><circle cx="12" cy="12" r="3"/></svg></button></div></div>
    ${accChipbarHTML()}
    <div class="seg" style="margin-bottom:15px">${segP}</div>
    <div class="mini-grid">
      <div class="mini"><div class="mv">${fmtMoney(st.dealSum)}</div><div class="ml">成交额 · ${st.deals.length} 单</div></div>
      <div class="mini"><div class="mv" style="color:var(--green)">${fmtMoney(st.paidSum)}</div><div class="ml">实收金额 · ${st.paid.length} 笔</div></div>
      <div class="mini"><div class="mv" style="color:var(--brand-ink)">${st.done.length} 单</div><div class="ml">已交付完结（按交付日）</div></div>
      <div class="mini"><div class="mv">${fmtMoney(avg)}</div><div class="ml">客单价</div></div>
    </div>
    <div class="card daily-card" style="margin-top:13px">${dailyChartHTML(days,daily,ui.period==='M'?'本月':'近 '+ui.period+' 天',st.paidSum)}</div>
    <div class="card" style="margin-top:12px"><div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:13px;font-weight:800">收款渠道构成</span><span style="font-size:10px;color:var(--sub)">${ui.period==='M'?'本月':'近 '+ui.period+' 天'}</span></div><div style="margin-top:5px">${chRows}</div></div>
    <div class="card rows" style="margin-top:12px"><div class="row"><div class="rmain"><div class="rname" style="font-size:13.5px">当前待收款</div><div class="rsub">含定金与尾款</div></div><div class="rside"><div class="rprice" style="color:var(--orange)">${fmtMoney(totOwed)}</div></div></div><div class="row"><div class="rmain"><div class="rname" style="font-size:13.5px">待发片订单</div><div class="rsub">后期中 / 发片中</div></div><div class="rside"><div class="rprice" style="color:var(--orange)">${sending} 单</div></div></div></div>
    `;
}
