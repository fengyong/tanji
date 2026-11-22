/* ================= 渲染:订单(P0 §3) ================= */
import {$,esc,fmtD,fmtHM,fmtMoney} from '../util.js';
import {db} from '../storage.js';
import {ui} from '../ui.js';
import {workChip,payChip,isOver,overdueDays,snoozed,owedOf} from '../derived.js';
import {accMatch,accBar,accTint,accOrderTag,accChipbarHTML} from '../accounts.js';
import {priceCell,stepBtn} from '../detail.js';
import {headBtns} from '../stats.js';

/* ================= 渲染:订单 ================= */
function chipMatch(o){
  const w=workOf(o);
  switch(ui.chip){
    case 'wait':return w==='待拍摄';
    case 'doing':return w==='后期中'||w==='发片中';
    case 'unpaid':return owedOf(o)>0;
    case 'over':return isOver(o);
    case 'done':return w==='已交付';
    default:return true;
  }
}
export function renderOrders(){
  const q=ui.q.trim().toLowerCase();
  // 找回旧单的锚点通常是地点/联系人/服务商,只搜商家名等于白搜
  const hit=o=>q&&[o.store,o.location,o.contact,o.channel,o.partner,o.note,o.cat]
    .some(v=>String(v??'').toLowerCase().includes(q));
  const all=db.orders.filter(accMatch).filter(chipMatch).filter(o=>!q||hit(o))
    .sort((a,b)=>(b.shotAt||b.appt).localeCompare(a.shotAt||a.appt));
  const cnt=k=>db.orders.filter(accMatch).filter(o=>{const t=ui.chip;ui.chip=k;const r=chipMatch(o);ui.chip=t;return r}).length;
  const chips=[['all','全部'],['wait','待拍摄'],['doing','进行中'],['unpaid','待收款'],['over','逾期'],['done','已完结']]
    .map(([k,l])=>`<button class="fchip ${ui.chip===k?'on':''}" data-act="chip" data-chip="${k}">${l} <b>${cnt(k)}</b></button>`).join('');
  const rows=all.length?all.map(o=>`
    <div class="row${accBar(o)}" style="${accTint(o)}" data-act="open" data-oid="${o.id}">
      <div class="rmain">
        <div class="rname">${esc(o.store)}</div>
        <div class="rsub">${o.shotAt?`拍摄 ${fmtD(o.shotAt)}`:`预约 ${fmtD(o.appt)} ${fmtHM(o.appt)}`} · ${esc(o.cat)}${o.partner?' · 出镜 '+esc(o.partner):''}</div>
        <div class="chiprow">${accOrderTag(o)}${workChip(o)}${payChip(o)}${o.channel&&o.channel!=='直客'?`<span class="chip c-gray">${esc(o.channel)}</span>`:''}${isOver(o)?`<span class="chip c-red">欠 ${overdueDays(o)} 天</span>`:''}${snoozed(o)?'<span class="chip c-gray">已设提醒</span>':''}${stepBtn(o)}</div>
      </div>
      <div class="rside">${priceCell(o)}
        <div class="rsub" style="${owedOf(o)>0?'color:var(--red);font-weight:700':''}">${owedOf(o)>0?'待收 '+fmtMoney(owedOf(o)):'已结清'}</div>
      </div>
    </div>`).join('')
    : `<div class="empty"><div class="e-ic">🔍</div>没有符合条件的订单</div>`;
  $('#v-orders').innerHTML=`
    <div class="htop-row">
      <div><div class="eyebrow">工作 × 收款 双轨状态</div><h1 class="big">订单</h1></div>
      <div style="display:flex;gap:8px;align-items:center">${headBtns(false)}
        <button class="btn-pill" data-act="new-order"><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>预约</button></div>
    </div>
    ${accChipbarHTML()}
    <div class="search"><svg class="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
      <input id="q-input" placeholder="搜索商家 / 地点 / 联系人 / 备注" value="${esc(ui.q)}"></div>
    <div class="chips">${chips}</div>
    <div class="card rows">${rows}</div>`;
  const qi=$('#q-input');
  qi.addEventListener('input',e=>{ui.q=e.target.value;const pos=qi.selectionStart;renderOrders();const q2=$('#q-input');q2.focus();q2.setSelectionRange(pos,pos)});
}
