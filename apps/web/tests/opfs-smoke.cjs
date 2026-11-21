// M0 可行性验收:真实 Chrome(CDP)验证 OPFS SQLite 持久化(AC01 存储部分)与失败保全。
// 用法: node tests/opfs-smoke.cjs   (需先启动 vite dev 与后端)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tanji-opfs-'));
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const webOrigin = process.env.TANJI_WEB_ORIGIN || 'http://127.0.0.1:5173';

let sessionId;

async function main() {
  const processChrome = spawn(chrome, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome 启动超时(30s): ' + output.slice(0, 200))), 30000);
    processChrome.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    processChrome.once('error', reject);
    processChrome.once('exit', (code) => reject(new Error('Chrome exited ' + code)));
  });

  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let counter = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
      }
    }
    if (message.method === 'Page.javascriptDialogOpening') {
      send('Page.handleJavaScriptDialog', { accept: true }, message.sessionId).catch(() => {});
    }
  });
  function send(method, params, sid, timeoutMs) {
    const t = timeoutMs || 30000;
    return new Promise((resolve, reject) => {
      const id = ++counter;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('超时: ' + method));
      }, t);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
    });
  }

  const t1 = await send('Target.createTarget', { url: 'about:blank' });
  const att1 = await send('Target.attachToTarget', { targetId: t1.targetId, flatten: true });
  sessionId = att1.sessionId;
  const call = (method, params, timeout) => send(method, params, sessionId, timeout);
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, 90000);
    if (result.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(result.exceptionDetails).slice(0, 300));
    return result.result.value;
  };
  const goto = (url) => {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { socket.removeEventListener('message', handler); resolve(); }, 8000);
      const handler = (event) => {
        const message = JSON.parse(event.data);
        if (message.method === 'Page.loadEventFired') {
          clearTimeout(timer);
          socket.removeEventListener('message', handler);
          resolve();
        }
      };
      socket.addEventListener('message', handler);
      call('Page.navigate', { url }).catch(() => resolve());
    });
  };

  await goto(webOrigin);

  console.log('== A1: Dedicated Worker 内 opfs 写入并读回 ==');
  const probe = await evaluate(`(async () => {
    const worker = new Worker('/vendor/opfs-probe.worker.js', { type: 'module' });
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker 超时')), 30000);
      worker.onmessage = (ev) => { clearTimeout(timer); resolve(ev.data); };
      worker.onerror = (e) => { clearTimeout(timer); reject(new Error('worker 错误: ' + e.message)); };
      worker.postMessage({ name: 'tanji-smoke-flat.db', mode: 'write' });
    });
    worker.terminate();
    return { ...reply, hasOPFS: typeof navigator.storage?.getDirectory === 'function', isolated: self.crossOriginIsolated === true };
  })()`);
  console.log('探针:', JSON.stringify(probe));
  assert.equal(probe.isolated, true, '需要 COOP/COEP 跨源隔离');
  assert.ok(probe.hasOPFS, '浏览器支持 OPFS');
  assert.ok(probe.value && probe.value.startsWith('hello-'), 'Worker 内 opfs 写入并读回成功');

  console.log('== A2: 关闭页面再重开(新 target),验证 OPFS 持久化 ==');
  const persisted = probe.value;
  await send('Target.closeTarget', { targetId: t1.targetId });
  const t2 = await send('Target.createTarget', { url: 'about:blank' });
  const att2 = await send('Target.attachToTarget', { targetId: t2.targetId, flatten: true });
  sessionId = att2.sessionId;
  await goto(webOrigin);
  const probe2 = await evaluate(`(async () => {
    const worker = new Worker('/vendor/opfs-probe.worker.js', { type: 'module' });
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker 超时')), 30000);
      worker.onmessage = (ev) => { clearTimeout(timer); resolve(ev.data); };
      worker.onerror = (e) => { clearTimeout(timer); reject(new Error('worker 错误: ' + e.message)); };
      worker.postMessage({ name: 'tanji-smoke-flat.db', mode: 'read' });
    });
    worker.terminate();
    return reply;
  })()`);
  console.log('重开读取:', JSON.stringify(probe2));
  assert.equal(probe2.value, persisted, '页面被杀后 OPFS 数据保留(AC01 存储层)');

  console.log('== A3: 失败保全(坏 VFS 必须明确抛错) ==');
  const probe3 = await evaluate(`(async () => {
    const worker = new Worker('/vendor/opfs-probe.worker.js', { type: 'module' });
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker 超时')), 30000);
      worker.onmessage = (ev) => { clearTimeout(timer); resolve(ev.data); };
      worker.onerror = (e) => { clearTimeout(timer); reject(new Error('worker 错误: ' + e.message)); };
      worker.postMessage({ mode: 'failcheck' });
    });
    worker.terminate();
    return reply;
  })()`);
  console.log('失败保全:', JSON.stringify(probe3));
  assert.equal(probe3.failOpen, true, '坏 VFS 必须明确失败(不静默退化)');

  console.log('\n✅ M0 OPFS 可行性验证全部通过');
  socket.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ 失败:', e.message);
  process.exit(1);
});
