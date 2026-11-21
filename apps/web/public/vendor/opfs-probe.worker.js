// OPFS 探针 Worker(M0 验收专用,不参与业务):验证 opfs VFS 写入/持久化/失败保全。
const warnings = [];
const sqlite3p = import('/vendor/sqlite3.mjs').then((m) => m.default({
  print: () => {}, printErr: () => {},
  warn: (m) => warnings.push(String(m)),
}));

self.onmessage = async (ev) => {
  const { name, mode } = ev.data ?? {};
  try {
    const sqlite3 = await sqlite3p;
    if (mode === 'failcheck') {
      try {
        const db = new sqlite3.oo1.DB('nosuchvfs://x/y.db', 'c');
        db.close();
        self.postMessage({ failOpen: false });
      } catch (e) {
        self.postMessage({ failOpen: true, msg: String(e.message || e) });
      }
      return;
    }
    // opfs VFS 通过 initializersAsync 异步安装;等待其完成(代理 worker 就绪)。
    await new Promise((r) => setTimeout(r, 800));
    let db;
    try {
      db = new sqlite3.oo1.DB({ filename: name, vfs: 'opfs', flags: 'c' });
    } catch (e) {
      const diag = {
        vfs_opfs: (() => { try { return !!sqlite3.capi.sqlite3_vfs_find('opfs'); } catch { return 'err'; } })(),
        opfs_ns: typeof sqlite3.opfs,
        keys: Object.keys(sqlite3).slice(0, 14),
        version: sqlite3.version || null,
        inWorker: typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope,
        warnings: warnings.slice(0, 4),
      };
      self.postMessage({ error: String(e.message || e), diag });
      return;
    }
    db.exec('CREATE TABLE IF NOT EXISTS t (k TEXT PRIMARY KEY, v TEXT)');
    if (mode === 'write') {
      db.exec({ sql: "INSERT OR REPLACE INTO t VALUES ('probe', ?)", bind: ['hello-' + Date.now()] });
    }
    const rows = [];
    db.exec({ sql: "SELECT v FROM t WHERE k='probe'", rowMode: 'object', callback: (r) => rows.push(r) });
    db.close();
    self.postMessage({ value: rows[0]?.v || null });
  } catch (e) {
    self.postMessage({ error: String(e.message || e) });
  }
};
