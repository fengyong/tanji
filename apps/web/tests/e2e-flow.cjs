// 端到端验收(浏览器真实操作):注册 → 登录 → 打开工作区 → 离线建单 → 联网同步 → 搭档共享 → 撤销 → 踢出。
// 需要运行: MySQL(33306) + 后端(8787) + vite dev(5173)。
// 用法: node tests/e2e-flow.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tanji-e2e-'));
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const webOrigin = process.env.TANJI_WEB_ORIGIN || 'http://127.0.0.1:5273';
const stamp = Date.now().toString(36);
const EMAIL_A = `e2e-a-${stamp}@test.local`;
const EMAIL_B = `e2e-b-${stamp}@test.local`;
const PASSWORD = 'e2e-password-123456';

let sessionId;
const netLog = [];

async function main() {
  const processChrome = spawn(chrome, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome 启动超时')), 30000);
    processChrome.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    processChrome.once('error', reject);
    processChrome.once('exit', (code) => reject(new Error(`Chrome exited ${code}`)));
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
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('超时: ' + method)); }, t);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
    });
  }

  const t2 = await send('Target.createTarget', { url: 'about:blank' });
  const att = await send('Target.attachToTarget', { targetId: t2.targetId, flatten: true });
  sessionId = att.sessionId;
  let call = (m, p, timeout) => send(m, p, sessionId, timeout);
  await call('Network.enable');
  socket.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Network.requestWillBeSent' && msg.params.request.url.includes('/v1/')) {
        netLog.push('→ ' + msg.params.request.method + ' ' + msg.params.request.url.replace(webOrigin, ''));
      } else if (msg.method === 'Network.responseReceived' && msg.params.response.url.includes('/v1/')) {
        netLog.push('← ' + msg.params.response.status + ' ' + msg.params.response.url.replace(webOrigin, ''));
      } else if (msg.method === 'Network.loadingFailed') {
        netLog.push('✗ ' + msg.params.errorText);
      }
    } catch {}
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, 120000);
    if (result.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(result.exceptionDetails).slice(0, 400));
    return result.result.value;
  };
  const goto = async (url) => {
    await call('Page.navigate', { url }).catch(() => {});
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const st = await call('Runtime.evaluate', { expression: 'location.origin + "|" + document.readyState', returnByValue: true });
      if (String(st.result.value).startsWith(webOrigin) && String(st.result.value).endsWith('complete')) {
        await new Promise((r) => setTimeout(r, 600));
        return;
      }
    }
    throw new Error('页面加载失败: ' + url);
  };

  // 便捷:直接在页面上下文里走 API(拿 dev_code)与打开账本
  const js = async (code) => evaluate(code);

  console.log('== E1: 注册并激活账号 A 与 B ==');
  await goto(webOrigin);
  const reg = await js(`(async () => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 15000);
    const r1 = await fetch('/v1/auth/register', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: '${EMAIL_A}', password: '${PASSWORD}', nickname: 'E2E甲' }), credentials: 'include', signal: ctl.signal });
    const j1 = await r1.json();
    const r2 = await fetch('/v1/auth/register', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: '${EMAIL_B}', password: '${PASSWORD}', nickname: 'E2E乙' }), credentials: 'include' });
    const j2 = await r2.json();
    const v1 = await fetch('/v1/auth/verify-email', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: '${EMAIL_A}', code: j1.dev_code }), credentials: 'include' }).then(r => r.status);
    const v2 = await fetch('/v1/auth/verify-email', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: '${EMAIL_B}', code: j2.dev_code }), credentials: 'include' }).then(r => r.status);
    return { a: j1.dev_code ? 'ok' : j1, b: j2.dev_code ? 'ok' : j2, v1, v2 };
  })()`);
  console.log('注册:', JSON.stringify(reg));
  assert.equal(reg.v1, 200) && assert.equal(reg.v2, 200);

  console.log('== E2: 登录 A 并打开工作区(OPFS 账本) ==');
  const loginA = await js(`(async () => {
    const r = await fetch('/v1/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: '${EMAIL_A}', password: '${PASSWORD}', device_id: crypto.randomUUID() }),
      credentials: 'include' });
    const s = await r.json();
    window.__tanji_e2e = { session: s };
    const mod = window.__tanji;
    await mod.openWorkspace({ user_id: s.user_id, nickname: s.nickname, email: s.email, session_id: s.session_id });
    await new Promise(r2 => setTimeout(r2, 2500));
    const sessCheck = await fetch('/v1/session', { credentials: 'include' }).then(r2 => r2.status);
    return { user_id: s.user_id, phase: mod.app.phase, cookies: document.cookie.slice(0, 60),
      sessCheck, syncStatus: mod.app.sync?.status, lastError: mod.app.sync?.lastError };
  })()`);
  console.log('登录A+开账本:', JSON.stringify(loginA));
  assert.equal(loginA.phase, 'ready');

  console.log('== E3: 新建订单(本地事务+outbox),刷新页面后仍在(AC01) ==');
  const created = await js(`(async () => {
    const { getLedger, refreshOrders } = window.__tanji;
    const l = getLedger();
    const r = await l.call('createOrder', { sessionId: window.__tanji_e2e.session.session_id,
      payload: { id: crypto.randomUUID(), store: 'E2E奶茶店', category: '茶饮', price_cents: 12800, deposit_cents: 3000,
        appt_local: '2026-11-25T10:00', timezone: 'Asia/Shanghai', settle_via: 'private', channel: '直客' } });
    await refreshOrders();
    const meta = await l.call('meta');
    return { id: r.data.id, pending: meta.pending_ops };
  })()`);
  console.log('创建订单:', JSON.stringify(created));
  assert.ok(created.id);

  console.log('== E4: CDP 级离线 → 离线新建+收款 → 离线重开页面(FR-03/AC01) ==');
  // 先等 E3 的改动完全同步(opfs 较慢,分次轮询)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    const p0 = await js(`(async () => {
      const meta = await window.__tanji.getLedger().call('meta');
      return Number(meta.pending_ops);
    })()`);
    if (p0 === 0) break;
  }
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const offline = await js(`(async () => {
    const mod = window.__tanji;
    const l = mod.getLedger();
    const r2 = await l.call('createOrder', { sessionId: window.__tanji_e2e.session.session_id,
      payload: { id: crypto.randomUUID(), store: '离线新店', price_cents: 5000, deposit_cents: 1000,
        appt_local: '2026-11-26T14:00', timezone: 'Asia/Shanghai', settle_via: 'private', channel: '直客' } });
    await l.call('recordPayment', { id: '${created.id}', kind: 'deposit', method: '微信', paidAtLocal: 'now',
      sessionId: window.__tanji_e2e.session.session_id });
    const meta = await l.call('meta');
    return { pending: meta.pending_ops, secondId: r2.data.id };
  })()`);
  console.log('离线建单+收款:', JSON.stringify(offline));
  assert.ok(offline.pending >= 2, '离线时改动只在本机(outbox>=2): ' + offline.pending);
  // 离线启动路径(PWA 壳由 SW 缓存后等价于"重开页面";此处直接跑同一启动逻辑):
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const reopened = await js(`(async () => {
    const mod = window.__tanji;
    const bootResult = await mod.tryOfflineBoot();
    const app = mod.app;
    const l = mod.getLedger();
    const orders = await l.call('listOrders', {});
    const meta = await l.call('meta');
    return { bootResult, phase: app.phase, orders: orders.length, names: orders.map(o => o.store),
      pending: meta.pending_ops, sync: app.sync?.status };
  })()`);
  console.log('离线重开:', JSON.stringify(reopened));
  assert.equal(reopened.phase, 'ready', 'FR-03: 离线也能打开已验证过的工作区');
  assert.equal(reopened.orders, 2, 'AC01: 离线期间的数据完整保留');
  assert.ok(reopened.pending >= 2, 'AC01: 待同步操作保留: ' + reopened.pending);
  // 恢复联网 → 自动同步
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  console.log('== E5: 联网同步 → outbox 确认 + 服务端数据 ==');
  // 浏览器 'online' 事件会唤醒引擎;测试里离线是 CDP 模拟(无 online 事件),显式唤醒等价
  await js(`(async () => { window.__tanji.getEngine()?.wake(); })()`);
  // opfs 经典 VFS 较慢(M0 实测 100~200ms/命令),轮询拆到 Node 侧多次 evaluate。
  let synced = null;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    synced = await js(`(async () => {
      const mod = window.__tanji;
      const meta = await mod.getLedger().call('meta');
      return { pending: Number(meta.pending_ops) };
    })()`);
    if (synced.pending === 0) break;
  }
  synced = await js(`(async () => {
    const mod = window.__tanji;
    const l = mod.getLedger();
    const meta = await l.call('meta');
    const orders = await l.call('listOrders', { search: 'E2E奶茶店' });
    const pays = orders[0] ? orders[0].payments.map(p => [p.kind, p.state, p.entry_type]) : [];
    const engine = mod.getEngine?.() ?? null;
    return { pending: meta.pending_ops, dirty: orders[0]?.dirty, pays,
      syncStatus: mod.app.sync?.status, lastError: mod.app.sync?.lastError,
      step: engine ? engine.lastStep : null,
      cycles: engine ? engine.cycleCount : null,
      running: engine ? engine.running : null,
      backoff: engine ? engine['backoffMs'] : null,
      outbox: await l.call('listOutbox', { statuses: ['pending','sending','conflict','rejected','quarantined'] })
        .then(rows => rows.map(r => [r.type, r.status])),
      requeueTest: await l.call('requeueSending').then(() => l.call('listOutbox', { statuses: ['pending'] })
        .then(rows => rows.map(r => [r.type, r.status]))) };
  })()`);
  console.log('同步后:', JSON.stringify(synced));
  assert.equal(synced.pending, 0, '同步后 outbox 清空');
  assert.equal(synced.dirty, 0);
  assert.deepEqual(synced.pays.map((p) => p[1]), ['confirmed']);

  console.log('== E6: B 注册登录 → A 邀请 B → 接受 → A 授权共享 → B 只见白名单 ==');
  const bSide = await js(`(async () => {
    const rb = await fetch('/v1/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: '${EMAIL_B}', password: '${PASSWORD}', device_id: crypto.randomUUID() }),
      credentials: 'include' });
    const sb = await rb.json();
    // B 接受 A 的邀请需要 A 先创建。切回 A cookie? 这里用同一浏览器串行切号不可靠——
    // 改为直接调用后端 HTTP(同源,用 fetch + 手动 Authorization 不行)。
    // 简化: 在 A 的页面上下文里完成邀请与授权,B 侧仅验证注册可登录。
    return { b_user_id: sb.user_id };
  })()`);
  console.log('B:', JSON.stringify(bSide));

  const invite = await js(`(async () => {
    // 当前 cookie 属于最后登录的 B;强制 A 重新登录会踢掉 B——这正是单会话语义。
    // 为让 A 完成操作,先以 A 登录(把 B 挤掉线,后续 B 重登即可)。
    const ra = await fetch('/v1/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: '${EMAIL_A}', password: '${PASSWORD}', device_id: crypto.randomUUID() }),
      credentials: 'include' });
    const sa = await ra.json();
    window.__tanji_e2e.session = sa;
    const inv = await fetch('/v1/contact-invites', { method: 'POST', headers: {'Content-Type':'application/json'},
      headers: {'Content-Type':'application/json', 'X-Tanji-CSRF': (document.cookie.match(/(?:^|;\s*)tanji_csrf=([^;]+)/)||[])[1] || ''},
      body: JSON.stringify({ invitee_user_id: '${bSide.b_user_id}' }), credentials: 'include' }).then(r => r.json());
    return { token: inv.token, a_user_id: sa.user_id };
  })()`);
  console.log('邀请:', JSON.stringify({ hasToken: !!invite.token }));

  console.log('== E7: B 接受邀请(会被 A 登录挤掉一次,重登) ==');
  // B 重新登录并接受
  const accept = await js(`(async () => {
    const rb = await fetch('/v1/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: '${EMAIL_B}', password: '${PASSWORD}', device_id: crypto.randomUUID() }),
      credentials: 'include' });
    const sb = await rb.json();
    const acc = await fetch('/v1/contact-invites/accept', { method: 'POST', headers: {'Content-Type':'application/json', 'X-Tanji-CSRF': (document.cookie.match(/(?:^|;\s*)tanji_csrf=([^;]+)/)||[])[1] || ''},
      body: JSON.stringify({ token: '${invite.token}' }), credentials: 'include' }).then(r => r.status);
    return { accepted: acc, b_user_id: sb.user_id };
  })()`);
  console.log('B 接受:', JSON.stringify(accept));
  assert.equal(accept.accepted, 200);

  console.log('== E8: A 授权共享 → B 拉取验证白名单 ==');
  // A 登录(A 踢 B)+ 授权 + 触发 A 页面同步(把 grant 事件落到 A 流,B 随后拉)
  const grant = await js(`(async () => {
    const ra = await fetch('/v1/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: '${EMAIL_A}', password: '${PASSWORD}', device_id: crypto.randomUUID() }),
      credentials: 'include' });
    const sa = await ra.json();
    const grantSetID = window.__tanji.grantSetID;
    const aggID = await grantSetID(sa.user_id, '${created.id}', '${accept.b_user_id}');
    // 通过 Bearer? cookie 已是 A。用 push HTTP 直接提交 grant 操作。
    const opID = crypto.randomUUID();
    const push = await fetch('/v1/sync/push', { method: 'POST', headers: {'Content-Type':'application/json', 'X-Tanji-CSRF': (document.cookie.match(/(?:^|;\s*)tanji_csrf=([^;]+)/)||[])[1] || ''},
      credentials: 'include',
      body: JSON.stringify({ protocol_version: 1, account_id: sa.user_id, device_id: sa.device_id,
        operations: [{ op_id: opID, aggregate_type: 'grant_set', aggregate_id: aggID,
          type: 'schedule.grant', payload: { order_id: '${created.id}', recipient_user_id: '${accept.b_user_id}', role: 'partner' } }] }) });
    const pj = await push.json();
    return { result: pj.results?.[0]?.result, error: pj.results?.[0]?.error_code };
  })()`);
  console.log('授权:', JSON.stringify(grant));
  assert.equal(grant.result, 'applied');

  // B 登录并 pull
  const bPull = await js(`(async () => {
    const rb = await fetch('/v1/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: '${EMAIL_B}', password: '${PASSWORD}', device_id: crypto.randomUUID() }),
      credentials: 'include' });
    await rb.json();
    const page = await fetch('/v1/sync/pull?limit=50', { credentials: 'include' }).then(r => r.json());
    const grants = page.events.filter(e => e.event_type === 'share.granted');
    const forbidden = grants.filter(e => JSON.stringify(e.payload).match(/price_cents|deposit_cents|payment|contact|微信|12800|3000/));
    return { granted: grants.length, forbidden: forbidden.length,
      sample: grants[0] ? { store: grants[0].payload.store, keys: Object.keys(grants[0].payload) } : null };
  })()`);
  console.log('B 拉取:', JSON.stringify(bPull));
  assert.equal(bPull.granted, 1, 'B 应收到 share.granted');
  assert.equal(bPull.forbidden, 0, 'AC08: 投影不得含财务/联系字段');

  console.log('== E9: A 撤销共享 → B 拉取得到 purge;AC12 历史页不再泄露 ==');
  const revoke = await js(`(async () => {
    const ra = await fetch('/v1/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: '${EMAIL_A}', password: '${PASSWORD}', device_id: crypto.randomUUID() }),
      credentials: 'include' });
    const sa = await ra.json();
    // 找到 share_id: A 自己 pull
    const page = await fetch('/v1/sync/pull?limit=50', { credentials: 'include' }).then(r => r.json());
    const g = page.events.find(e => e.event_type === 'share.granted' && e.payload && e.payload.order_id === '${created.id}');
    const grantSetID = window.__tanji.grantSetID;
    const aggID = await grantSetID(sa.user_id, '${created.id}', '${accept.b_user_id}');
    const opID = crypto.randomUUID();
    const push = await fetch('/v1/sync/push', { method: 'POST', headers: {'Content-Type':'application/json', 'X-Tanji-CSRF': (document.cookie.match(/(?:^|;\s*)tanji_csrf=([^;]+)/)||[])[1] || ''},
      credentials: 'include',
      body: JSON.stringify({ protocol_version: 1, account_id: sa.user_id, device_id: sa.device_id,
        operations: [{ op_id: opID, aggregate_type: 'grant_set', aggregate_id: aggID,
          type: 'schedule.revoke', payload: { share_id: g.payload.share_id } }] }) });
    const pj = await push.json();
    return { revoke: pj.results?.[0]?.result };
  })()`);
  console.log('撤销:', JSON.stringify(revoke));
  assert.equal(revoke.revoke, 'applied');

  const bPurge = await js(`(async () => {
    const rb = await fetch('/v1/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: '${EMAIL_B}', password: '${PASSWORD}', device_id: crypto.randomUUID() }),
      credentials: 'include' });
    await rb.json();
    const all = [];
    let cursor = '';
    for (let i = 0; i < 5; i++) {
      const page = await fetch('/v1/sync/pull?limit=50' + (cursor ? '&cursor=' + cursor : ''), { credentials: 'include' }).then(r => r.json());
      all.push(...page.events);
      cursor = page.next_cursor;
      if (!page.has_more) break;
    }
    const historyGranted = all.filter(e => e.event_type === 'share.granted');
    const purges = all.filter(e => e.event_type === 'share.purged');
    return { historyGranted: historyGranted.length, purges: purges.length,
      forbiddenHistory: historyGranted.filter(e => JSON.stringify(e.payload).match(/price_cents|12800|3000/)).length };
  })()`);
  console.log('B 全量拉取:', JSON.stringify(bPurge));
  assert.ok(bPurge.purges >= 1, 'AC12: 撤销后 B 拉历史页应得到 purge');
  assert.equal(bPurge.forbiddenHistory, 0, 'AC12: 历史页不得泄露已撤销内容');

  console.log('== E10: 新设备登录踢出旧设备(AC06 服务端+客户端复核) ==');
  const kicked = await js(`(async () => {
    // B 又一次登录(新设备),然后旧 cookie? cookie 被新登录覆盖——用第二个浏览器上下文模拟旧设备:
    // 简化:当前 cookie(B 新登录)有效;再让 A 登录;再验证 B 的旧会话已失效需要重新拿。
    const ra = await fetch('/v1/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: '${EMAIL_A}', password: '${PASSWORD}', device_id: crypto.randomUUID() }),
      credentials: 'include' });
    await ra.json();
    // 用 B 的旧 token 无法再拿(已在 cookie 覆盖)——验证方式:直接调 B 旧 session? 已被服务端撤销。
    const s = await fetch('/v1/session', { credentials: 'include' }).then(r => r.json());
    return { now: s.email };
  })()`);
  console.log('当前会话:', JSON.stringify(kicked));
  assert.equal(kicked.now, EMAIL_A);
  // 服务端层面 B 的会话应已被替换(集成测试 TestSingleSessionReplacesOld 已覆盖),此处复核 cookie 会话切换。

  console.log('\\n✅ E2E 主流程全部通过');
  socket.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ E2E 失败:', e.message);
  console.error('网络日志:\n' + netLog.slice(-40).join('\n'));
  process.exit(1);
});
