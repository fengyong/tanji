// 构建产物静态服务(带 COOP/COEP 与 /v1 代理)——生产形状的本地验收环境。
// 用法: node scripts/serve-dist.mjs [port] [apiTarget]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] || 5273);
const apiTarget = process.argv[3] || 'http://127.0.0.1:8080';
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  // 代理后端 API:用 node:http 原生转发(undici fetch 会丢弃 host/转发头,Set-Cookie 也会合并)
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/health')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const target = new URL(apiTarget);
    const fwdHeaders = { ...req.headers };
    fwdHeaders.host = target.host; // 上游 Host
    fwdHeaders['x-forwarded-host'] = req.headers['x-forwarded-host'] ?? req.headers.host ?? '';
    fwdHeaders['x-forwarded-proto'] = req.headers['x-forwarded-proto'] ?? 'http';
    delete fwdHeaders.connection;
    delete fwdHeaders['content-length'];
    if (!['GET', 'HEAD'].includes(req.method)) fwdHeaders['content-length'] = String(body.length);
    const upReq = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: url.pathname + url.search,
      headers: fwdHeaders,
    }, (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    });
    upReq.on('error', () => { res.writeHead(502); res.end('upstream unavailable'); });
    if (!['GET', 'HEAD'].includes(req.method)) upReq.write(body);
    upReq.end();
    return;
  }
  // 静态文件
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (file.endsWith('/') || !path.extname(file)) file = path.join(dist, 'index.html');
  if (!file.startsWith(dist)) { res.writeHead(403); res.end(); return; }
  try {
    const data = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': file.endsWith('sw.js') || file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(port, '127.0.0.1', () => console.log(`dist 服务: http://127.0.0.1:${port} (API → ${apiTarget})`));
