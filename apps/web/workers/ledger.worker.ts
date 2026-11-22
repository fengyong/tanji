// Worker 入口:浏览器端通过 Vite 处理(ledger.worker.ts?worker)。
// 这里直接复用 packages/local-db 的 buildHandlers + OPFS 打开器。
import { buildHandlers, dbNameFor } from '@tanji/local-db/handlers';
import type { WorkerRequest, WorkerResponse } from '@tanji/local-db/protocol';

type SqliteConn = { exec(opts: Record<string, unknown>): void; close(): void };
let currentOpenArgs: { sqliteUrl?: string } | null = null;

const env = {
  async initEngine() { /* 引擎在 openDB 中动态加载 */ },
  async openDB(name: string) {
    // Vite 会对 worker 内的动态 import 注入 ?import(导致 public 目录回退 html)。
    // 用 Function 构造器执行 import,完全脱离 Vite 转换;URL 由调用方传入。
    const dynamicImport = (u: string): Promise<unknown> =>
      (new Function('return import(' + JSON.stringify(u) + ')'))() as Promise<unknown>;
    const sqliteUrl = currentOpenArgs?.sqliteUrl ?? '/vendor/sqlite3.mjs';
    const mod = (await dynamicImport(sqliteUrl)) as {
      default: (cfg?: unknown) => Promise<{
        oo1: { DB: new (name: string, flags?: string) => SqliteConn };
        capi: { sqlite3_vfs_find(name: string): unknown };
      }>;
    };
    const sqlite3 = await mod.default({ print: () => {}, printErr: (m: string) => console.warn('[sqlite]', m) });
    // opfs VFS 在 initializersAsync 中异步安装(依赖代理 worker);等它就绪,最多 10 秒。
    for (let i = 0; i < 100; i++) {
      if (sqlite3.capi.sqlite3_vfs_find('opfs')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    let conn: SqliteConn;
    // SQLITE_BUSY(旧页面崩溃后锁释放延迟)按固定间隔重试;重试耗尽才拒绝(不静默退化)。
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        // opfs VFS 需 Dedicated Worker + 对象参数形式;目录不存在时会自动创建
        conn = new sqlite3.oo1.DB({ filename: name, vfs: 'opfs', flags: 'c' });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        const msg = String(e instanceof Error ? e.message : e);
        if (!/BUSY|locked/i.test(msg)) {
          throw new Error(
            `无法打开 OPFS 数据库(${name}):${msg}。` +
            '已阻止工作账本写入以保护数据;请确认浏览器支持 OPFS 且站点带 COOP/COEP 头。',
          );
        }
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    if (!conn || lastErr) {
      throw new Error(
        `无法打开 OPFS 数据库(${name}):${lastErr instanceof Error ? lastErr.message : String(lastErr)}。` +
        '数据被其他实例占用(或系统未释放崩溃前的锁);已阻止写入以保护数据。',
      );
    }
    const api = {
      run(sql: string, params: unknown[] = []) { conn.exec({ sql, bind: params }); },
      all(sql: string, params: unknown[] = []) {
        const rows: unknown[] = [];
        conn.exec({ sql, bind: params, rowMode: 'object', callback: (row: unknown) => rows.push(row) });
        return rows;
      },
      get(sql: string, params: unknown[] = []) { return api.all(sql, params)[0]; },
      transaction<T>(fn: (tx: never) => T): T {
        conn.exec('BEGIN IMMEDIATE');
        try {
          const out = fn(api as never);
          conn.exec('COMMIT');
          return out;
        } catch (e) {
          try { conn.exec('ROLLBACK'); } catch { /* 已回滚 */ }
          throw e;
        }
      },
    };
    return { api: api as never, close: () => conn.close() };
  },
};

const built = buildHandlers(env as never);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  let resp: WorkerResponse;
  try {
    if (req.cmd === 'open') currentOpenArgs = (req.args as { sqliteUrl?: string }) ?? null;
    if (built.isQuarantined() && !built.QUARANTINE_ALLOW.includes(req.cmd)) {
      throw new Error('会话已失效:本地工作区已锁定(未同步数据保留在队列中,登录后可恢复)');
    }
    const handler = built.handlers[req.cmd as keyof typeof built.handlers];
    if (!handler) throw new Error(`未知命令 ${req.cmd}`);
    const result = await handler(req.args as never, built.db() as never);
    resp = { id: req.id, ok: true, result };
  } catch (e) {
    resp = { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (built.WRITE_CMDS.has(req.cmd)) resp.event = 'changed';
  (self as unknown as Worker).postMessage(resp);
};

void dbNameFor;
export {};
