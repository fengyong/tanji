#!/usr/bin/env node
/**
 * 探记 · 纯原生 iOS 版 —— 把一个人加进 TestFlight 内部测试组
 *
 * 用法：
 *   node scripts/add-internal-tester.mjs <邮箱> [名] [姓] [--invite-team]
 *
 * 内部测试员必须是 App Store Connect 团队成员（Apple 官方：
 * 「如果所选的测试员不是 App Store Connect 用户，则无法添加到内部群组」）。
 * 因此本脚本按下面顺序工作：
 *
 *   1. 查 /v1/users：对方是否已是团队成员
 *      - 已是 → 直接走第 3 步
 *      - 不是 → 若有待处理邀请则提示等待；否则提示需要先发团队邀请
 *        （加 --invite-team 可自动发出，角色 DEVELOPER）
 *   2. 建 betaTester（必须带 betaGroups 关系，否则 409）
 *   3. 加入内部测试组 POST /v1/betaGroups/{groupId}/relationships/betaTesters
 *   4. 分配构建 POST /v1/builds/{buildId}/relationships/individualTesters
 *   5. 发 TestFlight 邀请 POST /v1/betaTesterInvitations
 *   6. 打印状态（INVITED / ACCEPTED / INSTALLED）
 *
 * 组与构建的 id 从 testflight/app-store-connect.json 读取。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://api.appstoreconnect.apple.com/v1';
const ENV_FILE = path.join(os.homedir(), '.config/tanji', 'asc.env');
const CONFIG = path.join(ROOT, 'testflight', 'app-store-connect.json');

function loadEnv() {
  const env = {};
  if (!fs.existsSync(ENV_FILE)) throw new Error(`找不到凭据文件：${ENV_FILE}`);
  for (const raw of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    let k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (k.startsWith('export ')) k = k.slice(7).trim();
    env[k] = v;
  }
  return env;
}

/** 展开 $HOME / $VAR 形式的路径（Node 没有 path.expandvars） */
function expandVars(p) {
  return p.replace(/\$(\w+)|\$\{([^}]+)\}/g, (_, a, b) => process.env[a || b] ?? '');
}

function buildToken(env) {  const { ASC_API_KEY: kid, ASC_API_ISSUER: iss, ASC_PRIVATE_KEY_PATH: keyPath } = env;
  if (!kid || !iss || !keyPath) throw new Error('asc.env 缺少 ASC_API_KEY / ASC_API_ISSUER / ASC_PRIVATE_KEY_PATH');
  const resolved = path.resolve(os.homedir(), expandVars(keyPath));
  if (!fs.existsSync(resolved)) throw new Error(`找不到私钥：${resolved}`);
  const key = crypto.createPrivateKey({ key: fs.readFileSync(resolved, 'utf8'), format: 'pem' });
  const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const si = `${b64u({ alg: 'ES256', kid, typ: 'JWT' })}.${b64u({ iss, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
  const sig = crypto.sign('sha256', Buffer.from(si), { key, dsaEncoding: 'ieee-p1363' });
  return `${si}.${sig.toString('base64url')}`;
}

const token = buildToken(loadEnv());

async function api(method, endpoint, body) {
  // BASE 已含 /v1，传进来的路径要能容忍带 /v1 前缀，否则会拼成 /v1/v1/...。
  const url = endpoint.startsWith('http') ? endpoint : BASE + endpoint.replace(/^\/v1(?=\/|$)/, '');
  const init = { method: method.toUpperCase(), headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 原样返回 */ }
  return { status: res.status, body: json, raw: text };
}

function fail(what, res) {
  const detail = res.body?.errors?.map((e) => `${e.status} ${e.code}: ${e.detail}`).join(' | ') || res.raw || '(空响应)';
  throw new Error(`${what} 失败：${res.status} ${detail}`);
}

const args = process.argv.slice(2);
const email = args.find((a) => a.includes('@'));
if (!email) {
  console.error('用法：node scripts/add-internal-tester.mjs <邮箱> [名] [姓] [--invite-team]');
  process.exit(2);
}
const firstName = args.find((a) => a !== email && !a.startsWith('--') && !a.includes('@')) || 'Tester';
const lastName = args.filter((a) => !a.startsWith('--') && a !== email && !a.includes('@'))[1] || 'Test';
const inviteTeam = args.includes('--invite-team');

const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const groupId = cfg.testFlight.groupId;
const appId = cfg.testFlight.appResourceId;
const buildNumber = cfg.uploadHistory[0]?.build;

// ---- 1. 团队成员判定 ----
const users = await api('GET', '/users?limit=200');
if (users.status !== 200) fail('查询团队成员', users);
const member = users.body.data.find((u) => u.attributes.username.toLowerCase() === email.toLowerCase());

if (!member) {
  const invites = await api('GET', '/userInvitations?limit=200');
  const pending = invites.body?.data?.find((i) => i.attributes.email.toLowerCase() === email.toLowerCase());
  if (pending) {
    console.log(`✗ ${email} 还不是 ASC 团队成员，但已有待接受的团队邀请：`);
    console.log(`  邀请 id=${pending.id}  角色=${pending.attributes.roles.join(',')}  到期=${pending.attributes.expirationDate}`);
    console.log('  等对方在邮箱点激活链接接受（需关联自己的 Apple 账户）。接受后邀请记录会自动消失。');
    process.exit(3);
  }
  if (!inviteTeam) {
    console.log(`✗ ${email} 还不是 ASC 团队成员。内部组不接受团队外的人，必须先邀请进团队。`);
    console.log('  加上 --invite-team 可自动发出团队邀请（角色 DEVELOPER，3 天有效）：');
    console.log(`    node scripts/add-internal-tester.mjs ${email} "${firstName}" "${lastName}" --invite-team`);
    process.exit(3);
  }
  const invite = await api('POST', '/userInvitations', {
    data: {
      type: 'userInvitations',
      attributes: {
        email,
        firstName,
        lastName,
        roles: ['DEVELOPER'],
        allAppsVisible: true,
        provisioningAllowed: false,
      },
    },
  });
  if (invite.status !== 201) fail('发送团队邀请', invite);
  console.log(`✓ 已发 ASC 团队邀请：${email}（id=${invite.body.data.id}，到期 ${invite.body.data.attributes.expirationDate}）`);
  console.log('  等对方接受后重新执行本命令，即可完成加入内部组 + 分配构建 + 发 TestFlight 邀请。');
  process.exit(0);
}

console.log(`✓ 已是 ASC 团队成员：${email}（user id=${member.id}）`);

// ---- 2. 找或建 betaTester ----
const existing = await api('GET', `/betaTesters?filter[email]=${encodeURIComponent(email)}`);
if (existing.status !== 200) fail('查询 betaTester', existing);
let betaTester = existing.body.data[0] || null;

if (!betaTester) {
  const created = await api('POST', '/betaTesters', {
    data: {
      type: 'betaTesters',
      attributes: { email, firstName, lastName },
      relationships: { betaGroups: { data: [{ type: 'betaGroups', id: groupId }] } },
    },
  });
  if (created.status !== 201) fail('创建 betaTester', created);
  betaTester = created.body.data;
  console.log(`✓ 已建 betaTester：${betaTester.id}`);
}

// ---- 3. 加入内部组 ----
const join = await api('POST', `/betaGroups/${groupId}/relationships/betaTesters`, {
  data: [{ type: 'betaTesters', id: betaTester.id }],
});
if (join.status !== 204 && join.status !== 200) fail('加入内部测试组', join);
console.log(`✓ 已加入内部测试组：${groupId}`);

// ---- 4. 分配构建 ----
const builds = await api('GET', `/builds?filter[app]=${appId}`);
if (builds.status !== 200) fail('查询构建', builds);
const build = builds.body.data.find((b) => b.attributes.version === buildNumber) || builds.body.data[0];
if (build) {
  const assign = await api('POST', `/builds/${build.id}/relationships/individualTesters`, {
    data: [{ type: 'betaTesters', id: betaTester.id }],
  });
  if (assign.status !== 204 && assign.status !== 200) fail('分配构建给测试员', assign);
  console.log(`✓ 已分配构建：${build.attributes.version}`);
}

// ---- 5. 发 TestFlight 邀请 ----
const invite = await api('POST', '/betaTesterInvitations', {
  data: {
    type: 'betaTesterInvitations',
    relationships: {
      app: { data: { type: 'apps', id: appId } },
      betaTester: { data: { type: 'betaTesters', id: betaTester.id } },
    },
  },
});
if (invite.status !== 201) fail('发送 TestFlight 邀请', invite);
console.log(`✓ 已发 TestFlight 邀请（invitation id=${invite.body.data.id}）`);

// ---- 6. 状态 ----
const group = await api('GET', `/betaGroups/${groupId}/betaTesters`);
const self = group.body?.data?.find((t) => t.id === betaTester.id);
console.log(`\n当前状态：${self?.attributes?.state ?? '未知'}`);
console.log('  INVITED=邀请已发待接受  ACCEPTED=已接受  INSTALLED=已装 TestFlight');
