/* ================= 工具(P0 §3:零依赖,copyText 特许 import env) ================= */
import {CAP,isNative} from './env.js';

/* ================= 工具 ================= */
export const $=s=>document.querySelector(s);
export const pad=n=>String(n).padStart(2,'0');
export let now=new Date();
export let TODAY=toISO(now);
/* 特许调整 B(§4):时钟拆分 —— now/TODAY 的整体前拨只发生在 tickClock;
   ui.js 的 refreshClock 负责 ui.selDay/vMon 同步,逻辑与原实现逐行等价。 */
export function tickClock(){
  const previous=TODAY;now=new Date();TODAY=toISO(now);
  return {changed:previous!==TODAY,previous};
}
export function dOff(days,hm='10:00'){const t=new Date();t.setDate(t.getDate()+days);return `${toISO(t)}T${hm}`}
export function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
export function validDateTime(value){return TanJiLogic.validDateTime(value)}
export function nowStr(){const n=new Date();return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}T${pad(n.getHours())}:${pad(n.getMinutes())}`}
export function toISO(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
export function fmtD(s){if(!s)return '—';const d=new Date(s);return `${d.getMonth()+1}-${pad(d.getDate())}`}
export function fmtHM(s){return s?s.slice(11,16):'—'}
export function fmtDT(s){return s?`${fmtD(s)} ${fmtHM(s)}`:'—'}
/* 特许调整 A(§4):ui.privacy 由调用点传入,本模块不再依赖 ui。 */
export function fmtMoney(n,masked){return masked?'¥✱✱✱':'¥'+n.toLocaleString('zh-CN',{maximumFractionDigits:2})}
export const DOW='一二三四五六日',dowOf=s=>DOW[(new Date(s.length===10?s+'T00:00':s).getDay()+6)%7];
export function daysBetween(fromStr){return TanJiLogic.daysBetween(fromStr,new Date())}
export function greeting(){const h=new Date().getHours();return h<11?'早上好':h<14?'中午好':h<18?'下午好':'晚上好'}

/* 多账号段(§3):clipboard 助手,特许 import env.js 读 CAP。 */
export async function copyText(text){
  try{
    if(isNative&&CAP&&CAP.Clipboard){await CAP.Clipboard.write({string:text});return true}
    if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(text);return true}
    const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
    document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();return ok;
  }catch(e){return false}
}
