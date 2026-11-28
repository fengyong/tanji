#!/usr/bin/env node
/**
 * 探记 · 纯原生 iOS 版 —— App Store Connect API 客户端
 *
 * 用法：
 *   node scripts/asc-api.mjs <METHOD> <PATH> [JSON_BODY]
 *
 * 示例：
 *   node scripts/asc-api.mjs GET /betaGroups
 *   node scripts/asc-api.mjs POST /betaTesters '{"data":{...}}'
 *
 * 认证：读 ~/.config/tanji/asc.env 里的 ASC_API_KEY / ASC_API_ISSUER / ASC_PRIVATE_KEY_PATH，
 *      用内置 crypto 做 ES256 JWT（ES256 在 Node 里必须是 ieee-p1363 签名格式，
 *      DER 格式会被 Apple 拒）。
 *
 * 该脚本只读凭据文件，不打印密钥内容。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'https://api.appstoreconnect.apple.com/v1';
const ENV_FILE = path.join(os.homedir(), '.config/tanji', 'asc.env');

function loadEnv() {
  const env = {};
  if (!fs.existsSync(ENV_FILE)) {
    throw new Error(`找不到凭据文件：${ENV_FILE}`);
  }
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

function buildToken(env) {
  const { ASC_API_KEY: kid, ASC_API_ISSUER: iss, ASC_PRIVATE_KEY_PATH: keyPath } = env;
  if (!kid || !iss || !keyPath) {
    throw new Error('asc.env 需要同时提供 ASC_API_KEY、ASC_API_ISSUER、ASC_PRIVATE_KEY_PATH');
  }
  const resolved = path.resolve(os.homedir(), expandVars(keyPath));
  if (!fs.existsSync(resolved)) {
    throw new Error(`找不到私钥：${resolved}`);
  }
  const key = crypto.createPrivateKey({ key: fs.readFileSync(resolved, 'utf8'), format: 'pem' });
  const b64u = (obj) => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64u({ alg: 'ES256', kid, typ: 'JWT' })}.${b64u({
    iss,
    iat: now,
    exp: now + 900,
    aud: 'appstoreconnect-v1',
  })}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${signature.toString('base64url')}`;
}

async function main() {
  const [method, endpoint, body] = process.argv.slice(2);
  if (!method || !endpoint) {
    console.error('用法：node scripts/asc-api.mjs <METHOD> <PATH> [JSON_BODY]');
    process.exit(2);
  }
  // BASE 已含 /v1，所以传入路径要能容忍调用方带 /v1 前缀（否则会拼成 /v1/v1/... 而 404）。
  const url = endpoint.startsWith('http') ? endpoint : BASE + endpoint.replace(/^\/v1(?=\/|$)/, '');
  const init = { method: method.toUpperCase(), headers: { Authorization: `Bearer ${buildToken(loadEnv())}` } };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = body;
  }
  const res = await fetch(url, init);
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  if (!text) return;
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
