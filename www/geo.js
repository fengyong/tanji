/* =====================================================================
 * 探记 TanJi · 到店定位与地图跳转
 * ---------------------------------------------------------------------
 * 为什么单独成文件:
 *   1) 到店拍摄时"当时的 GPS 位置"是独立能力,与图片处理(imaging.js)无关;
 *      原生走 @capacitor/geolocation,Web 走浏览器 geo,两条路径收敛在这里。
 *   2) 地图跳转要区分「手填地点文本」与「GPS 坐标」两种入参 —— 手填的
 *      中文地址最准(达人自己知道是哪家店),坐标只在没填地点时兜底。
 *
 * 约定:
 *   - 存储格式一律 `lat,lng`(6 位小数,英文逗号),一列 gps_place 装得下;
 *   - 定位失败静默返回 null / 抛错,绝不阻塞拍照与保存主流程;
 *   - 不引用 db / ui / document,浏览器与 Capacitor 均可直接用。
 * 命名空间:window.TanJiGeo
 * ===================================================================== */
(function(root){
  'use strict';

  const TIMEOUT=8000;      // 定位超时(毫秒):超过就当没定位到,不影响拍摄记录
  const MAX_AGE=60000;     // 允许复用 60 秒内的定位结果,避免每次拍照都干等

  /* 浏览器里 globalThis===window;测试沙箱里两者可能分离,两种取法都兼容 */
  function capBundle(){
    return root.TanjiCap||(root.window&&root.window.TanjiCap)||null;
  }
  function nativePlugin(){
    const cap=capBundle();
    if(!cap||!cap.Geolocation||!cap.Capacitor)return null;
    try{return cap.Capacitor.isNativePlatform()?cap.Geolocation:null}catch(e){return null}
  }

  /** 坐标 → 存储串;非法坐标抛错,避免把 NaN 写进库里 */
  function format(position){
    const c=position&&position.coords;
    if(!c||!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude))throw new Error('没有取到有效坐标');
    return `${c.latitude.toFixed(6)},${c.longitude.toFixed(6)}`;
  }

  /** 存储串 → {lat,lng};格式不对返回 null(校验与渲染都走这里) */
  function parse(place){
    if(typeof place!=='string'||place.length>40)return null;
    const parts=place.split(',');
    if(parts.length!==2)return null;
    // 必须两段都是数字字面量:Number('') 会得到 0,只靠 Number.isFinite 会把 "22.5," 放进来
    const NUM=/^-?\d{1,3}(?:\.\d{1,6})?$/;
    if(!NUM.test(parts[0])||!NUM.test(parts[1]))return null;
    const lat=Number(parts[0]),lng=Number(parts[1]);
    if(Math.abs(lat)>90||Math.abs(lng)>180)return null;
    return {lat,lng};
  }
  function isValid(place){return parse(place)!==null}

  /** 展示用:`22.543096, 114.057865`(读起来比裸串顺眼,复制也还能用) */
  function label(place){
    const p=parse(place);
    return p?`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`:'';
  }

  /**
   * 取当前定位,返回 `lat,lng`;失败抛错(调用方决定是否提示)。
   * 原生优先 @capacitor/geolocation(WKWebView 的 navigator.geolocation 在 iOS 上不可靠)
   */
  async function locate(){
    const options={enableHighAccuracy:true,timeout:TIMEOUT,maximumAge:MAX_AGE};
    const plugin=nativePlugin();
    if(plugin)return format(await plugin.getCurrentPosition(options));
    const geo=root.navigator&&root.navigator.geolocation;
    if(!geo)throw new Error('本机不支持定位');
    const position=await new Promise((resolve,reject)=>geo.getCurrentPosition(resolve,reject,options));
    return format(position);
  }

  /**
   * 地图链接:优先手填地点(文本查询最准),没有地点才用 GPS 坐标兜底。
   * 用 https://maps.apple.com 而不是 maps:// —— 未安装/被拦截时会自然退回网页,
   * 不会出现"点了没反应"。
   */
  function mapUrl({place,query,name}={}){
    const text=(query||'').trim();
    if(text)return `https://maps.apple.com/?q=${encodeURIComponent(text)}`;
    const p=parse(place);
    if(p)return `https://maps.apple.com/?ll=${p.lat},${p.lng}&q=${encodeURIComponent(name||'到店位置')}`;
    return null;
  }

  /** 外部打开:原生走系统(会交棒给地图 App),Web 开新标签 */
  function open(url){
    if(!url)return false;
    const cap=capBundle();
    try{
      if(cap&&cap.Capacitor&&cap.Capacitor.isNativePlatform()){root.open(url,'_system');return true}
    }catch(e){/* 落到下面兜底 */}
    try{root.open(url,'_blank','noopener');return true}
    catch(e){return false}
  }

  root.TanJiGeo={locate,parse,isValid,label,mapUrl,open,TIMEOUT};
})(typeof globalThis!=='undefined'?globalThis:this);
