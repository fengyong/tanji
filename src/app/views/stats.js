/* ================= 渲染:统计(P0 §3) ================= */
import {$,esc,toISO,now,fmtD,fmtMoney as fmtMoneyBase} from '../util.js';
import {LEGAL_BASE,APP_STORE_URL,isNative} from '../env.js';
import {db,Store} from '../storage.js';
import {ui} from '../ui.js';
import {owedOf,workOf,METHOD_CLS,accMatch} from '../derived.js';
import {ACCS,accMulti,accAvatarHTML,accColor} from '../accounts.js';
import {statsFor,headBtns} from '../stats.js';
import {accChipbarHTML} from '../accounts.js';
/* 隐私模式:本文件全部金额渲染经此包装(P0 修复:双参化后调用点必须带 ui.privacy) */
const fmtMoney=n=>fmtMoneyBase(n,ui.privacy);

/* ================= 渲染:统计 ================= */
function accountSectionHtml(){
  const accs=ACCS();
  if(!accs.length)return `<div class="menu-row" data-act="open-account">
    <span class="menu-ic" style="background:var(--brand-soft);color:var(--brand)"><svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5.5 19.5c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/></svg></span>
    <div class="menu-t"><div class="menu-name">添加账号</div><div class="menu-sub">多账号达人:订单挂账号、资料一键拷贝去报名;单账号数据自动归属,界面零打扰</div></div>
    <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg></div>`;
  let html='';
  for(const a of accs){
    const c=accColor(a);const n=db.orders.filter(o=>o.accountId===a.id).length;
    html+=`<div class="row" style="background:${c.bg};border-radius:14px;align-items:center;gap:12px">
      ${accAvatarHTML(a)}
      <div style="flex:1;min-width:0"><div class="rname" style="font-size:14.5px">${esc(a.name)}</div>
        <div class="rsub">抖音:${esc(a.douyin||'—')} · 手机 ${esc(a.phone||'—')} · ${n} 单</div></div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="mini-btn" data-act="copy-account" data-id="${a.id}">拷贝</button>
        <button class="mini-btn" style="background:rgba(0,0,0,.06);color:#55555e" data-act="open-account" data-id="${a.id}">编辑</button></div>
    </div>`;
  }
  const unassigned=accMulti()?db.orders.filter(o=>o.accountId==null).length:0;
  if(unassigned)html+=`<div class="row" style="align-items:center;gap:10px">
    <div class="rmain"><div class="rsub" style="color:var(--orange)">${unassigned} 笔订单未指定账号(含历史单)</div></div>
    <button class="mini-btn" data-act="assign-open">批量改挂</button></div>`;
  return html;
}
export function renderStats(){
  const st=statsFor(ui.period,db.orders.filter(accMatch));
  // 客单价保留到分:Math.round 取整会把 750.5 显示成 751、0.4 元/单显示成 ¥0,
  // 与「金额精确到分」的整体口径相悖
  const avg=st.deals.length?Math.round(st.dealSum/st.deals.length*100)/100:0;
  let days=[];
  if(ui.period==='M'){const e=new Date(now.getFullYear(),now.getMonth(),now.getDate());for(let d=new Date(st.start);d<=e;d.setDate(d.getDate()+1))days.push(toISO(d))}
  else{for(let i=+ui.period-1;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-i);days.push(toISO(d))}}
  const daily=days.map(d=>st.paid.filter(p=>p.at.slice(0,10)===d).reduce((s,p)=>s+Math.round(p.amount*100),0)/100);
  const mx=Math.max(...daily,1);
  const bars=daily.map((v,i)=>`<div class="bar ${v?'':'zero'}" title="${days[i]} 实收 ${fmtMoney(v)}"><i style="height:${Math.max(3,Math.round(v/mx*100))}%"></i></div>`).join('');
  const totOwed=db.orders.filter(accMatch).reduce((s,o)=>s+owedOf(o),0);
  const sending=db.orders.filter(accMatch).filter(o=>['后期中','发片中'].includes(workOf(o))).length;
  const segP=[['7','近7天'],['30','近30天'],['M','本月']].map(([k,l])=>`<button class="${ui.period===k?'on':''}" data-act="period" data-period="${k}">${l}</button>`).join('');

  const byM=Object.create(null);st.paid.forEach(p=>{byM[p.method]=(byM[p.method]||0)+p.amount});
  const entries=Object.entries(byM).sort((a,b)=>b[1]-a[1]);
  const mxm=Math.max(...entries.map(e=>e[1]),1);
  const chRows=entries.length?entries.map(([m,v])=>`
    <div class="row" style="padding:9px 0">
      <span class="chip ${METHOD_CLS[m]||'c-gray'}" style="width:70px;justify-content:center">${esc(m)}</span>
      <div style="flex:1;height:8px;background:#F0F0F4;border-radius:4px;overflow:hidden"><i style="display:block;height:100%;width:${Math.max(4,Math.round(v/mxm*100))}%;background:var(--brand);border-radius:4px"></i></div>
      <div class="rside" style="min-width:74px"><div class="rprice" style="font-size:13.5px">${fmtMoney(v)}</div></div>
    </div>`).join('')
    : '<div class="empty" style="padding:18px 0">该区间暂无收款</div>';

  $('#v-stats').innerHTML=`
    <div class="htop-row"><div><div class="eyebrow">实时统计 · 打开即刷新</div><h1 class="big">统计</h1></div>
    <div style="display:flex;gap:8px">${headBtns(false)}</div></div>
    ${accChipbarHTML()}
    <div class="seg" style="margin-bottom:14px">${segP}</div>
    <div class="mini-grid">
      <div class="mini"><div class="mv">${fmtMoney(st.dealSum)}</div><div class="ml">成交额 · ${st.deals.length} 单</div></div>
      <div class="mini"><div class="mv" style="color:#239648">${fmtMoney(st.paidSum)}</div><div class="ml">实收金额 · ${st.paid.length} 笔</div></div>
      <div class="mini"><div class="mv" style="color:var(--brand)">${st.done.length} 单</div><div class="ml">已交付完结(按交付日)</div></div>
      <div class="mini"><div class="mv">${fmtMoney(avg)}</div><div class="ml">客单价</div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:14px;font-weight:800">每日实收</span>
        <span style="font-size:11.5px;color:var(--sub)">${ui.period==='M'?'本月':'近'+ui.period+'天'}合计 <b style="color:#239648;font-size:13px">${fmtMoney(st.paidSum)}</b></span>
      </div>
      <div class="bars">${bars}</div>
      <div class="bar-x"><span>${fmtD(days[0])}</span><span>${fmtD(days[days.length-1])}</span></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:14px;font-weight:800">收款渠道构成</span>
        <span style="font-size:11.5px;color:var(--sub)">${ui.period==='M'?'本月':'近'+ui.period+'天'}</span>
      </div>
      <div style="margin-top:4px">${chRows}</div>
    </div>
    <div class="card rows" style="margin-top:14px">
      <div class="row"><div class="rmain"><div class="rname" style="font-size:14px">当前待收款</div><div class="rsub">含定金与尾款</div></div>
        <div class="rside"><div class="rprice" style="color:var(--red)">${fmtMoney(totOwed)}</div></div></div>
      <div class="row"><div class="rmain"><div class="rname" style="font-size:14px">待发片订单</div><div class="rsub">后期中 / 发片中</div></div>
        <div class="rside"><div class="rprice" style="color:var(--orange)">${sending} 单</div></div></div>
    </div>
    <div class="sec-title">我的账号 <span class="more" data-act="open-account">+ 添加 ›</span></div>
    <div class="card rows">${accountSectionHtml()}</div>
    <div class="sec-title">数据管理(本机 SQLite 存储)</div>
    <div class="card rows">
      <div class="menu-row" data-act="open-schema">
        <span class="menu-ic" style="background:var(--blue-soft);color:var(--blue)"><svg class="ic" viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/></svg></span>
        <div class="menu-t"><div class="menu-name">数据结构 · SQLite</div><div class="menu-sub">orders / payments / settings,真实 .db 存于本机,可导出迁移</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </div>
      <div class="menu-row">
        <span class="menu-ic" style="background:var(--orange-soft);color:#E8850A"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/></svg></span>
        <div class="menu-t"><div class="menu-name">尾款催收阈值</div><div class="menu-sub">超过该天数未收尾款即标记「已逾期」;提醒以打开 App 查看为准</div></div>
        <div class="stepper">
          <button data-act="th" data-v="-1">−</button><span>${db.threshold} 天</span><button data-act="th" data-v="1">+</button>
        </div>
      </div>
      <div class="menu-row" data-act="export-db">
        <span class="menu-ic" style="background:var(--blue-soft);color:var(--blue)"><svg class="ic" viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/></svg></span>
        <div class="menu-t"><div class="menu-name">导出 SQLite 数据库(.db)</div><div class="menu-sub">完整数据库文件,可用任意 SQLite 工具打开</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </div>
      <div class="menu-row" data-act="export-csv">
        <span class="menu-ic" style="background:var(--green-soft);color:#239648"><svg class="ic" viewBox="0 0 24 24"><path d="M12 4v11M7.5 11l4.5 4.5L16.5 11"/><path d="M4.5 19.5h15"/></svg></span>
        <div class="menu-t"><div class="menu-name">导出 CSV</div><div class="menu-sub">订单表 + 收款流水,Excel / Numbers 可直接打开</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </div>
      <div class="menu-row" data-act="export-json">
        <span class="menu-ic" style="background:var(--purple-soft);color:var(--purple)"><svg class="ic" viewBox="0 0 24 24"><path d="M8 4.5H6A2.5 2.5 0 0 0 3.5 7v3A2.5 2.5 0 0 1 1 12.5 2.5 2.5 0 0 1 3.5 15v3A2.5 2.5 0 0 0 6 20.5h2M16 4.5h2A2.5 2.5 0 0 1 20.5 7v3a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0-2.5 2.5v3a2.5 2.5 0 0 1-2.5 2.5h-2"/></svg></span>
        <div class="menu-t"><div class="menu-name">导出 JSON 备份</div><div class="menu-sub">含订单 + 收款流水 + 设置,可用于迁移</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </div>
      <div class="menu-row" data-act="import-json" role="button" tabindex="0">
        <div class="menu-t"><div class="menu-name">导入 JSON 备份</div><div class="menu-sub">预览后恢复订单、流水与设置；替换前自动备份</div></div>
      </div>
      <div class="menu-row" data-act="restore-backup" role="button" tabindex="0">
        <div class="menu-t"><div class="menu-name">恢复替换前的数据</div><div class="menu-sub">撤回最近一次导入或清空，仅保留最近一份</div></div>
      </div>
      ${isNative?`<div class="menu-row" data-act="notify-toggle" role="button" tabindex="0">
        <span class="menu-ic" style="background:var(--blue-soft);color:var(--blue)"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg></span>
        <div class="menu-t"><div class="menu-name">逾期催收每日提醒</div><div class="menu-sub">每天 09:00 本地通知 · 只报条数与最长天数,不含金额</div></div>
        <span class="tag-badge">${db.notifyEnabled===false?'已关闭':'已开启'}</span>
      </div>`:''}
      <div class="menu-row" data-act="switch-mode" role="button" tabindex="0">
        <div class="menu-t"><div class="menu-name">${Store.mode==='demo'?'进入工作数据':'切换到演示数据'}</div><div class="menu-sub">当前为${Store.mode==='demo'?'演示':'工作'}数据；两套数据独立保存，互不覆盖</div></div>
      </div>
      <div class="menu-row" data-act="clear-data" role="button" tabindex="0">
        <div class="menu-t"><div class="menu-name" style="color:var(--red)">清空当前${Store.mode==='demo'?'演示':'工作'}数据</div><div class="menu-sub">需确认；清空订单与流水，账号与设置保留；替换前自动备份，不影响另一套数据</div></div>
      </div>
      <div class="rsub" style="text-align:center;padding:10px 0 2px;color:#B9B9C0;white-space:normal">探记 TanJi v0.6 · 数据仅存本机，请定期导出备份</div>
    </div>
    <div class="sec-title">关于</div>
    <div class="card rows">
      <a class="menu-row" href="${LEGAL_BASE}privacy.html" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        <span class="menu-ic" style="background:var(--blue-soft);color:var(--blue)"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3l7.5 3v6c0 4.4-3.1 8.2-7.5 9.5C7.6 20.2 4.5 16.4 4.5 12V6L12 3z"/></svg></span>
        <div class="menu-t"><div class="menu-name">隐私政策</div><div class="menu-sub">纯本地运行 · 不收集、不上传任何数据</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </a>
      <a class="menu-row" href="${LEGAL_BASE}support.html" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        <span class="menu-ic" style="background:var(--green-soft);color:#239648"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg></span>
        <div class="menu-t"><div class="menu-name">支持与常见问题</div><div class="menu-sub">备份、迁移、通知与导出问题</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </a>
      ${APP_STORE_URL?`<a class="menu-row" href="${APP_STORE_URL}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        <span class="menu-ic" style="background:var(--brand-soft);color:var(--brand)"><svg class="ic" viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg></span>
        <div class="menu-t"><div class="menu-name">iOS 原生版 · 买断</div><div class="menu-sub">离线更稳 · 推送更新 · 本地通知提醒</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </a>`:`<div class="menu-row" data-act="app-store-soon">
        <span class="menu-ic" style="background:var(--brand-soft);color:var(--brand)"><svg class="ic" viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg></span>
        <div class="menu-t"><div class="menu-name">iOS 原生版 · 买断</div><div class="menu-sub">离线更稳 · 推送更新 · 本地通知提醒</div></div>
        <span class="tag-badge">即将上架</span>
      </div>`}
    </div>`;
}
