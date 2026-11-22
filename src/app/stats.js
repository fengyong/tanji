/* ================= 统计 + 顶部右侧按钮(P0 §3) ================= */
import {now} from './util.js';
import {db,Store} from './storage.js';
import {refreshClock,ui} from './ui.js';

/* ================= 统计 ================= */
export function statsFor(period,list){
  refreshClock();                       // 窗口终点依赖"现在",时钟刷新留在 UI 层
  return TanJiLogic.statsFor({orders:db.orders,payments:db.payments,period,list,now});
}

/* ================= 顶部右侧按钮(分享 / 隐私) ================= */
export function headBtns(share){
  return `<div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
    <span style="font-size:10px;color:var(--sub)">${Store.mode==='demo'?'演示':'工作'}</span>
    ${share?`<button class="icon-btn" data-act="share" aria-label="分享行程"><svg class="ic" viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/></svg></button>`:''}
    <button class="icon-btn ${ui.privacy?'on':''}" data-act="privacy" aria-label="${ui.privacy?'显示金额':'隐藏金额'}"><svg class="ic" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>${ui.privacy?'<path d="M4.5 4.5l15 15"/>':''}</svg></button>
  </div>`;
}
