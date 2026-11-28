/* ================= 持久化:IndexedDB(真实 SQLite .db 字节) + localStorage 双保险 ================= */
import {nowStr} from './util.js';
import {db,Store,DEFAULT_MEDAL_RULES} from './storage.js';

/* ================= 持久化:IndexedDB(真实 SQLite .db 字节) + localStorage 双保险 ================= */
export function buildSqliteBytes(state=db){
  if(!Store.sqlite3)return null;
  try{
    const s=Store.sqlite3;
    const d=new s.oo1.DB(':memory:','ct');
    d.exec(`CREATE TABLE IF NOT EXISTS orders(
      id INTEGER PRIMARY KEY, store TEXT NOT NULL, category TEXT, contact TEXT,
      price REAL NOT NULL, deposit REAL DEFAULT 0,
      appt_at TEXT, shot_at TEXT, submitted_at TEXT, short_sent_at TEXT, long_sent_at TEXT,
      deposit_paid_at TEXT, final_paid_at TEXT, settle_via TEXT DEFAULT 'private', remind_at TEXT,
      channel TEXT, partner TEXT,
      location TEXT, gps_place TEXT, deliver_main INTEGER DEFAULT 1, deliver_sub INTEGER DEFAULT 1,
      review_result TEXT DEFAULT '', published_at TEXT,
      account_id INTEGER,
      note TEXT, remind_log TEXT, expect_pay_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS payments(
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, kind TEXT, amount REAL,
      paid_at TEXT, method TEXT, note TEXT);
    CREATE TABLE IF NOT EXISTS accounts(
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, level TEXT DEFAULT 'Lv.5', phone TEXT, douyin TEXT,
      color INTEGER DEFAULT 0, avatar TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);`);
    const so=d.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    state.orders.forEach(o=>{
      so.bind([o.id,o.store,o.cat||null,o.contact||null,o.price,o.deposit,o.appt,o.shotAt,o.submittedAt,o.shortAt,o.longAt,
               o.depositPaidAt,o.finalPaidAt,o.settleVia||'private',o.remindAt||null,o.channel||null,o.partner||null,
               o.location||null,o.gpsPlace||null,o.deliverMain===false?0:1,o.deliverSub===false?0:1,o.reviewResult||'',o.publishedAt||null,
               o.accountId||null,o.note||null,(o.remindLog&&o.remindLog.length?JSON.stringify(o.remindLog):null),o.expectPayAt||null,nowStr(),nowStr()]);
      so.step();so.reset();
    });
    so.finalize();
    const sa=d.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?)');
    (state.accounts||[]).forEach(a=>{
      sa.bind([a.id,a.name,a.level||'Lv.5',a.phone||null,a.douyin||null,a.color??0,a.avatar||null,a.createdAt||null]);
      sa.step();sa.reset();
    });
    sa.finalize();
    const sp=d.prepare('INSERT INTO payments (order_id,kind,amount,paid_at,method,note) VALUES (?,?,?,?,?,?)');
    state.payments.forEach(p=>{
      sp.bind([p.oid,p.kind,p.amount,p.at,p.method,p.note||null]);sp.step();sp.reset();
    });
    sp.finalize();
    const ss=d.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
    ss.bind(['collect_threshold_days',String(state.threshold)]);ss.step();ss.reset();
    ss.bind(['medal_rules',JSON.stringify(state.medalRules||DEFAULT_MEDAL_RULES)]);ss.step();ss.reset();
    ss.bind(['app_version','0.6']);ss.step();ss.reset();
    ss.bind(['exported_at',nowStr()]);ss.step();ss.reset();
    ss.finalize();
    const bytes=s.capi.sqlite3_js_db_export(d.pointer);
    d.close();
    return bytes&&bytes.length?bytes:null;
  }catch(e){console.warn('sqlite build fail',e);return null}
}
export async function initSqlite(){
  try{
    for(let i=0;i<60&&!window.sqlite3InitModule;i++)await new Promise(r=>setTimeout(r,100));
    if(typeof window.sqlite3InitModule!=='function')return null;
    const s=await window.sqlite3InitModule({print:()=>{},printErr:()=>{}});
    return s;
  }catch(e){return null}
}
