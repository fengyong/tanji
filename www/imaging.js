/* =====================================================================
 * 探记 TanJi · 图像处理模块
 * ---------------------------------------------------------------------
 * 所有「把一张大图变成能存进数据库的小图」的事情都走这里,调用方只管拿
 * dataURL,不用重复写 canvas 裁剪/压缩/淡化逻辑。
 *
 * 设计约束(踩过的坑):
 *   1. WKWebView 里 OffscreenCanvas 要 iOS 16.4+,所以统一用普通 canvas;
 *   2. 必须先铺白底再画图,否则带透明通道的 PNG 边缘会变黑;
 *   3. 淡化(叠白)要「烘焙进图里」,存进 DB 的就是成品,渲染端不再叠 opacity,
 *      否则两层淡化叠加会发灰发脏;
 *   4. 产物体积在这里就卡死上限,超了直接抛错,不让脏数据进库。
 *
 * 预设:
 *   door   256×128  金额格/列表底图 —— 2:1 居中裁切 + 降饱和/降对比/微模糊 + 叠白 53%
 *   avatar 128×128  账号头像     —— 方形居中裁切
 * ===================================================================== */
(function(root){
  'use strict';

  const PRESETS={
    door:{
      width:256,height:128,fit:'cover',
      filter:'saturate(0.72) contrast(0.9) blur(0.6px)', // 简化:只留色块与轮廓,去掉菜单字/人影
      white:0.53,                                        // 淡化:若隐若现
      quality:0.65,
    },
    avatar:{
      width:128,height:128,fit:'cover',
      filter:'none',white:0,quality:0.82,
    },
  };

  /* dataURL 字符数上限(base64 比原字节大约 33%,这里留够余量) */
  const LIMIT={door:12*1024,avatar:200*1024};

  const isDataURL=value=>typeof value==='string'&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);

  /** File / Blob / dataURL → 已解码的 Image */
  function load(source){
    return new Promise((resolve,reject)=>{
      const img=new Image();
      let objectURL=null;
      const cleanup=()=>{if(objectURL)URL.revokeObjectURL(objectURL)};
      img.onload=()=>{cleanup();resolve(img)};
      img.onerror=()=>{cleanup();reject(new Error('图片读取失败'))};
      if(typeof source==='string'){
        if(!isDataURL(source)&&!/^blob:|^https?:|^capacitor:|^file:/.test(source))return reject(new Error('不支持的图片地址'));
        img.src=source;
      }else{
        objectURL=URL.createObjectURL(source);
        img.src=objectURL;
      }
    });
  }

  /** 画一张成品图:铺白底 → 居中裁切缩放 → 滤镜简化 → 叠白淡化 → JPEG */
  function render(img,opt){
    const {width,height,fit='cover',filter='none',white=0,quality=0.8}=opt;
    if(!(width>0&&height>0))throw new Error('目标尺寸非法');

    const cv=document.createElement('canvas');
    cv.width=width;cv.height=height;
    const ctx=cv.getContext('2d');
    if(!ctx)throw new Error('当前环境不支持 canvas');

    ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);   // 1. 白底

    let sx=0,sy=0,sw=img.width,sh=img.height;
    if(fit==='cover'){                                      // 2. 居中裁切成目标比例
      const scale=Math.max(width/img.width,height/img.height);
      sw=width/scale;sh=height/scale;
      sx=(img.width-sw)/2;sy=(img.height-sh)/2;
    }
    if(filter!=='none')ctx.filter=filter;                    // 3. 简化细节
    ctx.drawImage(img,sx,sy,sw,sh,0,0,width,height);
    if(filter!=='none')ctx.filter='none';

    if(white>0){                                             // 4. 烘焙淡化
      ctx.globalAlpha=white;ctx.fillStyle='#fff';
      ctx.fillRect(0,0,width,height);ctx.globalAlpha=1;
    }
    return cv.toDataURL('image/jpeg',quality);               // 5. JPEG 出图
  }

  /**
   * 把任意来源的图片处理成可直接入库的 dataURL
   * @param {File|Blob|string} source 拍照/相册拿到的文件,或已有 dataURL
   * @param {'door'|'avatar'|object} preset 预设名或自定义参数
   */
  async function make(source,preset){
    const name=typeof preset==='string'?preset:null;
    const opt=name?PRESETS[name]:preset;
    if(!opt)throw new Error('未知的图片预设');

    const img=await load(source);
    const url=render(img,opt);
    const limit=LIMIT[name]||Infinity;
    if(url.length>limit)throw new Error('图片处理后仍然偏大');
    return url;
  }

  const doorThumb=source=>make(source,'door');
  const avatar=source=>make(source,'avatar');

  /* DB 侧校验用:与 validateState 保持同一套判定,上限按预设区分 */
  const isValidStored=(value,max=LIMIT.avatar)=>isDataURL(value)&&value.length<=max;

  root.TanJiImage={make,doorThumb,avatar,PRESETS,LIMIT,isDataURL,isValidStored};
})(typeof globalThis!=='undefined'?globalThis:this);
