/* ================= 今日行程分享图(canvas,默认不含金额) ================= */
import {$,fmtHM,dowOf,TODAY} from './util.js';
import {db} from './storage.js';
import {ui,refreshClock} from './ui.js';
import {workOf} from './derived.js';
import {showSheet,toast} from './sheets.js';

/* ================= 今日行程分享图(canvas,默认不含金额) ================= */
function rr(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath()}
export function buildTodayImage(day=TODAY){
  const date=new Date(day+'T00:00');
  const list=db.orders.filter(o=>o.appt.slice(0,10)===day).sort((a,b)=>a.appt.localeCompare(b.appt));
  const S=2,W=1080,rowH=112,headH=240,footH=110,gap=18,pad=56;
  const rows=Math.max(list.length,1);
  const H=headH+rows*(rowH+gap)+footH;
  const c=document.createElement('canvas');c.width=W*S;c.height=H*S;
  const g=c.getContext('2d');g.scale(S,S);
  g.fillStyle='#F2F2F7';g.fillRect(0,0,W,H);
  const gr=g.createLinearGradient(0,0,W,headH);gr.addColorStop(0,'#FF8A3D');gr.addColorStop(1,'#E8352A');
  g.fillStyle=gr;g.fillRect(0,0,W,headH-28);
  g.fillStyle='rgba(255,255,255,.9)';g.font='600 26px -apple-system,PingFang SC,sans-serif';
  g.fillText('探记 TanJi · 拍摄行程',pad,62);
  g.fillStyle='#fff';g.font='800 58px -apple-system,PingFang SC,sans-serif';
  g.fillText(`${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日 周${dowOf(day)}`,pad,136);
  g.font='600 26px -apple-system,PingFang SC,sans-serif';g.fillStyle='rgba(255,255,255,.88)';
  g.fillText(list.length?`${list.length} 个拍摄安排`:'当天暂无拍摄安排',pad,186);
  let y=headH;
  const WT={'待拍摄':['#007AFF'],'后期中':['#AF52DE'],'发片中':['#FF9500'],'已交付':['#239648']};
  if(!list.length){g.fillStyle='#8E8E93';g.font='500 30px -apple-system,PingFang SC';g.fillText('🌙 休息,明天再战',pad,y+66);y+=rowH+gap}
  for(const o of list){
    g.fillStyle='#fff';rr(g,pad,y,W-pad*2,rowH,20);g.fill();
    g.fillStyle='#FF6A2B';g.font='800 40px -apple-system,PingFang SC';g.fillText(fmtHM(o.appt),pad+30,y+56);
    g.fillStyle='#1C1C1E';g.font='700 34px -apple-system,PingFang SC';
    g.fillText(o.store,pad+156,y+46,W-pad*2-320);
    const st=WT[workOf(o)][0];
    g.fillStyle=st;g.font='700 24px -apple-system,PingFang SC';g.fillText('● '+workOf(o),pad+158,y+88);
    g.fillStyle='#8E8E93';g.font='500 24px -apple-system,PingFang SC';g.fillText(o.cat,pad+300,y+88);
    y+=rowH+gap;
  }
  g.fillStyle='#B9B9C0';g.font='500 24px -apple-system,PingFang SC';
  g.fillText('由「探记」生成 · 不含金额信息',pad,y+34);
  return new Promise(res=>c.toBlob(b=>res(b),'image/png'));
}
export async function shareToday(){
  refreshClock();
  const day=ui.tab==='trip'?ui.selDay:TODAY;
  toast('正在生成行程图片…');
  const blob=await buildTodayImage(day);
  if(!blob){toast('图片生成失败，请重试');return}
  ui.shareDay=day;ui.shareBlob=blob;
  $('#sheet-share .sheet-title').textContent=`${day} · 行程分享`;
  if(ui.shareUrl)URL.revokeObjectURL(ui.shareUrl);
  ui.shareUrl=URL.createObjectURL(blob);
  $('#share-body').innerHTML=`<img src="${ui.shareUrl}" style="width:100%;border-radius:16px;border:.5px solid var(--line)">
    <div style="padding-top:14px"><button class="btn primary" data-act="share-confirm">分享 / 保存图片</button></div>`;
  showSheet('sheet-share');
}
