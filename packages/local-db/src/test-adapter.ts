// Node 测试适配器:与浏览器 Worker 共用 buildHandlers;SQLite 用 Node 22 内置 node:sqlite(真实 SQLite)。
// 浏览器 OPFS 的真实持久化由 Chrome E2E 另行覆盖;此处验证业务/事务/重放逻辑本身。
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import type { DBApi } from './repo';
import { buildHandlers, dbNameFor, type HandlerEnv } from './handlers';
import type { LocalDBCommands } from './protocol';

// 动态引入以绕过 Vite 静态解析(node:sqlite 是 Node 22 内置模块)
const loadSqlite = async (): Promise<{ DatabaseSync: new (file: string) => DatabaseSync }> =>
  (await import(/* @vite-ignore */ 'node' + ':sqlite')) as { DatabaseSync: new (file: string) => DatabaseSync };

export async function createNodeLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanji-db-'));
  const { DatabaseSync } = await loadSqlite();

  function wrapConn(db: DatabaseSync): DBApi {
    const api: DBApi = {
      run(sql, params = []) { db.prepare(sql).run(...(params as never[])); },
      all(sql, params = []) {
        return db.prepare(sql).all(...(params as never[])) as unknown[];
      },
      get(sql, params = []) {
        return db.prepare(sql).get(...(params as never[]));
      },
      transaction<T>(fn: (tx: DBApi) => T): T {
        db.exec('BEGIN IMMEDIATE');
        try {
          const out = fn(api);
          db.exec('COMMIT');
          return out;
        } catch (e) {
          try { db.exec('ROLLBACK'); } catch { /* 已回滚 */ }
          throw e;
        }
      },
    };
    return api;
  }

  const env: HandlerEnv = {
    async openDB(name: string) {
      const file = path.join(dir, name.replace(/\//g, '__'));
      const db = new DatabaseSync(file);
      return { api: wrapConn(db), close: () => db.close() };
    },
  };
  const built = buildHandlers(env);

  return {
    async call<K extends keyof LocalDBCommands>(
      cmd: K,
      ...rest: LocalDBCommands[K] extends void ? [] : [LocalDBCommands[K]]
    ): Promise<unknown> {
      const handler = built.handlers[cmd];
      if (!handler) throw new Error(`未知命令 ${String(cmd)}`);
      return handler(rest[0] as never, null);
    },
    reset() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
    dir,
    dbNameFor,
  };
}
