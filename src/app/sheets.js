/* ================= 弹层 / Toast(P0 §3) ================= */
import {$,esc} from './util.js';
import {ui} from './ui.js';
import {Store} from './storage.js';

/* ================= 弹层 / Toast ================= */
export function showSheet(id){
  $('#mask').classList.add('show');
  document.querySelectorAll('.sheet').forEach(s=>s.classList.remove('show'));
  $('#'+id).classList.add('show');
}
export function closeSheets(){
  $('#mask').classList.remove('show');
  // 下拉手势会给 sheet 写行内 transform,关闭时一并清掉,否则下次打开位置是错的
  document.querySelectorAll('.sheet').forEach(s=>{
    s.classList.remove('show');
    s.style.transition='';s.style.transform='';
  });
  ui.detail=null;ui.payCtx=null;ui.editId=null;ui.remindOid=null;ui.expectOid=null;Store.pending=null;
}
/**
 * 弹层下拉关闭。
 * iOS 上底部弹层的退出方式就是「往下拖」,点上方空白是备选而不是唯一入口。
 * 只在「手指从头部/把手起手」或「列表已经滚到顶」时接管,往下拖才跟随,
 * 往上拖一律还给列表滚动,横向手势直接放弃 —— 避免和滚动、切换抢手势。
 */
export function initSheetGestures(){
  // 表单类弹层只在头部/把手起手才允许下拉关闭:正打字时误拖一下就把输入丢掉,代价太大
  const FORM_SHEETS='#sheet-new,#sheet-edit,#sheet-account,#sheet-import,#sheet-remind,#sheet-expect';
  document.querySelectorAll('.sheet').forEach(sheet=>{
    const body=sheet.querySelector('.sheet-body');
    const bodyDragAllowed=!sheet.matches(FORM_SHEETS);
    let startY=0,startX=0,dy=0,armed=false,pulling=false;
    sheet.addEventListener('touchstart',event=>{
      if(event.touches.length!==1)return;
      const t=event.touches[0];
      startY=t.clientY;startX=t.clientX;dy=0;pulling=false;
      if(event.target.closest('input,textarea,select')){armed=false;return}
      armed=!body||!body.contains(event.target)||(bodyDragAllowed&&body.scrollTop<=0);
    },{passive:true});
    sheet.addEventListener('touchmove',event=>{
      if(!armed)return;
      const t=event.touches[0];
      const down=t.clientY-startY,across=t.clientX-startX;
      if(!pulling){
        if(Math.abs(across)>Math.abs(down)+4){armed=false;return}   // 横向手势不抢
        if(down<=0){armed=false;return}                            // 往上:交给列表滚动
        if(body&&body.scrollTop>0){armed=false;return}             // 列表不在顶部:先滚动
        pulling=true;
      }
      event.preventDefault();
      dy=down;
      sheet.style.transition='none';
      sheet.style.transform=`translateY(${Math.max(dy,0)}px)`;
    },{passive:false});
    const finish=()=>{
      if(!pulling){armed=false;return}
      const moved=dy;pulling=false;armed=false;
      sheet.style.transition='';sheet.style.transform='';
      if(moved>110)closeSheets();          // 拖足够远就关掉,否则弹回原位
      dy=0;
    };
    sheet.addEventListener('touchend',finish,{passive:true});
    sheet.addEventListener('touchcancel',finish,{passive:true});
  });
}
/* Toast:默认 1.9 秒自动消失;带 action 时(如「撤销」)延到 5 秒并露出按钮。
 * 「钱必须可逆」不能只写在原则里:点错一下就要能原地撤回,而不是再进编辑弹层绕一圈。 */
export let toastTimer,toastAction=null;
export function toast(m,action){
  const el=$('#toast');if(!el)return;
  clearTimeout(toastTimer);
  toastAction=action||null;
  if(action)el.innerHTML=`<span>${esc(m)}</span><button class="toast-act" data-act="toast-undo">${esc(action.label||'撤销')}</button>`;
  else el.textContent=m;
  el.classList.add('show');
  el.classList.toggle('act',!!action);
  // 隐藏后不立刻清掉 toastAction:按钮已经不可见了,留着它能避免"手慢一点就点不动"
  // (下一次 toast 会覆盖它,所以不会出现错乱的撤销)
  toastTimer=setTimeout(()=>el.classList.remove('show','act'),action?5000:1900);
}

/* P0 偏差(DEVIATIONS):'toast-undo' 原来在事件委托段直接改写本模块的
   toastAction/toastTimer;ESM 的 import 绑定只读,改由本模块暴露
   dismissToast,逐行等价于原 case 体的前四行。 */
export function dismissToast(){
  const action=toastAction;toastAction=null;
  $('#toast').classList.remove('show','act');
  clearTimeout(toastTimer);
  return action;
}
