// SQLite Worker 入口(浏览器):官方 SQLite WASM,opfs VFS,持久化到 Origin Private File System。
// 持久化失败必须明确报错并保护数据;绝不静默退化为内存库/localStorage(AC16)。
/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from './protocol';
import { buildHandlers, WRITE_CMDS, dbNameFor } from './handlers';

const env = {
  async initEngine() {
    // 引擎初始化在 openDatabase 内完成(动态 import wasm)。
  },
  async openDB(name: string) {
    const sqliteUrl = currentOpenArgs?.sqliteUrl ?? '/vendor/sqlite3.mjs';
    // 动态加载官方构建;initModule 会从同目录定位 sqlite3.wasm。
    const mod = (await import(/* @vite-ignore */ sqliteUrl)) as {
      default: (cfg?: unknown) => Promise<{ oo1: { DB: new (name: string, flags?: string) => SqliteConn } }>;
    };
    const sqlite3 = await mod.default({ print: () => {}, printErr: (m: string) => console.warn('[sqlite]', m) });
    let conn: SqliteConn;
    try {
      conn = new sqlite3.oo1.DB(`opfs://${name}`, 'c');
    } catch (e) {
      throw new Error(
        `无法打开 OPFS 数据库(${name}):${e instanceof Error ? e.message : String(e)}。` +
        '已阻止工作账本写入以保护数据;请检查浏览器是否支持 OPFS 及 COOP/COEP 头。',
      );
    }
    return { api: wrapConn(conn), close: () => conn.close() };
  },
};

interface SqliteConn { exec(opts: Record<string, unknown>): void; close(): void }
let currentOpenArgs: { sqliteUrl?: string } | null = null;

function wrapConn(conn: SqliteConn) {
  const api = {
    run(sql: string, params: unknown[] = []) { conn.exec({ sql, bind: params }); },
    all(sql: string, params: unknown[] = []) {
      const rows: unknown[] = [];
      conn.exec({ sql, bind: params, rowMode: 'object', callback: (row: unknown) => rows.push(row) });
      return rows;
    },
    get(sql: string, params: unknown[] = []) { return api.all(sql, params)[0]; },
    transaction<T>(fn: (tx: DBApi) => T): T {
      conn.exec('BEGIN IMMEDIATE');
      try {
        const out = fn(api);
        conn.exec('COMMIT');
        return out;
      } catch (e) {
        try { conn.exec('ROLLBACK'); } catch { /* 已回滚 */ }
        throw e;
      }
    },
  };
  return api;
}

const built = buildHandlers(env);

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
    const result = await handler(req.args as never, built.db());
    resp = { id: req.id, ok: true, result };
  } catch (e) {
    resp = { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (WRITE_CMDS.has(req.cmd)) resp.event = 'changed';
  (self as unknown as Worker).postMessage(resp);
};

void dbNameFor;
export {};
