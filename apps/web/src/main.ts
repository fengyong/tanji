import { createApp } from 'vue';
import App from './App.vue';
import { app, getLedger, getApi, getEngine, openWorkspace, switchAccount, tryOfflineBoot, refreshOrders } from './lib/session';
import { grantSetID } from '@tanji/domain';
import './styles.css';

createApp(App).mount('#app');

// E2E/调试句柄(只暴露无副作用的访问器与既有流程函数;不含令牌)
window.__tanji = { app, getLedger, getApi, getEngine, openWorkspace, switchAccount, tryOfflineBoot, refreshOrders, grantSetID };

// PWA:生产构建后注册 SW(白名单预缓存;认证/同步接口绝不缓存)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW 注册失败', e));
  });
}
