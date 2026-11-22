/* 平台差异唯一入口(P0 规格 §3):CAP / isNative / APP_STORE_URL / LEGAL_BASE。
   其余模块一律从这里 import;全仓只有本文件与 src/cap-plugins.js 允许出现 TanjiCap。 */
export const CAP=(typeof window!=='undefined'&&window.TanjiCap)||null;
export const isNative=!!(CAP&&CAP.Capacitor&&CAP.Capacitor.isNativePlatform&&CAP.Capacitor.isNativePlatform());

/* iOS 原生版(买断付费,App Store)的落地页地址。
   空字符串 = 还没上架,「关于」里显示为「即将上架」而不是死链;
   上架拿到 App ID 后,把 https://apps.apple.com/app/id<数字> 填进来即可自动变成可点入口。
   这一行就是「免费 PWA 体验 → 付费 iOS App」的转化入口。 */
export const APP_STORE_URL='';

/* 隐私政策 / 支持页的线上地址。
   原生端 WebView 用的是 capacitor:// 协议，相对链接无法交给系统浏览器打开，
   而应用内跳转会把用户带离主界面且没有返回键 —— 故原生端统一走线上绝对地址，
   由 Capacitor 的 createWebViewWith 转交系统浏览器(target=_blank)。
   Web 端走同源相对路径，可被 Service Worker 离线缓存。 */
export const LEGAL_BASE='https://tanji-app-guvc.zai.site/';
