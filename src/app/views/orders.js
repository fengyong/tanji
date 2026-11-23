/* ================= 渲染:订单(P0 §3) ================= */
import {$,esc,fmtD,fmtHM,fmtMoney as fmtMoneyBase} from '../util.js';
import {db} from '../storage.js';
import {ui} from '../ui.js';
import {workChip,payChip,isOver,overdueDays,snoozed,owedOf,accMatch} from '../derived.js';
import {accBar,accTint,accOrderTag,accChipbarHTML} from '../accounts.js';
import {priceCell,stepBtn} from '../detail.js';
import {headBtns} from '../stats.js';
import {workOf} from '../derived.js';
/* 隐私模式:本文件全部金额渲染经此包装(P0 修复:双参化后调用点必须带 ui.privacy) */
const fmtMoney=n=>fmtMoneyBase(n,ui.privacy);

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
    <div class="order-swipe" data-oid="${esc(o.id)}">
      <div class="order-swipe-actions"><button type="button" tabindex="-1" data-act="copy-order" data-oid="${esc(o.id)}" aria-label="复制 ${esc(o.store)}"><svg class="ic" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="12" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>复制</span></button></div>
      <div class="row order-swipe-track${accBar(o)}" style="${accTint(o)}" data-act="open" data-oid="${o.id}">
        <div class="rmain">
          <div class="rname">${esc(o.store)}</div>
          <div class="rsub">${o.shotAt?`拍摄 ${fmtD(o.shotAt)}`:`预约 ${fmtD(o.appt)} ${fmtHM(o.appt)}`} · ${esc(o.cat)}${o.partner?' · 出镜 '+esc(o.partner):''}</div>
          <div class="chiprow">${accOrderTag(o)}${workChip(o)}${payChip(o)}${o.channel&&o.channel!=='直客'?`<span class="chip c-gray">${esc(o.channel)}</span>`:''}${isOver(o)?`<span class="chip c-red">欠 ${overdueDays(o)} 天</span>`:''}${snoozed(o)?'<span class="chip c-gray">已设提醒</span>':''}${stepBtn(o)}</div>
        </div>
        <div class="rside">${priceCell(o)}
          <div class="rsub" style="${owedOf(o)>0?'color:var(--red);font-weight:700':''}">${owedOf(o)>0?'待收 '+fmtMoney(owedOf(o)):'已结清'}</div>
        </div>
        <button class="icon-btn" style="width:40px;height:40px;background:var(--brand-soft);color:var(--brand);box-shadow:none" data-act="edit-order" data-oid="${esc(o.id)}" aria-label="编辑 ${esc(o.store)}" title="编辑订单"><svg class="ic" viewBox="0 0 24 24"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/></svg></button>
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
  initOrderSwipeActions();
  const qi=$('#q-input');
  // 输入法合成期间(拼音还没上屏)不能重建输入框:节点一换,合成被强制结束,
  // 拼音被逐段提交成字面量、候选词也没了(Chromium 实测:输入 wang 得到 wwawang)。
  // 合成期间只记下输入值,等 compositionend 再按最终文本重绘。
  let composing=false;
  const search=value=>{ui.q=value;const pos=qi.selectionStart;renderOrders();const q2=$('#q-input');q2.focus();q2.setSelectionRange(pos,pos)};
  qi.addEventListener('compositionstart',()=>{composing=true});
  qi.addEventListener('compositionend',()=>{composing=false;search(qi.value)});
  qi.addEventListener('input',e=>{if(e.isComposing||composing)return;search(e.target.value)});
}

function initOrderSwipeActions(){
  document.querySelectorAll('#v-orders .order-swipe').forEach(item=>{
    const track=item.querySelector('.order-swipe-track');let start=null;
    track.addEventListener('touchstart',event=>{
      if(event.touches.length!==1||event.target.closest?.('button,input,textarea,select')){start=null;return}
      document.querySelectorAll('#v-orders .order-swipe.open').forEach(other=>{if(other!==item)other.classList.remove('open')});
      const touch=event.touches[0];
      start={id:touch.identifier,x:touch.clientX,y:touch.clientY,base:item.classList.contains('open')?-78:0,swiped:false};
    },{passive:true});
    track.addEventListener('touchmove',event=>{
      if(!start||event.touches.length!==1){start=null;return}
      const touch=Array.from(event.touches).find(item=>item.identifier===start.id);if(!touch)return;
      const dx=touch.clientX-start.x,dy=touch.clientY-start.y;
      if(!start.swiped&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.2)start.swiped=true;
      if(!start.swiped)return;
      event.preventDefault();
      const offset=Math.max(-78,Math.min(0,start.base+dx));
      track.style.transition='none';track.style.transform=`translateX(${offset}px)`;
    },{passive:false});
    track.addEventListener('touchend',event=>{
      if(!start)return;
      const touch=Array.from(event.changedTouches).find(item=>item.identifier===start.id);
      if(!touch){start=null;return}
      const dx=touch.clientX-start.x,swiped=start.swiped;start=null;
      track.style.transition='';track.style.transform='';
      if(!swiped)return;
      event.preventDefault();
      if(dx<-32)item.classList.add('open');else if(dx>24)item.classList.remove('open');
    },{passive:false});
    track.addEventListener('touchcancel',()=>{start=null;track.style.transition='';track.style.transform=''},{passive:true});
  });
}
