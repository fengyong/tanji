/* ================= 头像裁剪:选图后拖动/缩放取景,账号里只存裁剪结果 ================= */
import {$} from './util.js';
import {ui} from './ui.js';
import {renderAvatarPreview} from './accounts.js';
import {toast} from './sheets.js';

/* ---------- 取景数学(纯函数,不碰 DOM;坐标一律是画布的 CSS 像素) ----------
 * view = {scale,x,y}:原图左上角画在 (x,y),宽高各乘 scale。
 * crop = {x,y,size}:固定的正方形取景框。
 * 不变量:任何操作之后图片都盖住取景框(不露底),缩放落在 [刚好铺满, 铺满×MAX_ZOOM]。 */
export const MAX_ZOOM=4;
/* 刚好铺满取景框所需的缩放(最小缩放) */
export function coverScale(img,crop){return Math.max(crop.size/img.naturalWidth,crop.size/img.naturalHeight)}
export function clampView(view,img,crop){
  const min=coverScale(img,crop);
  const scale=Math.min(Math.max(view.scale,min),min*MAX_ZOOM);
  const w=img.naturalWidth*scale,h=img.naturalHeight*scale;
  return {scale,
    x:Math.min(Math.max(view.x,crop.x+crop.size-w),crop.x),
    y:Math.min(Math.max(view.y,crop.y+crop.size-h),crop.y)};
}
/* 刚好铺满、居中:不调整直接「使用」= 以前的居中正方形裁切 */
export function initialView(img,crop){
  const scale=coverScale(img,crop);
  return clampView({scale,x:crop.x+(crop.size-img.naturalWidth*scale)/2,y:crop.y+(crop.size-img.naturalHeight*scale)/2},img,crop);
}
/* 以画布上的 (px,py) 为锚点缩放 factor 倍:锚点底下的图像内容原地不动 */
export function zoomAt(view,img,crop,factor,px,py){
  const scale=view.scale*factor;
  return clampView({scale,x:px-(px-view.x)*(scale/view.scale),y:py-(py-view.y)*(scale/view.scale)},img,crop);
}
/* 取景框对应原图的哪一块(原图像素坐标),交给 TanJiImage.crop 出图 */
export function sourceRect(view,crop){
  const sw=crop.size/view.scale;
  return {sx:(crop.x-view.x)/view.scale,sy:(crop.y-view.y)/view.scale,sw,sh:sw};
}

/* ---------- 裁剪层(全屏,盖在账号弹层之上:账号弹层保持打开,表单输入不丢) ---------- */
let session=null;   // 打开中的裁剪:{img,view,crop,box,dpr,preview,pointers,pan,pinch,tap,raf}
const nextFrame=typeof requestAnimationFrame==='function'?requestAnimationFrame:fn=>setTimeout(fn,16);
const isCover=s=>Math.abs(s.view.scale-coverScale(s.img,s.crop))<1e-6;

/* 屏幕预览用一张长边 ≤2048 的缩小图:相册原图动辄上千万像素,逐帧重绘会卡。
   最终出图始终从原图裁(见 useCrop),这里的缩小不影响成品画质。 */
function previewBitmap(img){
  const k=Math.min(1,2048/Math.max(img.naturalWidth,img.naturalHeight));
  if(k===1)return null;
  const cv=document.createElement('canvas');
  cv.width=Math.max(1,Math.round(img.naturalWidth*k));cv.height=Math.max(1,Math.round(img.naturalHeight*k));
  const ctx=cv.getContext('2d');
  if(!ctx)return null;
  ctx.drawImage(img,0,0,cv.width,cv.height);
  return cv;
}
function draw(){
  const s=session;if(!s)return;
  s.raf=0;
  const g=$('#crop-canvas').getContext('2d');
  if(!g)return;
  const {box,dpr,crop:c,view:v}=s,src=s.preview||s.img,k=s.preview?s.preview.width/s.img.naturalWidth:1;
  g.setTransform(dpr,0,0,dpr,0,0);
  g.fillStyle='#0E0E12';g.fillRect(0,0,box.width,box.height);
  g.drawImage(src,v.x,v.y,s.img.naturalWidth*v.scale*k,s.img.naturalHeight*v.scale*k);
  g.fillStyle='rgba(14,14,18,.62)';                                 // 取景框外压暗
  g.beginPath();g.rect(0,0,box.width,box.height);g.rect(c.x,c.y,c.size,c.size);g.fill('evenodd');
  g.strokeStyle='rgba(255,255,255,.9)';g.lineWidth=1.5;
  g.strokeRect(c.x+.75,c.y+.75,c.size-1.5,c.size-1.5);
  g.strokeStyle='rgba(255,255,255,.55)';g.lineWidth=1;             // 圆形参考线:头像在列表/标签里多数按圆形显示
  g.beginPath();g.arc(c.x+c.size/2,c.y+c.size/2,c.size/2,0,Math.PI*2);g.stroke();
}
function scheduleDraw(){if(session&&!session.raf)session.raf=nextFrame(draw)}

function openCrop(img){
  if(!img||!(img.naturalWidth>0&&img.naturalHeight>0))throw new Error('图片读取失败');
  closeCrop();                                                      // 上一张还没关就又选了一张:先收尾
  const canvas=$('#crop-canvas');
  $('#avatar-crop').hidden=false;
  const box=canvas.getBoundingClientRect();
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.max(1,Math.round(box.width*dpr));canvas.height=Math.max(1,Math.round(box.height*dpr));
  const size=Math.max(1,Math.floor(Math.min(box.width-32,box.height-32)));
  const crop={x:(box.width-size)/2,y:(box.height-size)/2,size};
  session={img,crop,box,dpr,preview:previewBitmap(img),pointers:new Map(),pan:null,pinch:null,tap:null,raf:0};
  session.view=initialView(img,crop);
  draw();
}
export function closeCrop(){
  if(!session)return;
  session=null;$('#avatar-crop').hidden=true;
}
export async function useCrop(){
  const s=session;if(!s)return;
  const rect=sourceRect(s.view,s.crop);
  closeCrop();                                                      // 出图期间不该还能继续拖
  try{
    // 账号里只存裁剪结果(128×128 JPEG);这次调用之后原图就没有任何引用了
    ui.draftAvatar=await TanJiImage.crop(s.img,rect,'avatar');
    renderAvatarPreview();toast('头像已就绪,保存后生效');
  }catch(e){toast('这张图处理不了,换一张试试')}
}

/* 手势:单指拖动平移;双指以中点为锚缩放;双击在「刚好铺满 / 2.5×」间切换;滚轮缩放(桌面)。
   画布上 touch-action:none(见 index.html),手势不会变成滚动或页面缩放。 */
function bindGestures(){
  const canvas=$('#crop-canvas');
  const pos=e=>{const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top}};
  const points=s=>[...s.pointers.values()];
  canvas.addEventListener('pointerdown',e=>{
    const s=session;if(!s)return;
    e.preventDefault();
    try{canvas.setPointerCapture(e.pointerId)}catch(err){/* 抓不到指针(合成事件)也不影响 */}
    const p=pos(e);s.pointers.set(e.pointerId,p);
    if(s.pointers.size===1){
      s.pinch=null;s.pan={x:s.view.x,y:s.view.y,p};
      const now=Date.now();
      if(s.tap&&now-s.tap.t<300&&Math.hypot(p.x-s.tap.x,p.y-s.tap.y)<28){   // 双击
        const factor=isCover(s)?2.5:coverScale(s.img,s.crop)/s.view.scale;
        s.view=zoomAt(s.view,s.img,s.crop,factor,s.crop.x+s.crop.size/2,s.crop.y+s.crop.size/2);
        s.pan={x:s.view.x,y:s.view.y,p};s.tap=null;scheduleDraw();
      }else s.tap={x:p.x,y:p.y,t:now};
    }else if(s.pointers.size===2){
      const [a,b]=points(s);
      s.pan=null;s.tap=null;
      s.pinch={scale:s.view.scale,x:s.view.x,y:s.view.y,dist:Math.hypot(a.x-b.x,a.y-b.y)||1,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2};
    }
  });
  canvas.addEventListener('pointermove',e=>{
    const s=session;if(!s||!s.pointers.has(e.pointerId))return;
    const p=pos(e);s.pointers.set(e.pointerId,p);
    if(s.pointers.size===1&&s.pan)s.view=clampView({...s.view,x:s.pan.x+p.x-s.pan.p.x,y:s.pan.y+p.y-s.pan.p.y},s.img,s.crop);
    else if(s.pointers.size===2&&s.pinch){
      const [a,b]=points(s),scale=s.pinch.scale*(Math.hypot(a.x-b.x,a.y-b.y)/s.pinch.dist);
      // 两指中点底下的图像内容跟着中点走
      s.view=clampView({scale,x:(a.x+b.x)/2-(s.pinch.cx-s.pinch.x)*(scale/s.pinch.scale),y:(a.y+b.y)/2-(s.pinch.cy-s.pinch.y)*(scale/s.pinch.scale)},s.img,s.crop);
    }else return;
    scheduleDraw();
  });
  const end=e=>{
    const s=session;if(!s)return;
    s.pointers.delete(e.pointerId);
    if(s.pointers.size===1){const [p]=points(s);s.pinch=null;s.pan={x:s.view.x,y:s.view.y,p}}   // 双指抬起一指:以剩下那指重新起手,避免跳变
    else if(!s.pointers.size){s.pan=null;s.pinch=null}
  };
  canvas.addEventListener('pointerup',end);
  canvas.addEventListener('pointercancel',end);
  canvas.addEventListener('wheel',e=>{
    const s=session;if(!s)return;
    e.preventDefault();
    s.view=zoomAt(s.view,s.img,s.crop,Math.exp(-e.deltaY*0.0015),s.crop.x+s.crop.size/2,s.crop.y+s.crop.size/2);
    scheduleDraw();
  },{passive:false});
}

/* 相册选图入口(自 accounts.js 搬入:裁剪器要回调账号模块,放在比它高的层依赖方向才合规) */
export function initAvatarInput(){
  const input=$('#avatar-file');
  bindGestures();
  input.addEventListener('change',async()=>{
    const file=input.files&&input.files[0];input.value='';
    if(!file)return;
    try{openCrop(await TanJiImage.load(file))}
    catch(e){closeCrop();toast('这张图处理不了,换一张试试')}
  });
}
