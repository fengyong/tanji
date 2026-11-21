// 主线程客户端:类型化代理,同时支持浏览器 Worker 与测试用 Node 直连适配器。
import type { WorkerRequest, WorkerResponse, LocalDBCommands } from './protocol';

export interface LocalDBClient {
  call<K extends keyof LocalDBCommands>(
    cmd: K,
    ...args: LocalDBCommands[K] extends void ? [] : [LocalDBCommands[K]]
  ): Promise<unknown>;
  onChange(cb: () => void): void;
  dispose(): void;
}

export function createWorkerClient(workerURL: string, sqliteURL: string): LocalDBClient {
  const worker = new Worker(workerURL, { type: 'module' });
  let seq = 1;
  void sqliteURL; // sqliteUrl 随 open 命令传入(见 LocalDBCommands.open)
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const changeCbs: (() => void)[] = [];
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const resp = ev.data;
    const entry = pending.get(resp.id);
    if (entry) {
      pending.delete(resp.id);
      if (resp.ok) entry.resolve(resp.result);
      else entry.reject(new Error(resp.error ?? 'worker error'));
    }
    if (resp.event === 'changed') changeCbs.forEach((cb) => cb());
  };
  return {
    call(cmd, ...rest) {
      const id = seq++;
      const req: WorkerRequest = { id, cmd, args: rest[0] };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage(req);
      });
    },
    onChange(cb) { changeCbs.push(cb); },
    dispose() { worker.terminate(); },
  };
}

/** 测试适配器:直接以 DBApi 驱动 handlers(不经 Worker);Node 环境用同版本 SQLite WASM。 */
export function createDirectClient(handlers: Record<string, (args: never, db: unknown) => unknown>): LocalDBClient {
  const changeCbs: (() => void)[] = [];
  return {
    async call(cmd, ...rest) {
      const handler = handlers[cmd];
      if (!handler) throw new Error(`未知命令 ${cmd}`);
      const out = await handler(rest[0] as never, null);
      changeCbs.forEach((cb) => cb());
      return out;
    },
    onChange(cb) { changeCbs.push(cb); },
    dispose() {},
  };
}
