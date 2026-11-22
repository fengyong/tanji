// opfs-sahpool 对照基准(M0 实测):同步句柄无代理往返,应远快于经典 opfs VFS。
const sqlite3p = import('/vendor/sqlite3.mjs').then((m) => m.default({
  print: () => {}, printErr: () => {},
  config: { disable: { vfs: { opfs: true } } }, // 关闭经典 opfs 安装,避免与 sahpool 竞争
}));
self.onmessage = async (ev) => {
  const { mode } = ev.data ?? {};
  try {
    const sqlite3 = await sqlite3p;
    if (mode !== 'bench') { self.postMessage({ ok: false, msg: 'unknown mode' }); return; }
    // sahpool:安装池 VFS
    const poolVfs = await sqlite3.installOpfsSAHPoolVfs({});
    const t0 = performance.now();
    const db = new sqlite3.oo1.DB({ filename: 'bench.db', vfs: poolVfs.name, flags: 'c' });
    db.exec('CREATE TABLE IF NOT EXISTS t (k TEXT PRIMARY KEY, v TEXT)');
    for (let i = 0; i < 10; i++) {
      db.exec({ sql: 'INSERT OR REPLACE INTO t VALUES (?, ?)', bind: ['k' + i, 'v' + i] });
    }
    const rows = [];
    db.exec({ sql: 'SELECT COUNT(*) AS n FROM t', rowMode: 'object', callback: (r) => rows.push(r) });
    db.close();
    const writeMs = Math.round(performance.now() - t0);
    self.postMessage({ ok: true, writeMs, count: rows[0]?.n, vfsName: poolVfs.name });
  } catch (e) {
    self.postMessage({ ok: false, msg: String(e.message || e) });
  }
};
