/* ================= 渲染:统计 ================= */
import {$,esc,toISO,now,fmtD,fmtMoney as fmtMoneyBase} from '../util.js';
import {db} from '../storage.js';
import {ui} from '../ui.js';
import {owedOf,workOf,METHOD_CLS,accMatch} from '../derived.js';
import {statsFor,headBtns} from '../stats.js';
import {accChipbarHTML} from '../accounts.js';
const fmtMoney=n=>fmtMoneyBase(n,ui.privacy);

export function renderStats(){
  const st=statsFor(ui.period,db.orders.filter(accMatch)),avg=st.deals.length?Math.round(st.dealSum/st.deals.length*100)/100:0;
  let days=[];
  if(ui.period==='M'){const e=new Date(now.getFullYear(),now.getMonth(),now.getDate());for(let d=new Date(st.start);d<=e;d.setDate(d.getDate()+1))days.push(toISO(d))}
  else{for(let i=+ui.period-1;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-i);days.push(toISO(d))}}
  const daily=days.map(d=>st.paid.filter(p=>p.at.slice(0,10)===d).reduce((s,p)=>s+Math.round(p.amount*100),0)/100),mx=Math.max(...daily,1);
  const bars=daily.map((v,i)=>`<div class="bar ${v?'':'zero'}" title="${days[i]} 实收 ${fmtMoney(v)}"><i style="height:${Math.max(3,Math.round(v/mx*100))}%"></i></div>`).join('');
  const totOwed=db.orders.filter(accMatch).reduce((s,o)=>s+owedOf(o),0);
  const sending=db.orders.filter(accMatch).filter(o=>['后期中','发片中'].includes(workOf(o))).length;
  const segP=[['7','近 7 天'],['30','近 30 天'],['M','本月']].map(([k,l])=>`<button class="${ui.period===k?'on':''}" data-act="period" data-period="${k}">${l}</button>`).join('');
  const byM=Object.create(null);st.paid.forEach(p=>{byM[p.method]=(byM[p.method]||0)+p.amount});
  const entries=Object.entries(byM).sort((a,b)=>b[1]-a[1]),mxm=Math.max(...entries.map(e=>e[1]),1);
  const chRows=entries.length?entries.map(([m,v])=>`<div class="row" style="padding:10px 0"><span class="chip ${METHOD_CLS[m]||'c-gray'}" style="width:70px;justify-content:center">${esc(m)}</span><div style="flex:1;height:7px;background:rgba(23,53,47,.07);border-radius:4px;overflow:hidden"><i style="display:block;height:100%;width:${Math.max(4,Math.round(v/mxm*100))}%;background:var(--brand);border-radius:4px"></i></div><div class="rside" style="min-width:74px"><div class="rprice" style="font-size:13px">${fmtMoney(v)}</div></div></div>`).join(''):'<div class="empty" style="padding:18px 0">该区间暂无收款</div>';

  $('#v-stats').innerHTML=`
    <div class="app-header"><div><div class="eyebrow">Overview / 打开即刷新</div><h1 class="big">统计</h1><div class="hsub">看清收入，也看清还有多少没收回来。</div></div><div class="app-actions">${headBtns(false)}<button class="icon-btn" data-act="open-settings" aria-label="打开设置"><svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"/></svg></button></div></div>
    ${accChipbarHTML()}
    <div class="seg" style="margin-bottom:15px">${segP}</div>
    <div class="mini-grid">
      <div class="mini"><div class="mv">${fmtMoney(st.dealSum)}</div><div class="ml">成交额 · ${st.deals.length} 单</div></div>
      <div class="mini"><div class="mv" style="color:var(--green)">${fmtMoney(st.paidSum)}</div><div class="ml">实收金额 · ${st.paid.length} 笔</div></div>
      <div class="mini"><div class="mv" style="color:var(--brand-ink)">${st.done.length} 单</div><div class="ml">已交付完结（按交付日）</div></div>
      <div class="mini"><div class="mv">${fmtMoney(avg)}</div><div class="ml">客单价</div></div>
    </div>
    <div class="card" style="margin-top:13px"><div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:13px;font-weight:800">每日实收</span><span style="font-size:10px;color:var(--sub)">${ui.period==='M'?'本月':'近 '+ui.period+' 天'}合计 <b style="color:var(--green);font-size:12px">${fmtMoney(st.paidSum)}</b></span></div><div class="bars">${bars}</div><div class="bar-x"><span>${fmtD(days[0])}</span><span>${fmtD(days[days.length-1])}</span></div></div>
    <div class="card" style="margin-top:12px"><div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:13px;font-weight:800">收款渠道构成</span><span style="font-size:10px;color:var(--sub)">${ui.period==='M'?'本月':'近 '+ui.period+' 天'}</span></div><div style="margin-top:5px">${chRows}</div></div>
    <div class="card rows" style="margin-top:12px"><div class="row"><div class="rmain"><div class="rname" style="font-size:13.5px">当前待收款</div><div class="rsub">含定金与尾款</div></div><div class="rside"><div class="rprice" style="color:var(--orange)">${fmtMoney(totOwed)}</div></div></div><div class="row"><div class="rmain"><div class="rname" style="font-size:13.5px">待发片订单</div><div class="rsub">后期中 / 发片中</div></div><div class="rside"><div class="rprice" style="color:var(--orange)">${sending} 单</div></div></div></div>
    `;
}
