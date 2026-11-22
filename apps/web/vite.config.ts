import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    headers: {
      // OPFS 的 SQLite(opfs VFS)需要跨源隔离
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/v1': { target: 'http://127.0.0.1:8080', xfwd: true },
      '/health': { target: 'http://127.0.0.1:8080', xfwd: true },
    },
  },
  worker: {
    // Worker 也需要同源隔离下的模块加载
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
});
