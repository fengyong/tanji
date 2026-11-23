// src/app/env.js
var CAP = typeof window !== "undefined" && window.TanjiCap || null;
var isNative = !!(CAP && CAP.Capacitor && CAP.Capacitor.isNativePlatform && CAP.Capacitor.isNativePlatform());
var APP_STORE_URL = "";
var LEGAL_BASE = "https://tanji-app-guvc.zai.site/";

// src/app/util.js
var $ = (s) => document.querySelector(s);
var pad = (n) => String(n).padStart(2, "0");
var now = /* @__PURE__ */ new Date();
var TODAY = toISO(now);
function tickClock() {
  const previous = TODAY;
  now = /* @__PURE__ */ new Date();
  TODAY = toISO(now);
  return { changed: previous !== TODAY, previous };
}
function dOff(days, hm = "10:00") {
  const t = /* @__PURE__ */ new Date();
  t.setDate(t.getDate() + days);
  return `${toISO(t)}T${hm}`;
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function validDateTime(value) {
  return TanJiLogic.validDateTime(value);
}
function nowStr() {
  const n = /* @__PURE__ */ new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}T${pad(n.getHours())}:${pad(n.getMinutes())}`;
}
function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtD(s) {
  if (!s) return "\u2014";
  const d = new Date(s);
  return `${d.getMonth() + 1}-${pad(d.getDate())}`;
}
function fmtHM(s) {
  return s ? s.slice(11, 16) : "\u2014";
}
function fmtDT(s) {
  return s ? `${fmtD(s)} ${fmtHM(s)}` : "\u2014";
}
function fmtMoney(n, masked) {
  return masked ? "\xA5\u2731\u2731\u2731" : "\xA5" + n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
var DOW = "\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u65E5";
var dowOf = (s) => DOW[(new Date(s.length === 10 ? s + "T00:00" : s).getDay() + 6) % 7];
function relativeDayLabel(value, baseDay = TODAY) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !/^\d{4}-\d{2}-\d{2}$/.test(baseDay)) return "";
  const target = /* @__PURE__ */ new Date(value + "T00:00:00"), base = /* @__PURE__ */ new Date(baseDay + "T00:00:00");
  if (Number.isNaN(target.getTime()) || Number.isNaN(base.getTime()) || toISO(target) !== value || toISO(base) !== baseDay) return "";
  const days = Math.round((Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) - Date.UTC(base.getFullYear(), base.getMonth(), base.getDate())) / 864e5);
  const relative = days === 0 ? "\u4ECA\u5929" : days === 1 ? "\u660E\u5929" : days === 2 ? "\u540E\u5929" : days === -1 ? "\u6628\u5929" : days === -2 ? "\u524D\u5929" : days > 2 ? `${days} \u5929\u540E` : `${-days} \u5929\u524D`;
  return `${value} \u5468${dowOf(value)} \xB7 ${relative}`;
}
async function copyText(text) {
  try {
    if (isNative && CAP && CAP.Clipboard) {
      await CAP.Clipboard.write({ string: text });
      return true;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

// src/app/demo.js
var FINAL_METHOD = { 14: "\u94F6\u884C\u5361", 15: "\u6296\u97F3\u5546\u5355", 16: "\u652F\u4ED8\u5B9D" };
function demoSeed() {
  const O = [
    {
      id: 1,
      store: "\u9E93\u91CE\u65E5\u6599\xB7\u4E07\u8C61\u57CE\u5E97",
      cat: "\u9910\u996E",
      contact: "\u738B\u5E97\u957F 138****2043",
      price: 1600,
      deposit: 500,
      settleVia: "private",
      appt: dOff(0, "14:00"),
      shotAt: null,
      submittedAt: null,
      shortAt: null,
      longAt: null,
      depositPaidAt: dOff(-3, "11:20"),
      finalPaidAt: null,
      remindAt: null,
      note: "\u91CD\u70B9\u62CD\u5BFF\u53F8\u62FC\u76D8\u4E0E\u73AF\u5883\u6C1B\u56F4,\u7AD6\u5C4F 3 \u6761"
    },
    {
      id: 2,
      store: "\u6F84\u5DDD\u5496\u5561\xB7\u6EE8\u6C5F\u5E97",
      cat: "\u5496\u5561",
      contact: "\u9648\u59D0 139****8871",
      price: 800,
      deposit: 300,
      settleVia: "private",
      appt: dOff(0, "09:30"),
      shotAt: dOff(0, "10:12"),
      submittedAt: null,
      shortAt: null,
      longAt: null,
      depositPaidAt: dOff(-2, "15:00"),
      finalPaidAt: null,
      remindAt: null,
      note: "\u4E0A\u5348\u5DF2\u62CD\u5B8C,\u4E0B\u5348\u51FA\u7247\u63D0\u5BA1"
    },
    {
      id: 3,
      store: "\u5357\u6816\u70D8\u7119\xB7\u5927\u5B66\u57CE\u5E97",
      cat: "\u70D8\u7119",
      contact: "\u6797\u751F 137****6602",
      price: 900,
      deposit: 300,
      settleVia: "private",
      appt: dOff(1, "10:30"),
      shotAt: null,
      submittedAt: null,
      shortAt: null,
      longAt: null,
      depositPaidAt: dOff(-1, "18:40"),
      finalPaidAt: null,
      remindAt: null,
      note: "\u6B27\u5305\u7279\u5199\u4E3A\u4E3B"
    },
    {
      id: 4,
      store: "\u62FE\u5149\u6C49\u670D\u4F53\u9A8C\u9986",
      cat: "\u4F53\u9A8C\u9986",
      contact: "\u82CF\u82CF 189****3355",
      price: 1500,
      deposit: 0,
      settleVia: "private",
      appt: dOff(2, "15:00"),
      shotAt: null,
      submittedAt: null,
      shortAt: null,
      longAt: null,
      depositPaidAt: null,
      finalPaidAt: null,
      remindAt: null,
      note: "\u5F85\u6536\u5B9A\u91D1;\u62CD\u6444\u542B\u5986\u9020\u4E24\u4E2A\u573A\u666F"
    },
    {
      id: 5,
      store: "\u5C71\u91CE\u5496\u5561\xB7\u9732\u53F0\u5E97",
      cat: "\u5496\u5561",
      contact: "\u963F\u54F2 136****9027",
      price: 1200,
      deposit: 400,
      settleVia: "private",
      appt: dOff(4, "13:00"),
      shotAt: null,
      submittedAt: null,
      shortAt: null,
      longAt: null,
      depositPaidAt: dOff(-1, "12:10"),
      finalPaidAt: null,
      remindAt: null,
      note: "\u9732\u53F0\u81EA\u7136\u5149,\u4E0B\u5348\u4E09\u70B9\u540E\u6700\u4F73"
    },
    {
      id: 6,
      store: "\u534A\u7CD6\u751C\u54C1\u7814\u7A76\u6240",
      cat: "\u751C\u54C1",
      contact: "Vivi 135****4419",
      price: 1e3,
      deposit: 300,
      settleVia: "private",
      appt: dOff(6, "14:30"),
      shotAt: null,
      submittedAt: null,
      shortAt: null,
      longAt: null,
      depositPaidAt: dOff(-4, "10:05"),
      finalPaidAt: null,
      remindAt: null,
      note: ""
    },
    {
      id: 7,
      store: "\u4E91\u7AEF\u897F\u9910\u5385\xB733\u697C",
      cat: "\u9910\u996E",
      contact: "\u5468\u7ECF\u7406 138****7710",
      price: 2200,
      deposit: 600,
      settleVia: "private",
      appt: dOff(9, "18:30"),
      shotAt: null,
      submittedAt: null,
      shortAt: null,
      longAt: null,
      depositPaidAt: null,
      finalPaidAt: null,
      remindAt: null,
      note: "\u591C\u666F\u673A\u4F4D,\u9700\u5E26\u8865\u5149;\u5B9A\u91D1\u5DF2\u50AC\u4E24\u6B21"
    },
    {
      id: 8,
      store: "\u5C71\u8336\u82B1\u5976\u8336\xB7\u89C2\u524D\u8857\u5E97",
      cat: "\u8336\u996E",
      contact: "\u53F6\u5B50 150****2288",
      price: 1e3,
      deposit: 300,
      settleVia: "private",
      appt: dOff(-1, "10:00"),
      shotAt: dOff(-1, "11:05"),
      submittedAt: dOff(-1, "16:40"),
      shortAt: null,
      longAt: null,
      depositPaidAt: dOff(-3, "09:30"),
      finalPaidAt: null,
      remindAt: null,
      note: ""
    },
    {
      id: 9,
      store: "\u94C1\u517D\u5065\u8EAB\xB7\u79C1\u6559\u5DE5\u4F5C\u5BA4",
      cat: "\u5065\u8EAB",
      contact: "K\u54E5 186****5566",
      price: 1300,
      deposit: 400,
      settleVia: "private",
      appt: dOff(-3, "19:00"),
      shotAt: dOff(-3, "19:40"),
      submittedAt: dOff(-2, "10:00"),
      shortAt: dOff(-1, "12:00"),
      longAt: null,
      depositPaidAt: dOff(-5, "14:00"),
      finalPaidAt: null,
      remindAt: null,
      note: "\u957F\u7247\u7B49\u5BA2\u6237\u786E\u8BA4\u53E3\u64AD\u7248\u672C"
    },
    {
      id: 10,
      store: "\u5FAA\u73AF\u6D17\u8863\xB7Central\u5E97",
      cat: "\u96F6\u552E",
      contact: "\u4F55\u5E97\u957F 131****0093",
      price: 1400,
      deposit: 400,
      settleVia: "private",
      appt: dOff(-9, "15:00"),
      shotAt: dOff(-9, "15:35"),
      submittedAt: dOff(-8, "09:00"),
      shortAt: dOff(-6, "14:10"),
      longAt: null,
      depositPaidAt: dOff(-10, "11:00"),
      finalPaidAt: null,
      remindAt: null,
      note: ""
    },
    {
      id: 11,
      store: "TONI \u9020\u578B\u6C99\u9F99\xB7\u6E56\u7554\u5E97",
      cat: "\u7F8E\u53D1",
      contact: "Tony 137****8123",
      price: 1200,
      deposit: 300,
      settleVia: "private",
      appt: dOff(-18, "14:00"),
      shotAt: dOff(-18, "14:40"),
      submittedAt: dOff(-17, "10:30"),
      shortAt: dOff(-15, "16:00"),
      longAt: dOff(-14, "11:20"),
      depositPaidAt: dOff(-19, "09:00"),
      finalPaidAt: null,
      remindAt: null,
      note: '\u5FAE\u4FE1\u50AC\u8FC7\u4E00\u6B21,\u56DE\u590D"\u6708\u5E95\u7EDF\u4E00\u7ED3"',
      remindLog: [{ at: dOff(-9, "18:30"), note: '\u5FAE\u4FE1\u95EE\u4E86\u4E00\u6B21,\u56DE\u590D"\u6708\u5E95\u7EDF\u4E00\u7ED3"' }]
    },
    {
      id: 12,
      store: "\u6816\u91CC\u6C11\u5BBF\xB7\u592A\u6E56\u5E97",
      cat: "\u6C11\u5BBF",
      contact: "\u6D01\u59D0 139****5160",
      price: 1800,
      deposit: 500,
      settleVia: "douyin",
      appt: dOff(-34, "11:00"),
      shotAt: dOff(-34, "11:40"),
      submittedAt: dOff(-33, "15:00"),
      shortAt: dOff(-31, "10:00"),
      longAt: dOff(-30, "17:30"),
      depositPaidAt: dOff(-35, "10:00"),
      finalPaidAt: null,
      remindAt: null,
      note: "\u6296\u97F3\u5546\u5355;\u5E73\u53F0\u5BA1\u6838\u901A\u8FC7\u540E\u7ED3\u7B97,\u9884\u8BA1 T+7 \u5230\u8D26",
      expectPayAt: dOff(-20, "10:00")
    },
    {
      id: 13,
      store: "\u57CE\u5E02\u9732\u8425\u5730\xB7\u90CA\u91CE\u516C\u56ED",
      cat: "\u9732\u8425",
      contact: "\u5927\u9E4F 188****6678",
      price: 1500,
      deposit: 0,
      settleVia: "private",
      appt: dOff(-41, "16:00"),
      shotAt: dOff(-41, "16:30"),
      submittedAt: dOff(-40, "12:00"),
      shortAt: dOff(-38, "15:00"),
      longAt: dOff(-36, "10:40"),
      depositPaidAt: null,
      finalPaidAt: null,
      remindAt: null,
      note: "\u5168\u6B3E\u5C3E\u6B3E\u5F85\u7ED3;\u591A\u6B21\u5FAE\u4FE1\u672A\u56DE,\u7EA6\u4E86\u5468\u4E94\u7535\u8BDD",
      remindLog: [{ at: dOff(-12, "10:10"), note: "\u5FAE\u4FE1\u672A\u56DE" }, { at: dOff(-5, "20:40"), note: "\u7535\u8BDD\u7EA6\u4E86\u5468\u4E94\u518D\u8C08" }]
    },
    {
      id: 14,
      store: "\u8001\u95E8\u4E1C\u706B\u9505\xB7\u65D7\u8230\u5E97",
      cat: "\u9910\u996E",
      contact: "\u5218\u603B 133****2280",
      price: 1600,
      deposit: 500,
      settleVia: "private",
      appt: dOff(-6, "17:30"),
      shotAt: dOff(-6, "18:10"),
      submittedAt: dOff(-5, "11:00"),
      shortAt: dOff(-4, "14:00"),
      longAt: dOff(-3, "16:20"),
      depositPaidAt: dOff(-7, "10:30"),
      finalPaidAt: dOff(-2, "15:20"),
      remindAt: null,
      note: "\u5C3E\u6B3E\u5BF9\u516C\u8F6C\u8D26"
    },
    {
      id: 15,
      store: "\u559C\u90BB\u8D85\u5E02\xB7\u793E\u533A\u5E97",
      cat: "\u96F6\u552E",
      contact: "\u8303\u5E97 158****3366",
      price: 900,
      deposit: 300,
      settleVia: "douyin",
      appt: dOff(-12, "10:00"),
      shotAt: dOff(-12, "10:35"),
      submittedAt: dOff(-11, "14:00"),
      shortAt: dOff(-10, "15:00"),
      longAt: dOff(-9, "11:00"),
      depositPaidAt: dOff(-13, "16:00"),
      finalPaidAt: dOff(-8, "10:00"),
      remindAt: null,
      note: ""
    },
    {
      id: 16,
      store: "\u9EA6\u4ED3\u9762\u5305\xB7\u5965\u4F53\u5E97",
      cat: "\u70D8\u7119",
      contact: "Kiki 182****7745",
      price: 800,
      deposit: 200,
      settleVia: "private",
      appt: dOff(-25, "09:30"),
      shotAt: dOff(-25, "10:10"),
      submittedAt: dOff(-24, "10:00"),
      shortAt: dOff(-22, "14:30"),
      longAt: dOff(-21, "10:00"),
      depositPaidAt: dOff(-26, "15:00"),
      finalPaidAt: dOff(-18, "11:30"),
      remindAt: null,
      note: ""
    },
    {
      id: 17,
      store: "\u6A58\u6735\u82B1\u827A\u5DE5\u4F5C\u5BA4",
      cat: "\u96F6\u552E",
      contact: "\u5C0F\u6A58 177****9012",
      price: 1100,
      deposit: 300,
      settleVia: "private",
      appt: dOff(-4, "16:00"),
      shotAt: dOff(-4, "16:40"),
      submittedAt: dOff(-3, "12:00"),
      shortAt: dOff(-2, "13:00"),
      longAt: dOff(-1, "15:00"),
      depositPaidAt: dOff(-6, "11:00"),
      finalPaidAt: dOff(0, "08:40"),
      remindAt: null,
      note: "\u4ECA\u65E9\u5DF2\u6536\u5C3E\u6B3E"
    }
  ];
  const P = [];
  O.forEach((o) => {
    if (o.depositPaidAt && o.deposit > 0) P.push({ oid: o.id, kind: "\u5B9A\u91D1", amount: o.deposit, at: o.depositPaidAt, method: o.depMethod || "\u5FAE\u4FE1" });
    if (o.finalPaidAt) P.push({ oid: o.id, kind: "\u5C3E\u6B3E", amount: o.price - o.deposit, at: o.finalPaidAt, method: FINAL_METHOD[o.id] || (o.settleVia === "douyin" ? "\u6296\u97F3\u5546\u5355" : "\u5FAE\u4FE1") });
  });
  return { orders: O, payments: P, threshold: 15 };
}

// src/app/storage.js
var db = { orders: [], payments: [], threshold: 15 };
var Store = { sqlite3: null, mode: "demo", revision: 0, queue: Promise.resolve(), ready: false, busy: false, blocked: false, lockedOut: false, backup: null, status: "\u6B63\u5728\u8BFB\u53D6\u672C\u673A\u6570\u636E\u2026", pending: null };
var afterLoad = null;
var bytesBuilder = null;
function registerStorageHooks(hooks) {
  afterLoad = hooks;
}
function registerBytesBuilder(fn) {
  bytesBuilder = fn;
}
async function acquireWriter() {
  if (isNative) return;
  if (!navigator.locks) {
    Store.lockedOut = true;
    return;
  }
  await new Promise((resolve) => {
    navigator.locks.request("tanji-data-writer", { ifAvailable: true }, async (lock) => {
      Store.lockedOut = !lock;
      resolve();
      if (lock) await new Promise(() => {
      });
    }).catch(() => {
      Store.lockedOut = true;
      resolve();
    });
  });
}
var storageKey = (mode, suffix = "json") => `tanji_v3_${mode}_${suffix}`;
var cloneState = (value) => JSON.parse(JSON.stringify(value));
var idb = {
  _db: null,
  _opening: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    if (this._opening) return this._opening;
    this._opening = new Promise((resolve) => {
      try {
        const request = indexedDB.open("tanji", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("kv");
        request.onsuccess = () => {
          this._db = request.result;
          this._db.onversionchange = () => {
            this._db.close();
            this._db = null;
          };
          resolve(this._db);
        };
        request.onerror = request.onblocked = () => resolve(null);
      } catch (error) {
        resolve(null);
      }
    }).then((value) => {
      this._opening = null;
      return value;
    });
    return this._opening;
  },
  async get(key) {
    const database = await this.open();
    if (!database) return { ok: false, value: null };
    return new Promise((resolve) => {
      try {
        const transaction = database.transaction("kv"), request = transaction.objectStore("kv").get(key);
        transaction.oncomplete = () => resolve({ ok: true, value: request.result ?? null });
        transaction.onerror = transaction.onabort = () => resolve({ ok: false, value: null });
      } catch (error) {
        resolve({ ok: false, value: null });
      }
    });
  },
  async setMany(entries) {
    const database = await this.open();
    if (!database) return false;
    return new Promise((resolve) => {
      let transaction;
      try {
        transaction = database.transaction("kv", "readwrite");
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = transaction.onabort = () => resolve(false);
        for (const [key, value] of entries) transaction.objectStore("kv").put(value, key);
      } catch (error) {
        if (transaction) transaction.abort();
        resolve(false);
      }
    });
  }
};
function localRead(key) {
  try {
    const text = localStorage.getItem(key);
    return { ok: true, value: text === null ? null : JSON.parse(text) };
  } catch (error) {
    return { ok: false, value: null };
  }
}
function localWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    return false;
  }
}
function validateState(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.orders) || !Array.isArray(input.payments)) throw new Error("\u5907\u4EFD\u5FC5\u987B\u5305\u542B\u8BA2\u5355\u4E0E\u6536\u6B3E\u6D41\u6C34\u6570\u7EC4");
  if (input.version && !["0.2", "0.3", "0.4", "0.5", "0.6"].includes(input.version)) throw new Error("\u6682\u4E0D\u652F\u6301\u8FD9\u4E2A\u5907\u4EFD\u7248\u672C");
  if (input.v !== void 0 && input.v !== 2 && input.v !== 3) throw new Error("\u6682\u4E0D\u652F\u6301\u8FD9\u4E2A\u6570\u636E\u7248\u672C");
  const threshold = input.threshold ?? input.collectThresholdDays ?? 15;
  if (![7, 15, 30, 45].includes(threshold)) throw new Error("\u50AC\u6536\u9608\u503C\u5E94\u4E3A 7\u300115\u300130 \u6216 45 \u5929");
  const amount = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-5;
  const text = (value, label, fallback = "") => {
    if (value == null) return fallback;
    if (typeof value !== "string") throw new Error(`${label}\u5FC5\u987B\u662F\u6587\u672C`);
    return value;
  };
  const dates = ["shotAt", "submittedAt", "shortAt", "longAt", "depositPaidAt", "finalPaidAt", "remindAt", "publishedAt"];
  const ids = /* @__PURE__ */ new Set();
  const accountIds = /* @__PURE__ */ new Set();
  const accounts = (Array.isArray(input.accounts) ? input.accounts : []).map((account, index) => {
    const label = `\u7B2C ${index + 1} \u4E2A\u8D26\u53F7`;
    if (!account || !Number.isSafeInteger(account.id) || account.id < 1 || accountIds.has(account.id)) throw new Error(`${label}\u7684 ID \u65E0\u6548\u6216\u91CD\u590D`);
    if (typeof account.name !== "string" || !account.name.trim()) throw new Error(`${label}\u7F3A\u5C11\u6635\u79F0`);
    accountIds.add(account.id);
    const clean = {
      id: account.id,
      name: account.name,
      phone: text(account.phone, `${label}\u7684\u624B\u673A\u53F7`),
      douyin: text(account.douyin, `${label}\u7684\u6296\u97F3\u8D26\u53F7`),
      color: Number.isSafeInteger(account.color) ? Math.max(0, Math.min(7, account.color)) : index % 8,
      createdAt: text(account.createdAt, `${label}\u7684\u521B\u5EFA\u65F6\u95F4`) || null
    };
    if (account.avatar != null) {
      if (typeof account.avatar !== "string" || account.avatar !== "" && !(typeof TanJiImage !== "undefined" && TanJiImage.isValidStored(account.avatar))) throw new Error(`${label}\u7684\u5934\u50CF\u6570\u636E\u65E0\u6548`);
      if (account.avatar.length > 2e5) throw new Error(`${label}\u7684\u5934\u50CF\u56FE\u7247\u8FC7\u5927`);
      clean.avatar = account.avatar;
    }
    return clean;
  });
  const seenProviders = /* @__PURE__ */ new Set();
  const providers = (Array.isArray(input.providers) ? input.providers : []).filter((p) => {
    if (typeof p !== "string") throw new Error("\u670D\u52A1\u5546\u9884\u8BBE\u5FC5\u987B\u662F\u6587\u672C");
    const v = p.trim();
    if (!v || seenProviders.has(v)) return false;
    seenProviders.add(v);
    return true;
  });
  const orders = input.orders.map((order, index) => {
    const label = `\u7B2C ${index + 1} \u7B14\u8BA2\u5355`;
    if (!order || !Number.isSafeInteger(order.id) || order.id < 1 || order.id >= 1e5 || ids.has(order.id)) throw new Error(`${label}\u7684 ID \u65E0\u6548\u3001\u91CD\u590D\u6216\u8D85\u8FC7\u4E0A\u9650(99999)`);
    ids.add(order.id);
    if (typeof order.store !== "string" || !order.store.trim()) throw new Error(`${label}\u7F3A\u5C11\u5546\u5BB6\u540D\u79F0`);
    if (!amount(order.price) || !amount(order.deposit) || order.deposit > order.price) throw new Error(`${label}\u7684\u603B\u4EF7\u6216\u5B9A\u91D1\u4E0D\u5408\u6CD5`);
    if (!validDateTime(order.appt)) throw new Error(`${label}\u7684\u9884\u7EA6\u65F6\u95F4\u65E0\u6548`);
    if (order.settleVia && !["private", "douyin"].includes(order.settleVia)) throw new Error(`${label}\u7684\u7ED3\u7B97\u65B9\u5F0F\u65E0\u6548`);
    if (order.reviewResult != null && !["", "pass", "fail"].includes(order.reviewResult)) throw new Error(`${label}\u7684\u9001\u5BA1\u7ED3\u679C\u65E0\u6548`);
    const clean = {
      id: order.id,
      store: order.store,
      price: Math.round(order.price * 100) / 100,
      deposit: Math.round(order.deposit * 100) / 100,
      appt: order.appt,
      settleVia: order.settleVia || "private",
      location: text(order.location, `${label}\u7684\u5730\u70B9`),
      deliverMain: order.deliverMain !== false,
      deliverSub: order.deliverSub !== false,
      reviewResult: order.reviewResult || "",
      accountId: order.accountId != null && accountIds.has(order.accountId) ? order.accountId : null
    };
    for (const field of ["cat", "contact", "channel", "partner", "note"]) clean[field] = text(order[field], `${label}\u7684${field}`, field === "cat" ? "\u5176\u4ED6" : field === "channel" ? "\u76F4\u5BA2" : "");
    for (const field of dates) {
      if (order[field] != null && !validDateTime(order[field])) throw new Error(`${label}\u7684${field}\u65F6\u95F4\u65E0\u6548`);
      clean[field] = order[field] ?? null;
    }
    if (order.expectPayAt != null && order.expectPayAt !== "") {
      if (!validDateTime(order.expectPayAt)) throw new Error(`${label}\u7684\u9884\u8BA1\u5230\u8D26\u65F6\u95F4\u65E0\u6548`);
      clean.expectPayAt = order.expectPayAt;
    }
    if (Array.isArray(order.remindLog)) clean.remindLog = cloneState(order.remindLog).filter((entry) => entry && validDateTime(entry.at)).map((entry) => ({ at: entry.at, note: typeof entry.note === "string" ? entry.note.slice(0, 200) : "" })).slice(-50);
    if (order.photoThumb != null) {
      const ok = typeof TanJiImage !== "undefined" && TanJiImage.isValidStored(order.photoThumb, TanJiImage.LIMIT.door);
      if (!ok) throw new Error(`${label}\u7684\u968F\u624B\u62CD\u7167\u7247\u65E0\u6548\u6216\u8FC7\u5927`);
      clean.photoThumb = order.photoThumb;
    }
    if (typeof order.gpsPlace === "string" && order.gpsPlace.trim()) {
      const place = order.gpsPlace.trim();
      if (typeof TanJiGeo !== "undefined" && TanJiGeo.isValid(place)) clean.gpsPlace = place;
      else console.warn(`[TanJi] ${label}\u7684\u5230\u5E97\u5B9A\u4F4D\u683C\u5F0F\u65E0\u6548,\u5DF2\u5FFD\u7565`, place);
    }
    return clean;
  });
  const payments = input.payments.map((payment, index) => {
    const label = `\u7B2C ${index + 1} \u7B14\u6D41\u6C34`;
    if (!payment || !ids.has(payment.oid)) throw new Error(`${label}\u627E\u4E0D\u5230\u5BF9\u5E94\u8BA2\u5355`);
    if (!["\u5B9A\u91D1", "\u5C3E\u6B3E"].includes(payment.kind) || !amount(payment.amount) || !validDateTime(payment.at)) throw new Error(`${label}\u7684\u7C7B\u578B\u3001\u91D1\u989D\u6216\u65E5\u671F\u65E0\u6548`);
    if (!["\u5FAE\u4FE1", "\u652F\u4ED8\u5B9D", "\u94F6\u884C\u5361", "\u6296\u97F3\u5546\u5355", "\u5176\u4ED6"].includes(payment.method)) throw new Error(`${label}\u7684\u6536\u6B3E\u65B9\u5F0F\u65E0\u6548`);
    return { oid: payment.oid, kind: payment.kind, amount: Math.round(payment.amount * 100) / 100, at: payment.at, method: payment.method, ...payment.note != null ? { note: text(payment.note, `${label}\u5907\u6CE8`) } : {} };
  });
  const notifyEnabled = input.notifyEnabled === void 0 ? true : input.notifyEnabled !== false;
  return { orders, payments, threshold, notifyEnabled, accounts, providers };
}
function setStorageStatus(message) {
  if (Store.lockedOut) message = "\u5F53\u524D\u4E3A\u53EA\u8BFB\uFF1A\u8BF7\u5173\u95ED\u5176\u4ED6\u63A2\u8BB0\u6807\u7B7E\u9875\u540E\u5237\u65B0\u91CD\u8BD5\uFF1B\u6D4F\u89C8\u5668\u987B\u652F\u6301\u5B89\u5168\u5199\u5165\u9501\u3002";
  Store.status = message;
  const banner = document.querySelector("#storage-status");
  if (banner) {
    banner.hidden = !message;
    banner.querySelector("span").textContent = message;
  }
}
function snapshot(state = db, mode = Store.mode) {
  Store.revision = Math.max(Date.now(), Store.revision + 1);
  return { ...cloneState(state), v: 3, revision: Store.revision, savedAt: (/* @__PURE__ */ new Date()).toISOString(), mode };
}
function persistSnapshot(payload) {
  if (isNative) {
    const write2 = async () => {
      const ok = await nativePersistSnapshot(payload);
      const localOK2 = localWrite(storageKey(payload.mode), payload);
      if (Store.mode === payload.mode && Store.revision === payload.revision && !Store.blocked) {
        if (!ok) setStorageStatus("\u4FDD\u5B58\u5931\u8D25\uFF1A\u6539\u52A8\u4EC5\u5728\u5F53\u524D\u9875\u9762\uFF0C\u8BF7\u52FF\u5173\u95ED\uFF0C\u5148\u5BFC\u51FA JSON \u5907\u4EFD\u518D\u91CD\u8BD5\u3002");
        else if (!localOK2) setStorageStatus("\u7B2C\u4E8C\u526F\u672C\u4FDD\u5B58\u5931\u8D25\uFF08\u672C\u673A\u5B58\u50A8\u7A7A\u95F4\u53EF\u80FD\u5DF2\u6EE1\uFF09\uFF1A\u6539\u52A8\u5DF2\u5199\u8FDB\u6570\u636E\u5E93\uFF0C\u4F46\u5907\u4EFD\u526F\u672C\u6CA1\u5199\u6210\u3002\u8BF7\u5148\u5BFC\u51FA JSON \u5907\u4EFD\uFF0C\u5E76\u6E05\u7406\u672C\u673A\u7A7A\u95F4\u3002");
        else setStorageStatus("");
      }
      return ok;
    };
    Store.queue = Store.queue.then(write2, write2);
    return Store.queue;
  }
  const localOK = localWrite(storageKey(payload.mode), payload);
  const write = async () => {
    const entries = [[storageKey(payload.mode), payload]];
    if (payload.previous) entries.push([storageKey(payload.mode, "backup"), payload.previous]);
    const bytes = bytesBuilder ? bytesBuilder(payload) : null;
    if (bytes) entries.push([storageKey(payload.mode, "sqlite"), bytes]);
    const indexedOK = await idb.setMany(entries);
    if (Store.mode === payload.mode && Store.revision === payload.revision && !Store.blocked) {
      setStorageStatus(localOK && indexedOK ? "" : localOK || indexedOK ? "\u4EC5\u4E00\u4EFD\u672C\u673A\u526F\u672C\u4FDD\u5B58\u6210\u529F\uFF0C\u8BF7\u5BFC\u51FA\u5907\u4EFD\u5E76\u91CD\u8BD5\u3002" : "\u4FDD\u5B58\u5931\u8D25\uFF1A\u6539\u52A8\u4EC5\u5728\u5F53\u524D\u9875\u9762\uFF0C\u8BF7\u52FF\u5173\u95ED\uFF0C\u5148\u5BFC\u51FA JSON \u5907\u4EFD\u518D\u91CD\u8BD5\u3002");
    }
    return localOK || indexedOK;
  };
  Store.queue = Store.queue.then(write, write);
  return Store.queue;
}
function save() {
  if (Store.blocked) return Promise.resolve(false);
  setStorageStatus("\u6B63\u5728\u4FDD\u5B58\u2026");
  const payload = snapshot();
  if (Store.backup) payload.previous = Store.backup;
  return persistSnapshot(payload);
}
function persistFull() {
  return save();
}
async function readSnapshot(mode, suffix = "json") {
  if (isNative) return nativeReadSnapshot(mode, suffix);
  const key = storageKey(mode, suffix), local = localRead(key), indexed = await idb.get(key);
  const candidates = [];
  let invalid = false;
  const sources = [local, indexed];
  if (suffix === "backup") {
    const primary = localRead(storageKey(mode));
    if (primary.value?.previous) sources.push({ ok: true, value: primary.value.previous });
  }
  for (const source of sources) {
    if (source.value === null) continue;
    try {
      const data = validateState(source.value);
      const revision = source.value.revision;
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("\u65E0\u6548\u4FEE\u8BA2\u53F7");
      candidates.push({ ...data, v: 3, mode, revision, savedAt: source.value.savedAt, previous: source.value.previous ?? null });
    } catch (error) {
      invalid = true;
    }
  }
  candidates.sort((a, b) => b.revision - a.revision);
  return { value: candidates[0] || null, uncertain: invalid || !local.ok || !indexed.ok };
}
async function rememberMode(mode) {
  if (Store.blocked) return false;
  const value = { mode, revision: Date.now() }, localOK = localWrite("tanji_v3_mode", value);
  const indexedOK = await idb.setMany([["tanji_v3_mode", value]]);
  return localOK || indexedOK;
}
async function loadState() {
  Store.ready = false;
  Store.blocked = Store.lockedOut;
  Store.backup = null;
  const [work, demo, indexedMode] = await Promise.all([readSnapshot("work"), readSnapshot("demo"), idb.get("tanji_v3_mode")]);
  const localMode = localRead("tanji_v3_mode");
  const selected = [localMode.value, indexedMode.value].filter((v) => v && ["work", "demo"].includes(v.mode)).sort((a, b) => b.revision - a.revision)[0];
  let mode = selected?.mode || (work.value || work.uncertain ? "work" : "demo"), state = mode === "work" ? work : demo;
  Store.mode = mode;
  if (!state.value && mode === "work" && state.uncertain) return blockLoad();
  if (!work.value && !demo.value) {
    const legacyLocal = localRead("tanji_v2"), legacyOld = localRead("tanstore_v1"), legacyIndexed = await idb.get("json");
    const sources = [legacyLocal, legacyOld, legacyIndexed];
    for (const source of sources) {
      if (source.value === null) continue;
      try {
        db = validateState({ ...source.value, payments: source.value.payments ?? [] });
        Store.mode = "work";
        Store.ready = true;
        const saved = await save();
        if (saved) await rememberMode("work");
        return saved;
      } catch (error) {
        source.ok = false;
      }
    }
    if (sources.some((s) => !s.ok || s.value !== null) || work.uncertain || demo.uncertain) return blockLoad();
  }
  Store.mode = mode;
  if (state.value) {
    db = validateState(state.value);
    Store.revision = Math.max(Store.revision, state.value.revision);
    Store.backup = state.value.previous;
  } else if (state.uncertain) return blockLoad();
  else db = mode === "work" ? { orders: [], payments: [], threshold: 15 } : demoSeed();
  Store.ready = true;
  Store.blocked = Store.blocked || state.uncertain;
  setStorageStatus(state.uncertain ? "\u90E8\u5206\u672C\u673A\u526F\u672C\u4E0D\u53EF\u8BFB\uFF0C\u5F53\u524D\u4EC5\u4F9B\u67E5\u770B\uFF1B\u5DF2\u6682\u505C\u5199\u5165\uFF0C\u8BF7\u5148\u5BFC\u51FA\u5907\u4EFD\u5E76\u91CD\u8BD5\u8BFB\u53D6\u3002" : "");
  return !!state.value;
}
function blockLoad() {
  Store.blocked = true;
  Store.ready = true;
  db = { orders: [], payments: [], threshold: 15 };
  setStorageStatus("\u672C\u673A\u6570\u636E\u8BFB\u53D6\u5931\u8D25\uFF0C\u5DF2\u6682\u505C\u5199\u5165\u4EE5\u4FDD\u62A4\u539F\u6570\u636E\u3002\u8BF7\u91CD\u8BD5\uFF0C\u6216\u5148\u5BFC\u51FA\u66FF\u6362\u524D\u5907\u4EFD\u7559\u5B58\u3002");
  return false;
}
async function switchMode(mode) {
  if (Store.busy || Store.blocked || mode === Store.mode) return;
  Store.busy = true;
  try {
    if (!await save()) return;
    const target = await readSnapshot(mode);
    if (target.uncertain) {
      setStorageStatus("\u76EE\u6807\u6570\u636E\u8BFB\u53D6\u5931\u8D25\uFF0C\u672A\u5207\u6362\u6216\u8986\u76D6\u6570\u636E\u3002");
      return;
    }
    if (!await rememberMode(mode)) {
      setStorageStatus("\u65E0\u6CD5\u4FDD\u5B58\u5207\u6362\u72B6\u6001\uFF0C\u8BF7\u5BFC\u51FA\u5907\u4EFD\u540E\u91CD\u8BD5\u3002");
      return;
    }
    Store.mode = mode;
    db = target.value ? validateState(target.value) : mode === "work" ? { orders: [], payments: [], threshold: 15 } : demoSeed();
    Store.revision = Math.max(Store.revision, target.value?.revision || 0);
    Store.backup = target.value?.previous || null;
    afterLoad && afterLoad.closeSheets();
    afterLoad && afterLoad.resetFilters();
    await save();
    afterLoad && (afterLoad.renderAll(), afterLoad.showTab("home"));
    afterLoad && (afterLoad.notify.syncDaily(), afterLoad.notify.syncDeliver());
    afterLoad && afterLoad.toast(mode === "work" ? "\u5DF2\u5207\u6362\u5230\u5DE5\u4F5C\u6570\u636E" : "\u5DF2\u5207\u6362\u5230\u72EC\u7ACB\u6F14\u793A\u6570\u636E\uFF0C\u5DE5\u4F5C\u6570\u636E\u672A\u6539\u52A8");
  } finally {
    Store.busy = false;
  }
}
async function replaceData(state) {
  if (Store.busy || Store.blocked) return false;
  const validated = validateState(state);
  if (!state || state.notifyEnabled === void 0) validated.notifyEnabled = db.notifyEnabled !== false;
  Store.busy = true;
  try {
    await Store.queue;
    const before = snapshot(), next = snapshot(validated);
    next.previous = before;
    if (!await persistSnapshot(next)) {
      if (isNative) localWrite(storageKey(Store.mode), before);
      setStorageStatus("\u66FF\u6362\u5931\u8D25\uFF1A\u6570\u636E\u672A\u88AB\u6539\u52A8\u3002\u8BF7\u91CD\u8BD5\uFF1B\u6301\u7EED\u5931\u8D25\u8BF7\u5148\u5BFC\u51FA JSON \u5907\u4EFD\u3002");
      return false;
    }
    Store.backup = before;
    db = validated;
    afterLoad && afterLoad.closeSheets();
    afterLoad && afterLoad.resetFilters();
    afterLoad && afterLoad.renderAll();
    if (afterLoad) {
      await afterLoad.notify.cancelMode();
      afterLoad.notify.syncDaily();
      afterLoad.notify.syncDeliver();
    }
    const stamp = TanJiLogic.nowStr();
    for (const o of validated.orders || []) {
      if (!o.remindAt) continue;
      if (o.settleVia === "douyin" || TanJiLogic.unFin(o, validated.payments) <= 0) {
        o.remindAt = null;
        continue;
      }
      if (o.remindAt > stamp) afterLoad && afterLoad.notify.scheduleSnooze(o);
    }
    return true;
  } finally {
    Store.busy = false;
  }
}
function backupDocument(state = db) {
  return { app: "\u63A2\u8BB0 TanJi", version: "0.6", exportedAt: (/* @__PURE__ */ new Date()).toISOString(), threshold: state.threshold, notifyEnabled: state.notifyEnabled !== false, accounts: cloneState(state.accounts || []), providers: cloneState(state.providers || []), orders: cloneState(state.orders), payments: cloneState(state.payments) };
}
function accountCopyText(account) {
  const lines = [];
  if (account.name) lines.push(`\u6635\u79F0:${account.name}`);
  if (account.douyin) lines.push(`\u6296\u97F3:${account.douyin}`);
  if (account.phone) lines.push(`\u624B\u673A:${account.phone}`);
  return lines.join("\n");
}
var NATIVE_DB = "tanji";
var ORD_COLS = ["id", "store", "category", "contact", "price", "deposit", "appt_at", "shot_at", "submitted_at", "short_sent_at", "long_sent_at", "deposit_paid_at", "final_paid_at", "settle_via", "remind_at", "channel", "partner", "location", "gps_place", "deliver_main", "deliver_sub", "review_result", "published_at", "account_id", "note", "remind_log", "expect_pay_at", "created_at", "updated_at"];
async function nativeOpen() {
  if (Store.conn) return Store.conn;
  const sqlite = new CAP.SQLiteConnection(CAP.CapacitorSQLite);
  const conn = await sqlite.createConnection(NATIVE_DB, false, "no-encryption", 1, false);
  await conn.open();
  await conn.executeSet([
    { statement: `CREATE TABLE IF NOT EXISTS orders(
  mode TEXT NOT NULL,
  id INTEGER NOT NULL, store TEXT NOT NULL, category TEXT, contact TEXT,
  price REAL NOT NULL, deposit REAL DEFAULT 0,
  appt_at TEXT, shot_at TEXT, submitted_at TEXT, short_sent_at TEXT, long_sent_at TEXT,
  deposit_paid_at TEXT, final_paid_at TEXT, settle_via TEXT DEFAULT 'private', remind_at TEXT,
  channel TEXT, partner TEXT,
  location TEXT, gps_place TEXT, deliver_main INTEGER DEFAULT 1, deliver_sub INTEGER DEFAULT 1,
  review_result TEXT DEFAULT '', published_at TEXT,
  account_id INTEGER,
  note TEXT, remind_log TEXT, expect_pay_at TEXT, created_at TEXT, updated_at TEXT,
  PRIMARY KEY(mode,id))`, values: [] },
    { statement: `CREATE TABLE IF NOT EXISTS payments(
  mode TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER, kind TEXT, amount REAL, paid_at TEXT, method TEXT, note TEXT)`, values: [] },
    { statement: `CREATE TABLE IF NOT EXISTS accounts(
  mode TEXT NOT NULL,
  id INTEGER NOT NULL, name TEXT NOT NULL, phone TEXT, douyin TEXT,
  color INTEGER DEFAULT 0, avatar TEXT, created_at TEXT,
  PRIMARY KEY(mode,id))`, values: [] },
    { statement: `CREATE TABLE IF NOT EXISTS settings(scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(scope,key))`, values: [] }
  ], true);
  for (const stmt of [
    "ALTER TABLE orders ADD COLUMN location TEXT",
    "ALTER TABLE orders ADD COLUMN gps_place TEXT",
    "ALTER TABLE orders ADD COLUMN deliver_main INTEGER DEFAULT 1",
    // 缺省必须是 1:v0.4 前的旧单语义是正副片都要(DEFAULT 0 会把老单的副片要求静默关掉)
    "ALTER TABLE orders ADD COLUMN deliver_sub INTEGER DEFAULT 1",
    `ALTER TABLE orders ADD COLUMN review_result TEXT DEFAULT ''`,
    "ALTER TABLE orders ADD COLUMN published_at TEXT",
    "ALTER TABLE orders ADD COLUMN account_id INTEGER",
    "ALTER TABLE orders ADD COLUMN remind_log TEXT",
    "ALTER TABLE orders ADD COLUMN expect_pay_at TEXT"
  ]) {
    try {
      await conn.execute(stmt, false);
    } catch (e) {
    }
  }
  Store.conn = conn;
  return conn;
}
async function nativePersistSnapshot(payload) {
  try {
    const conn = await nativeOpen(), ts = (/* @__PURE__ */ new Date()).toISOString();
    const set = [
      { statement: "DELETE FROM orders WHERE mode=?", values: [payload.mode] },
      { statement: "DELETE FROM payments WHERE mode=?", values: [payload.mode] }
    ];
    payload.orders.forEach((o) => set.push({ statement: `INSERT INTO orders (mode,${ORD_COLS.join(",")}) VALUES (?,${ORD_COLS.map(() => "?").join(",")})`, values: [payload.mode, o.id, o.store, o.cat || null, o.contact || null, o.price, o.deposit || 0, o.appt || null, o.shotAt || null, o.submittedAt || null, o.shortAt || null, o.longAt || null, o.depositPaidAt || null, o.finalPaidAt || null, o.settleVia || "private", o.remindAt || null, o.channel || "\u76F4\u5BA2", o.partner || null, o.location || null, o.gpsPlace || null, o.deliverMain === false ? 0 : 1, o.deliverSub === false ? 0 : 1, o.reviewResult || "", o.publishedAt || null, o.accountId || null, o.note || null, o.remindLog && o.remindLog.length ? JSON.stringify(o.remindLog) : null, o.expectPayAt || null, ts, ts] }));
    set.push({ statement: "DELETE FROM accounts WHERE mode=?", values: [payload.mode] });
    (payload.accounts || []).forEach((a) => set.push({ statement: "INSERT INTO accounts (mode,id,name,phone,douyin,color,avatar,created_at) VALUES (?,?,?,?,?,?,?,?)", values: [payload.mode, a.id, a.name, a.phone || null, a.douyin || null, a.color ?? 0, a.avatar || null, a.createdAt || ts] }));
    payload.payments.forEach((p) => set.push({ statement: "INSERT INTO payments (mode,order_id,kind,amount,paid_at,method,note) VALUES (?,?,?,?,?,?,?)", values: [payload.mode, p.oid, p.kind, p.amount, p.at, p.method || null, p.note || null] }));
    const doc = { ...cloneState(payload), savedAt: ts };
    set.push({ statement: "INSERT OR REPLACE INTO settings (scope,key,value) VALUES (?,?,?)", values: [payload.mode, "json", JSON.stringify(doc)] });
    if (payload.previous) set.push({ statement: "INSERT OR REPLACE INTO settings (scope,key,value) VALUES (?,?,?)", values: [payload.mode, "backup", JSON.stringify(payload.previous)] });
    await conn.executeSet(set, true);
    return true;
  } catch (e) {
    console.error("[TanJi] SQLite \u5199\u5165\u5931\u8D25", e);
    return false;
  }
}
async function nativeReadSnapshot(mode, suffix = "json") {
  try {
    const conn = await nativeOpen();
    if (suffix === "backup") {
      const r2 = await conn.query("SELECT value FROM settings WHERE scope=? AND key=?", [mode, "backup"]);
      const raw2 = (r2.values || [])[0];
      return { value: raw2 ? JSON.parse(raw2.value) : null, uncertain: false };
    }
    const sources = [];
    const r = await conn.query("SELECT value FROM settings WHERE scope=? AND key=?", [mode, "json"]);
    const raw = (r.values || [])[0];
    if (raw) sources.push(raw.value);
    const mirror = localRead(storageKey(mode));
    if (mirror.ok && mirror.value !== null) sources.push(mirror.value);
    const candidates = [];
    for (const source of sources) {
      try {
        const parsed = typeof source === "string" ? JSON.parse(source) : source;
        const data = validateState(parsed);
        const revision = parsed.revision;
        if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("\u65E0\u6548\u4FEE\u8BA2\u53F7");
        candidates.push({ ...data, v: 3, mode, revision, savedAt: parsed.savedAt || null, previous: parsed.previous || null });
      } catch (error) {
        console.warn("[TanJi] \u526F\u672C\u5185\u5BB9\u65E0\u6548,\u5DF2\u8DF3\u8FC7", error);
      }
    }
    if (!candidates.length) return { value: null, uncertain: sources.length > 0 };
    candidates.sort((a, b) => b.revision - a.revision);
    return { value: candidates[0], uncertain: false };
  } catch (e) {
    console.error("[TanJi] SQLite \u8BFB\u53D6\u5931\u8D25", e);
    try {
      const mirror = localRead(storageKey(mode));
      if (mirror.ok && mirror.value) {
        const parsed = mirror.value;
        const data = validateState(parsed);
        return { value: { ...data, v: 3, mode, revision: parsed.revision || 0, savedAt: parsed.savedAt || null, previous: parsed.previous || null }, uncertain: true };
      }
    } catch (e2) {
    }
    return { value: null, uncertain: true };
  }
}

// src/app/ui.js
var ui = { tab: "home", chip: "all", bucket: "all", period: "7", selDay: TODAY, q: "", detail: null, payCtx: null, privacy: false, shareUrl: null, shareBlob: null, vMon: { y: now.getFullYear(), m: now.getMonth() + 1 }, accFilter: null, editAccountId: null, draftAvatar: null, draftColor: 0, draftProv: "", draftAccId: null, draftAccIds: [], assignAcc: null, remindOid: null, expectOid: null };
var lastDailySyncDay = "";
var dailySyncFn = null;
function registerDailySync(fn) {
  dailySyncFn = fn;
}
function syncDailyOnNewDay() {
  if (lastDailySyncDay === TODAY) return;
  lastDailySyncDay = TODAY;
  if (dailySyncFn) dailySyncFn();
}
function refreshClock() {
  const { changed, previous } = tickClock();
  if (changed && ui.selDay === previous) {
    ui.selDay = TODAY;
    ui.vMon = { y: now.getFullYear(), m: now.getMonth() + 1 };
  }
}
var RENDERERS = {};
function registerRenderers(renderers) {
  Object.assign(RENDERERS, renderers);
}
function showTab(t) {
  refreshClock();
  ui.tab = t;
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("#v-" + t).classList.add("active");
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
}
var badgeCounter = null;
function registerBadgeCounter(fn) {
  badgeCounter = fn;
}
function renderAll() {
  refreshClock();
  setStorageStatus(Store.status);
  RENDERERS.home();
  RENDERERS.trip();
  RENDERERS.orders();
  RENDERERS.pay();
  RENDERERS.stats();
  const n = badgeCounter ? badgeCounter() : 0;
  const b = $("#pay-bdg");
  b.style.display = n ? "flex" : "none";
  b.textContent = n;
}
var detailRerender = null;
function registerDetailRerender(fn) {
  detailRerender = fn;
}
function refreshVisible() {
  if (!Store.ready || Store.busy || document.visibilityState === "hidden") return;
  refreshClock();
  syncDailyOnNewDay();
  if (document.activeElement?.matches("input,textarea,select")) return;
  renderAll();
  if ($("#sheet-detail").classList.contains("show")) detailRerender();
}
function markDailySynced(day = TODAY) {
  lastDailySyncDay = day;
}

// src/app/derived.js
function workOf(o) {
  return TanJiLogic.workOf(o);
}
function moneyCents(value, blankZero) {
  return TanJiLogic.moneyCents(value, blankZero);
}
function orderMoney(o) {
  return TanJiLogic.orderMoney(o);
}
function paymentSpec(kind) {
  return TanJiLogic.paymentSpec(kind);
}
function hasReceipt(o, kind) {
  return TanJiLogic.hasReceipt(o, kind, db.payments);
}
function hasAnyReceipt(o) {
  return TanJiLogic.hasAnyReceipt(o, db.payments);
}
function unDep(o) {
  return TanJiLogic.unDep(o, db.payments);
}
function unFin(o) {
  return TanJiLogic.unFin(o, db.payments);
}
function owedOf(o) {
  return TanJiLogic.owedOf(o, db.payments);
}
function payOf(o) {
  return TanJiLogic.payOf(o, db.payments);
}
function overdueDays(o) {
  return TanJiLogic.overdueDays(o, db.payments, now);
}
function snoozed(o) {
  return TanJiLogic.snoozed(o, nowStr());
}
function isOver(o) {
  return TanJiLogic.isOver(o, db.payments, db.threshold, now);
}
function remindLogOf(o) {
  return TanJiLogic.remindLogOf(o);
}
function lastRemind(o) {
  return TanJiLogic.lastRemind(o);
}
function expectOverdue(o) {
  return TanJiLogic.expectOverdue(o, db.payments, now);
}
var accMatch = (o) => ui.accFilter == null || o.accountId === ui.accFilter;
var accOrderIds = () => new Set(db.orders.filter(accMatch).map((o) => o.id));
function upcoming7() {
  return TanJiLogic.upcomingByDay(db.orders.filter(accMatch), TODAY, 7);
}
var WORK_CLS = { "\u5F85\u62CD\u6444": "c-blue", "\u540E\u671F\u4E2D": "c-purple", "\u53D1\u7247\u4E2D": "c-orange", "\u5DF2\u4EA4\u4ED8": "c-green" };
var PAY_CLS = { "\u5F85\u5B9A\u91D1": "c-gray", "\u5F85\u5C3E\u6B3E": "c-orange", "\u5E73\u53F0\u7ED3\u7B97": "c-blue", "\u5DF2\u903E\u671F": "c-red", "\u5DF2\u7ED3\u6E05": "c-green" };
var METHODS = ["\u5FAE\u4FE1", "\u652F\u4ED8\u5B9D", "\u94F6\u884C\u5361", "\u6296\u97F3\u5546\u5355", "\u5176\u4ED6"];
var METHOD_CLS = { "\u5FAE\u4FE1": "c-green", "\u652F\u4ED8\u5B9D": "c-blue", "\u94F6\u884C\u5361": "c-orange", "\u6296\u97F3\u5546\u5355": "c-ink", "\u5176\u4ED6": "c-gray" };
function payChip(o) {
  const s = payOf(o);
  const label = isOver(o) ? "\u5DF2\u903E\u671F" : s;
  return `<span class="chip ${PAY_CLS[label]}">${label}</span>`;
}
function workChip(o) {
  return `<span class="chip ${WORK_CLS[workOf(o)]}">${workOf(o)}</span>`;
}
function deliverLate(o) {
  return TanJiLogic.deliverLate(o, Date.now());
}
var REVIEW_LABEL = { pass: "\u9001\u5BA1\u5408\u683C", fail: "\u9001\u5BA1\u4E0D\u5408\u683C" };
var byId = (id) => db.orders.find((o) => o.id === id);
var gpsText = (o) => o && o.gpsPlace && typeof TanJiGeo !== "undefined" ? TanJiGeo.label(o.gpsPlace) : "";
var storeOf = (id) => {
  const o = byId(id);
  return o ? o.store : "";
};
var needMain = (o) => TanJiLogic.needMain(o);
var needSub = (o) => TanJiLogic.needSub(o);
var deliveredAll = (o) => TanJiLogic.deliveredAll(o);

// src/app/sheets.js
function showSheet(id) {
  $("#mask").classList.add("show");
  document.querySelectorAll(".sheet").forEach((s) => s.classList.remove("show"));
  const target = $("#" + id);
  target.style.pointerEvents = "";
  target.classList.add("show");
}
function closeSheets() {
  $("#mask").classList.remove("show");
  document.querySelectorAll(".sheet").forEach((s) => {
    s.classList.remove("show");
    s.style.transition = "";
    s.style.transform = "";
    s.style.pointerEvents = "none";
  });
  ui.detail = null;
  ui.payCtx = null;
  ui.editId = null;
  ui.remindOid = null;
  ui.expectOid = null;
  Store.pending = null;
}
function initSheetGestures() {
  const FORM_SHEETS = "#sheet-new,#sheet-edit,#sheet-account,#sheet-import,#sheet-remind,#sheet-expect";
  document.querySelectorAll(".sheet").forEach((sheet) => {
    const body = sheet.querySelector(".sheet-body");
    const bodyDragAllowed = !sheet.matches(FORM_SHEETS);
    let startY = 0, startX = 0, dy = 0, armed = false, pulling = false;
    sheet.addEventListener("touchstart", (event) => {
      if (event.touches.length !== 1) return;
      const t = event.touches[0];
      startY = t.clientY;
      startX = t.clientX;
      dy = 0;
      pulling = false;
      if (event.target.closest("input,textarea,select")) {
        armed = false;
        return;
      }
      armed = !body || !body.contains(event.target) || bodyDragAllowed && body.scrollTop <= 0;
    }, { passive: true });
    sheet.addEventListener("touchmove", (event) => {
      if (!armed) return;
      const t = event.touches[0];
      const down = t.clientY - startY, across = t.clientX - startX;
      if (!pulling) {
        if (Math.abs(across) > Math.abs(down) + 4) {
          armed = false;
          return;
        }
        if (down <= 0) {
          armed = false;
          return;
        }
        if (body && body.scrollTop > 0) {
          armed = false;
          return;
        }
        pulling = true;
      }
      event.preventDefault();
      dy = down;
      sheet.style.transition = "none";
      sheet.style.transform = `translateY(${Math.max(dy, 0)}px)`;
    }, { passive: false });
    const finish = () => {
      if (!pulling) {
        armed = false;
        return;
      }
      const moved = dy;
      pulling = false;
      armed = false;
      sheet.style.transition = "";
      sheet.style.transform = "";
      if (moved > 110) closeSheets();
      dy = 0;
    };
    sheet.addEventListener("touchend", finish, { passive: true });
    sheet.addEventListener("touchcancel", finish, { passive: true });
  });
}
var toastTimer;
var toastAction = null;
function toast(m, action) {
  const el = $("#toast");
  if (!el) return;
  clearTimeout(toastTimer);
  toastAction = action || null;
  if (action) el.innerHTML = `<span>${esc(m)}</span><button class="toast-act" data-act="toast-undo">${esc(action.label || "\u64A4\u9500")}</button>`;
  else el.textContent = m;
  el.classList.add("show");
  el.classList.toggle("act", !!action);
  toastTimer = setTimeout(() => el.classList.remove("show", "act"), action ? 5e3 : 1900);
}
function dismissToast() {
  const action = toastAction;
  toastAction = null;
  $("#toast").classList.remove("show", "act");
  clearTimeout(toastTimer);
  return action;
}

// src/app/notify.js
var NOTIFY_OFFSET = { work: 0, demo: 5e5 };
var notifyBase = () => NOTIFY_OFFSET[Store.mode] || 0;
var Notify = {
  native() {
    return isNative && CAP && CAP.LocalNotifications;
  },
  async ensurePermission() {
    const L = CAP.LocalNotifications;
    let p = await L.checkPermissions();
    if (p.display !== "granted") p = await L.requestPermissions();
    return p.display === "granted";
  },
  async syncDaily() {
    if (!this.native()) return;
    if (Store.mode === "demo") return;
    try {
      const L = CAP.LocalNotifications;
      const base = notifyBase();
      const pend = await L.getPending();
      const oldDaily = (pend.notifications || []).filter((n) => +n.id === base + 1);
      if (oldDaily.length) await L.cancel({ notifications: oldDaily });
      const over = db.orders.filter((o) => isOver(o) && !snoozed(o));
      if (!over.length || db.notifyEnabled === false) return;
      if (!await this.ensurePermission()) return;
      const maxD = Math.max(...over.map(overdueDays));
      await L.schedule({ notifications: [{
        id: base + 1,
        title: "\u63A2\u8BB0 \xB7 \u5C3E\u6B3E\u50AC\u6536",
        body: `${over.length} \u7B14\u5C3E\u6B3E\u5DF2\u903E\u671F\uFF0C\u6700\u957F ${maxD} \u5929 \u2014\u2014 \u4ECA\u65E5\u5B89\u6392\u4E00\u6B21\u8DDF\u8FDB`,
        schedule: { on: { hour: 9, minute: 0 }, repeats: true, allowWhileIdle: true }
      }] });
    } catch (e) {
      console.warn("[TanJi] \u50AC\u6536\u63D0\u9192\u6392\u7A0B\u5931\u8D25", e);
    }
  },
  // 出片提醒:拍摄完成 +24h 仍未出齐(按该单的正/副片配置) → 一次性本地通知。
  // 已超期的不再排(应用内列表有红色角标),出齐/删单/清除拍摄时间后重排即撤销。
  async syncDeliver() {
    if (!this.native()) return;
    if (Store.mode === "demo") return;
    try {
      const L = CAP.LocalNotifications;
      const base = notifyBase();
      const pend = await L.getPending();
      const mine = (pend.notifications || []).filter((n) => +n.id >= base + 3e5 && +n.id < base + 4e5);
      if (mine.length) await L.cancel({ notifications: mine });
      const now2 = Date.now();
      const list = db.orders.filter((o) => o.shotAt && !deliveredAll(o)).map((o) => ({ o, at: new Date(new Date(o.shotAt).getTime() + 864e5) })).filter((x) => !isNaN(x.at.getTime()) && x.at.getTime() > now2);
      if (!list.length) return;
      if (!await this.ensurePermission()) return;
      await L.schedule({ notifications: list.map(({ o, at }) => ({
        id: base + 3e5 + o.id,
        title: "\u63A2\u8BB0 \xB7 \u51FA\u7247\u63D0\u9192",
        body: `\u300C${o.store}\u300D\u62CD\u6444\u5DF2\u8D85 24 \u5C0F\u65F6,\u8FD8\u6709\u7247\u5B50\u6CA1\u51FA\u9F50,\u8BB0\u5F97\u8DDF\u8FDB`,
        schedule: { at, allowWhileIdle: true }
      })) });
    } catch (e) {
      console.warn("[TanJi] \u51FA\u7247\u63D0\u9192\u6392\u7A0B\u5931\u8D25", e);
    }
  },
  async scheduleSnooze(o, d) {
    if (!this.native()) return;
    if (Store.mode === "demo") return;
    try {
      const at = new Date(o.remindAt);
      if (isNaN(at)) return;
      if (!await this.ensurePermission()) return;
      const L = CAP.LocalNotifications;
      const base = notifyBase();
      const pend = await L.getPending();
      const mine = (pend.notifications || []).filter((n) => +n.id === base + 1e5 + o.id);
      if (mine.length) await L.cancel({ notifications: mine });
      const when = d != null ? `\uFF08${d} \u5929\u524D\u8BBE\u7F6E\u7684\u63D0\u9192\uFF09` : `\uFF08${String(o.remindAt || "").slice(5, 10)} \u8BBE\u7684\u63D0\u9192\uFF09`;
      await L.schedule({ notifications: [{
        id: base + 1e5 + o.id,
        title: "\u63A2\u8BB0 \xB7 \u50AC\u6536\u8DDF\u8FDB",
        body: `\u300C${o.store}\u300D\u5C3E\u6B3E\u8BE5\u8DDF\u8FDB\u4E86${when}`,
        schedule: { at, allowWhileIdle: true }
      }] });
    } catch (e) {
      console.warn("[TanJi] \u5355\u6B21\u63D0\u9192\u6392\u7A0B\u5931\u8D25", e);
    }
  },
  // (cancelAll/isOurNotifyId 已删:replaceData 改用 cancelMode 后无调用方,
  //  而"撤双模式全部通知"的语义一旦被误接回单模式动作,会重演通知误杀)
  // 只撤当前模式的全部通知(导入/恢复/清空只替换当前模式数据,另一模式的通知指向的数据还在,不能动)
  async cancelMode(mode = Store.mode) {
    if (!this.native()) return;
    try {
      const base = NOTIFY_OFFSET[mode] || 0;
      const L = CAP.LocalNotifications, pend = await L.getPending();
      const ours = (pend.notifications || []).filter((n) => {
        const id = +n.id;
        return id === base + 1 || id >= base + 1e5 && id < base + 4e5;
      });
      if (ours.length) await L.cancel({ notifications: ours });
    } catch (e) {
    }
  },
  // 只撤单笔备忘:清除催收提醒不能连带撤掉同单的 24h 出片提醒(两条通知语义独立)
  async cancelSnooze(id) {
    if (!this.native()) return;
    try {
      const base = notifyBase();
      const L = CAP.LocalNotifications, pend = await L.getPending();
      const mine = (pend.notifications || []).filter((n) => +n.id === base + 1e5 + +id);
      if (mine.length) await L.cancel({ notifications: mine });
    } catch (e) {
    }
  },
  async cancelOrder(id) {
    if (!this.native()) return;
    try {
      const base = notifyBase();
      const L = CAP.LocalNotifications, pend = await L.getPending();
      const mine = (pend.notifications || []).filter((n) => +n.id === base + 1e5 + +id || +n.id === base + 3e5 + +id);
      if (mine.length) await L.cancel({ notifications: mine });
    } catch (e) {
    }
  },
  async toggle() {
    db.notifyEnabled = db.notifyEnabled === false;
    save();
    renderAll();
    if (db.notifyEnabled !== false) await this.syncDaily();
    else {
      try {
        const L = CAP.LocalNotifications, pend = await L.getPending();
        const daily = (pend.notifications || []).filter((n) => +n.id === notifyBase() + 1);
        if (daily.length) await L.cancel({ notifications: daily });
      } catch (e) {
      }
    }
    toast(db.notifyEnabled !== false ? "\u5DF2\u5F00\u542F\u6BCF\u65E5\u50AC\u6536\u63D0\u9192\uFF08\u6BCF\u5929 09:00\uFF09" : "\u5DF2\u5173\u95ED\u6BCF\u65E5\u50AC\u6536\u63D0\u9192");
  }
};

// src/app/sqlite-bytes.js
function buildSqliteBytes(state = db) {
  if (!Store.sqlite3) return null;
  try {
    const s = Store.sqlite3;
    const d = new s.oo1.DB(":memory:", "ct");
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
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, douyin TEXT,
      color INTEGER DEFAULT 0, avatar TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);`);
    const so = d.prepare("INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    state.orders.forEach((o) => {
      so.bind([
        o.id,
        o.store,
        o.cat || null,
        o.contact || null,
        o.price,
        o.deposit,
        o.appt,
        o.shotAt,
        o.submittedAt,
        o.shortAt,
        o.longAt,
        o.depositPaidAt,
        o.finalPaidAt,
        o.settleVia || "private",
        o.remindAt || null,
        o.channel || null,
        o.partner || null,
        o.location || null,
        o.gpsPlace || null,
        o.deliverMain === false ? 0 : 1,
        o.deliverSub === false ? 0 : 1,
        o.reviewResult || "",
        o.publishedAt || null,
        o.accountId || null,
        o.note || null,
        o.remindLog && o.remindLog.length ? JSON.stringify(o.remindLog) : null,
        o.expectPayAt || null,
        nowStr(),
        nowStr()
      ]);
      so.step();
      so.reset();
    });
    so.finalize();
    const sa = d.prepare("INSERT INTO accounts VALUES (?,?,?,?,?,?,?)");
    (state.accounts || []).forEach((a) => {
      sa.bind([a.id, a.name, a.phone || null, a.douyin || null, a.color ?? 0, a.avatar || null, a.createdAt || null]);
      sa.step();
      sa.reset();
    });
    sa.finalize();
    const sp = d.prepare("INSERT INTO payments (order_id,kind,amount,paid_at,method,note) VALUES (?,?,?,?,?,?)");
    state.payments.forEach((p) => {
      sp.bind([p.oid, p.kind, p.amount, p.at, p.method, p.note || null]);
      sp.step();
      sp.reset();
    });
    sp.finalize();
    const ss = d.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)");
    ss.bind(["collect_threshold_days", String(state.threshold)]);
    ss.step();
    ss.reset();
    ss.bind(["app_version", "0.6"]);
    ss.step();
    ss.reset();
    ss.bind(["exported_at", nowStr()]);
    ss.step();
    ss.reset();
    ss.finalize();
    const bytes = s.capi.sqlite3_js_db_export(d.pointer);
    d.close();
    return bytes && bytes.length ? bytes : null;
  } catch (e) {
    console.warn("sqlite build fail", e);
    return null;
  }
}
async function initSqlite() {
  try {
    for (let i = 0; i < 60 && !window.sqlite3InitModule; i++) await new Promise((r) => setTimeout(r, 100));
    if (typeof window.sqlite3InitModule !== "function") return null;
    const s = await window.sqlite3InitModule({ print: () => {
    }, printErr: () => {
    } });
    return s;
  } catch (e) {
    return null;
  }
}

// src/app/accounts.js
var ACC_COLORS = [
  { name: "\u871C\u6A59", bg: "#FFF3EC", ink: "#E85D1F" },
  { name: "\u96FE\u84DD", bg: "#EEF4FF", ink: "#3E7BFA" },
  { name: "\u62B9\u8336", bg: "#EDF7EF", ink: "#339966" },
  { name: "\u9999\u828B", bg: "#F4EEFB", ink: "#8E5CD9" },
  { name: "\u674F\u9EC4", bg: "#FFF6E3", ink: "#C97C10" },
  { name: "\u73AB\u7470", bg: "#FCEFF2", ink: "#CE5478" },
  { name: "\u9EDB\u9752", bg: "#EDF5F6", ink: "#3D8CA0" },
  { name: "\u5375\u77F3\u7070", bg: "#F2F2F6", ink: "#67676F" }
];
var PRESET_PROVIDERS = ["\u8702\u5411", "\u5C0F\u7231", "\u91D1\u57CE", "\u98DF\u7269", "\u76F4\u5BA2"];
var ACCS = () => db.accounts || [];
var accMulti = () => ACCS().length >= 2;
var accById = (id) => ACCS().find((a) => a.id === +id);
var accColor = (a) => ACC_COLORS[(a && a.color != null ? a.color : 0) % 8];
var providerList = () => [.../* @__PURE__ */ new Set([...PRESET_PROVIDERS, ...db.providers || []])];
var accTint = (o) => o && accMulti() && o.accountId != null ? `--acc:${accColor(accById(o.accountId)).ink}` : "";
var accBar = (o) => accTint(o) ? " acc-bar" : "";
var accOrderTag = (o) => accMulti() ? accTagHTML(accById(o.accountId)) : "";
function accAvatarHTML(a, style = "") {
  const c = accColor(a);
  if (a && a.avatar) return `<span class="acc-avatar" style="background:${c.bg};${style}"><img src="${a.avatar}" alt=""></span>`;
  return `<span class="acc-avatar" style="background:${c.bg};color:${c.ink};${style}">${esc(a && a.name ? a.name.slice(0, 1) : "\xB7")}</span>`;
}
function accTagHTML(a) {
  if (!a) return '<span class="acc-tag">\u672A\u6307\u5B9A</span>';
  const c = accColor(a);
  const av = a.avatar ? `<img class="tav" src="${a.avatar}" alt="">` : `<span class="tav" style="background:rgba(255,255,255,.72)">${esc(a.name.slice(0, 1))}</span>`;
  return `<span class="acc-tag" style="color:${c.ink};background:${c.bg}">${av}${esc(a.name)}</span>`;
}
function accChipbarHTML() {
  if (!accMulti()) return "";
  const chip = (label, id) => {
    const on = ui.accFilter === id;
    const a = id != null ? accById(id) : null;
    const c = a ? accColor(a) : null;
    const style = a ? on ? `background:${c.ink};color:#fff;font-weight:700` : `color:${c.ink};background:${c.bg};font-weight:600` : on ? "background:var(--ink);color:#fff" : "";
    return `<span class="chip acc-chip${on ? " on" : ""}" data-act="acc-filter" data-id="${id == null ? "" : id}" style="${style}">${label}</span>`;
  };
  let html = chip("\u5168\u90E8", null);
  for (const a of ACCS()) html += chip(a.name, a.id);
  return `<div class="chipbar">${html}</div>`;
}
function renderAccPick(elId, sel, multiple = false) {
  const el = $("#" + elId);
  if (!el) return;
  if (!accMulti()) {
    el.innerHTML = "";
    return;
  }
  const selected = new Set(multiple ? sel || [] : [sel]);
  const unassigned = multiple ? "" : `<button type="button" class="acc-opt ${selected.has(null) ? "sel" : ""}" data-act="acc-pick" data-id="" aria-pressed="${selected.has(null)}" style="${selected.has(null) ? "border-color:var(--brand);background:var(--brand-soft)" : ""}">
      <span class="acc-dot"></span>${accAvatarHTML(null, "width:30px;height:30px;font-size:14px;border-radius:10px")}
      <span class="acc-name">\u672A\u6307\u5B9A</span><span class="acc-cnt">${db.orders.filter((o) => o.accountId == null).length} \u5355</span></button>`;
  el.innerHTML = `<div style="padding:10px 2px 0"><div style="font-size:14px;font-weight:600">\u8D26\u53F7${multiple ? '\uFF08\u53EF\u591A\u9009\uFF09 <span style="color:var(--red)">*</span>' : ' <span class="rsub" style="font-weight:400">\u53EF\u6539\u6302,\u4E5F\u53EF\u8BBE\u4E3A\u300C\u672A\u6307\u5B9A\u300D</span>'}</div>
    <div class="acc-sel">${unassigned}${ACCS().map((a) => {
    const c = accColor(a);
    const n = db.orders.filter((o) => o.accountId === a.id).length, on = selected.has(a.id);
    return `<button type="button" class="acc-opt ${multiple ? "multi " : ""}${on ? "sel" : ""}" data-act="${multiple ? "acc-toggle" : "acc-pick"}" data-id="${a.id}" aria-pressed="${on}" style="${on ? `border-color:${c.ink};background:${c.bg}` : ""}">
        <span class="acc-dot">${multiple && on ? "\u2713" : ""}</span>${accAvatarHTML(a, "width:30px;height:30px;font-size:14px;border-radius:10px")}
        <span class="acc-name">${esc(a.name)}</span><span class="acc-cnt">${n} \u5355</span></button>`;
  }).join("")}</div>
    <div class="rsub" style="margin:6px 2px 0">${multiple ? "\u6BCF\u4E2A\u9009\u4E2D\u8D26\u53F7\u5404\u751F\u6210\u4E00\u7B14\u72EC\u7ACB\u8BA2\u5355\uFF0C\u540E\u7EED\u5206\u522B\u7EF4\u62A4" : "\u70B9\u6574\u884C\u5373\u9009\u4E2D;\u300C\u672A\u6307\u5B9A\u300D= \u4E0D\u6302\u8D26\u53F7,\u53EF\u5728\u7EDF\u8BA1\u9875\u6279\u91CF\u6539\u6302"}</div></div>`;
}
function renderProvPick(elId, val) {
  const el = $("#" + elId);
  if (!el) return;
  el.innerHTML = `<div style="padding:10px 2px 0"><div style="font-size:14px;font-weight:600">\u670D\u52A1\u5546 <span class="rsub" style="font-weight:400;margin-left:4px">\u9884\u8BBE\u70B9\u9009,\u6216\u76F4\u63A5\u8F93\u5165</span></div>
    <div class="chiprow" style="margin:8px 0 0">${providerList().map((p) => `<span class="chip prov-chip ${val === p ? "on" : "c-gray"}" data-act="prov-pick" data-v="${esc(p)}">${esc(p)}</span>`).join("")}</div>
    <div class="frow" style="border-bottom:none;padding:9px 0 0"><input id="${elId}-input" placeholder="\u8F93\u5165\u81EA\u5B9A\u4E49\u670D\u52A1\u5546\u2026\u4FDD\u5B58\u540E\u81EA\u52A8\u8BB0\u5165\u9884\u8BBE" value="${esc(val && !providerList().includes(val) ? val : "")}" style="text-align:left;font-size:14px"></div></div>`;
  const input = el.querySelector("input");
  input.addEventListener("input", () => {
    ui.draftProv = input.value.trim();
    el.querySelectorAll(".prov-chip").forEach((c) => c.classList.remove("on"));
  });
}
function chanFromDraft() {
  const v = (ui.draftProv || "").trim() || "\u76F4\u5BA2";
  if (!providerList().includes(v)) db.providers = [.../* @__PURE__ */ new Set([...db.providers || [], v])];
  return v;
}
function openAccount(id) {
  ui.editAccountId = id == null ? null : +id;
  const a = id != null ? accById(id) : null;
  ui.draftAvatar = a && a.avatar || null;
  ui.draftColor = a ? a.color : ACCS().length % 8;
  $("#account-title").textContent = a ? "\u7F16\u8F91\u8D26\u53F7" : "\u65B0\u5EFA\u8D26\u53F7";
  $("#a-name").value = a ? a.name : "";
  $("#a-phone").value = a ? a.phone || "" : "";
  $("#a-douyin").value = a ? a.douyin || "" : "";
  $("#a-err").style.display = "none";
  $("#a-delete").style.display = a ? "" : "none";
  renderAvatarPreview();
  renderPal();
  showSheet("sheet-account");
}
function renderAvatarPreview() {
  const c = ACC_COLORS[ui.draftColor % 8];
  $("#a-avatar-preview").innerHTML = ui.draftAvatar ? `<span class="bigav" style="background:${c.bg}"><img src="${ui.draftAvatar}" alt=""></span>` : `<span class="bigav" style="background:${c.bg};color:${c.ink}">${esc($("#a-name").value.trim().slice(0, 1) || "\xB7")}</span>`;
}
function renderPal() {
  const idx = ui.draftColor % 8, cur = ACC_COLORS[idx];
  $("#a-pal").innerHTML = ACC_COLORS.map((c, i) => `<button type="button" class="sw ${i === idx ? "sel" : ""}" data-act="pal-pick" data-i="${i}" aria-label="${c.name}" title="${c.name}" style="background:${c.ink}"></button>`).join("");
  const label = $("#a-pal-name");
  if (label) label.innerHTML = `\u5F53\u524D\u6807\u8BC6\u8272:<b>${cur.name}</b> \xB7 \u5217\u8868\u5E95\u8272\u4E0E\u884C\u5185\u5C0F\u6807\u540C\u6B65\u8DDF\u968F`;
}
function saveAccount() {
  const name = $("#a-name").value.trim();
  const err = $("#a-err");
  if (!name) {
    err.textContent = "\u8BF7\u586B\u5199\u6635\u79F0";
    err.style.display = "block";
    return;
  }
  err.style.display = "none";
  const base = { name, phone: $("#a-phone").value.trim(), douyin: $("#a-douyin").value.trim(), color: ui.draftColor % 8 };
  if (ui.draftAvatar) base.avatar = ui.draftAvatar;
  if (ui.editAccountId != null) {
    const target = accById(ui.editAccountId);
    Object.assign(target, base);
    if (!ui.draftAvatar) delete target.avatar;
    toast("\u5DF2\u4FDD\u5B58\u8D26\u53F7");
  } else {
    const maxId = ACCS().reduce((m, x) => Math.max(m, x.id), 0);
    db.accounts = [...ACCS(), { id: maxId + 1, createdAt: nowStr(), ...base }];
    toast("\u5DF2\u6DFB\u52A0\u8D26\u53F7");
  }
  save();
  closeSheets();
  renderAll();
}
function deleteAccount() {
  const a = accById(ui.editAccountId);
  if (!a) return;
  const n = db.orders.filter((o) => o.accountId === a.id).length;
  if (!confirm(`\u5220\u9664\u300C${a.name}\u300D?\u5176\u540D\u4E0B ${n} \u7B14\u8BA2\u5355\u5C06\u53D8\u4E3A\u300C\u672A\u6307\u5B9A\u300D,\u53EF\u518D\u6539\u6302\u3002`)) return;
  db.accounts = ACCS().filter((x) => x.id !== a.id);
  db.orders.forEach((o) => {
    if (o.accountId === a.id) o.accountId = null;
  });
  if (ui.accFilter === a.id) ui.accFilter = null;
  save();
  closeSheets();
  renderAll();
  toast("\u5DF2\u5220\u9664\u8D26\u53F7");
}
function dayBadge(n, sum) {
  if (sum >= 2500) return { e: "\u{1F48E}", t: "\u738B\u724C\u65E5" };
  if (n >= 5) return { e: "\u{1F525}", t: "\u7206\u5355" };
  if (sum >= 1e3) return { e: "\u{1F4B0}", t: "\u5343\u5143\u65E5" };
  if (n >= 3) return { e: "\u2B50", t: "\u5FD9\u788C\u65E5" };
  return null;
}

// src/app/avatar-crop.js
var MAX_ZOOM = 4;
function coverScale(img, crop) {
  return Math.max(crop.size / img.naturalWidth, crop.size / img.naturalHeight);
}
function clampView(view, img, crop) {
  const min = coverScale(img, crop);
  const scale = Math.min(Math.max(view.scale, min), min * MAX_ZOOM);
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  return {
    scale,
    x: Math.min(Math.max(view.x, crop.x + crop.size - w), crop.x),
    y: Math.min(Math.max(view.y, crop.y + crop.size - h), crop.y)
  };
}
function initialView(img, crop) {
  const scale = coverScale(img, crop);
  return clampView({ scale, x: crop.x + (crop.size - img.naturalWidth * scale) / 2, y: crop.y + (crop.size - img.naturalHeight * scale) / 2 }, img, crop);
}
function zoomAt(view, img, crop, factor, px, py) {
  const scale = view.scale * factor;
  return clampView({ scale, x: px - (px - view.x) * (scale / view.scale), y: py - (py - view.y) * (scale / view.scale) }, img, crop);
}
function sourceRect(view, crop) {
  const sw = crop.size / view.scale;
  return { sx: (crop.x - view.x) / view.scale, sy: (crop.y - view.y) / view.scale, sw, sh: sw };
}
var session = null;
var nextFrame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
var isCover = (s) => Math.abs(s.view.scale - coverScale(s.img, s.crop)) < 1e-6;
function previewBitmap(img) {
  const k = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
  if (k === 1) return null;
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(img.naturalWidth * k));
  cv.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}
function draw() {
  const s = session;
  if (!s) return;
  s.raf = 0;
  const g = $("#crop-canvas").getContext("2d");
  if (!g) return;
  const { box, dpr, crop: c, view: v } = s, src = s.preview || s.img, k = s.preview ? s.preview.width / s.img.naturalWidth : 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#0E0E12";
  g.fillRect(0, 0, box.width, box.height);
  g.drawImage(src, v.x, v.y, s.img.naturalWidth * v.scale * k, s.img.naturalHeight * v.scale * k);
  g.fillStyle = "rgba(14,14,18,.62)";
  g.beginPath();
  g.rect(0, 0, box.width, box.height);
  g.rect(c.x, c.y, c.size, c.size);
  g.fill("evenodd");
  g.strokeStyle = "rgba(255,255,255,.9)";
  g.lineWidth = 1.5;
  g.strokeRect(c.x + 0.75, c.y + 0.75, c.size - 1.5, c.size - 1.5);
  g.strokeStyle = "rgba(255,255,255,.55)";
  g.lineWidth = 1;
  g.beginPath();
  g.arc(c.x + c.size / 2, c.y + c.size / 2, c.size / 2, 0, Math.PI * 2);
  g.stroke();
}
function scheduleDraw() {
  if (session && !session.raf) session.raf = nextFrame(draw);
}
function openCrop(img) {
  if (!img || !(img.naturalWidth > 0 && img.naturalHeight > 0)) throw new Error("\u56FE\u7247\u8BFB\u53D6\u5931\u8D25");
  closeCrop();
  const canvas = $("#crop-canvas");
  $("#avatar-crop").hidden = false;
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(box.width * dpr));
  canvas.height = Math.max(1, Math.round(box.height * dpr));
  const size = Math.max(1, Math.floor(Math.min(box.width - 32, box.height - 32)));
  const crop = { x: (box.width - size) / 2, y: (box.height - size) / 2, size };
  session = { img, crop, box, dpr, preview: previewBitmap(img), pointers: /* @__PURE__ */ new Map(), pan: null, pinch: null, tap: null, raf: 0 };
  session.view = initialView(img, crop);
  draw();
}
function closeCrop() {
  if (!session) return;
  session = null;
  $("#avatar-crop").hidden = true;
}
async function useCrop() {
  const s = session;
  if (!s) return;
  const rect = sourceRect(s.view, s.crop);
  closeCrop();
  try {
    ui.draftAvatar = await TanJiImage.crop(s.img, rect, "avatar");
    renderAvatarPreview();
    toast("\u5934\u50CF\u5DF2\u5C31\u7EEA,\u4FDD\u5B58\u540E\u751F\u6548");
  } catch (e) {
    toast("\u8FD9\u5F20\u56FE\u5904\u7406\u4E0D\u4E86,\u6362\u4E00\u5F20\u8BD5\u8BD5");
  }
}
function bindGestures() {
  const canvas = $("#crop-canvas");
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const points = (s) => [...s.pointers.values()];
  canvas.addEventListener("pointerdown", (e) => {
    const s = session;
    if (!s) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
    }
    const p = pos(e);
    s.pointers.set(e.pointerId, p);
    if (s.pointers.size === 1) {
      s.pinch = null;
      s.pan = { x: s.view.x, y: s.view.y, p };
      const now2 = Date.now();
      if (s.tap && now2 - s.tap.t < 300 && Math.hypot(p.x - s.tap.x, p.y - s.tap.y) < 28) {
        const factor = isCover(s) ? 2.5 : coverScale(s.img, s.crop) / s.view.scale;
        s.view = zoomAt(s.view, s.img, s.crop, factor, s.crop.x + s.crop.size / 2, s.crop.y + s.crop.size / 2);
        s.pan = { x: s.view.x, y: s.view.y, p };
        s.tap = null;
        scheduleDraw();
      } else s.tap = { x: p.x, y: p.y, t: now2 };
    } else if (s.pointers.size === 2) {
      const [a, b] = points(s);
      s.pan = null;
      s.tap = null;
      s.pinch = { scale: s.view.scale, x: s.view.x, y: s.view.y, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const s = session;
    if (!s || !s.pointers.has(e.pointerId)) return;
    const p = pos(e);
    s.pointers.set(e.pointerId, p);
    if (s.pointers.size === 1 && s.pan) s.view = clampView({ ...s.view, x: s.pan.x + p.x - s.pan.p.x, y: s.pan.y + p.y - s.pan.p.y }, s.img, s.crop);
    else if (s.pointers.size === 2 && s.pinch) {
      const [a, b] = points(s), scale = s.pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / s.pinch.dist);
      s.view = clampView({ scale, x: (a.x + b.x) / 2 - (s.pinch.cx - s.pinch.x) * (scale / s.pinch.scale), y: (a.y + b.y) / 2 - (s.pinch.cy - s.pinch.y) * (scale / s.pinch.scale) }, s.img, s.crop);
    } else return;
    scheduleDraw();
  });
  const end = (e) => {
    const s = session;
    if (!s) return;
    s.pointers.delete(e.pointerId);
    if (s.pointers.size === 1) {
      const [p] = points(s);
      s.pinch = null;
      s.pan = { x: s.view.x, y: s.view.y, p };
    } else if (!s.pointers.size) {
      s.pan = null;
      s.pinch = null;
    }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (e) => {
    const s = session;
    if (!s) return;
    e.preventDefault();
    s.view = zoomAt(s.view, s.img, s.crop, Math.exp(-e.deltaY * 15e-4), s.crop.x + s.crop.size / 2, s.crop.y + s.crop.size / 2);
    scheduleDraw();
  }, { passive: false });
}
function initAvatarInput() {
  const input = $("#avatar-file");
  bindGestures();
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    try {
      openCrop(await TanJiImage.load(file));
    } catch (e) {
      closeCrop();
      toast("\u8FD9\u5F20\u56FE\u5904\u7406\u4E0D\u4E86,\u6362\u4E00\u5F20\u8BD5\u8BD5");
    }
  });
}

// src/app/detail.js
var fmtMoney2 = (n) => fmtMoney(n, ui.privacy);
var MILE_LABEL = { shotAt: "\u62CD\u6444", submittedAt: "\u63D0\u5BA1", shortAt: "\u526F\u7247\u53D1\u51FA", longAt: "\u6B63\u7247\u53D1\u51FA", publishedAt: "\u53D1\u5E03" };
var MILE_COLOR = {
  shotAt: { c: "#E8663C", soft: "#FCEFE8" },
  submittedAt: { c: "#3B7DD8", soft: "#EDF3FC" },
  shortAt: { c: "#8B6BC4", soft: "#F3EEFA" },
  longAt: { c: "#2FA05F", soft: "#EAF6EE" },
  publishedAt: { c: "#5C6B7A", soft: "#EDEFF2" }
};
var MILE_BIG = /* @__PURE__ */ new Set(["shortAt", "longAt"]);
function mileStep(oid, key, label, time, done, nowFlag) {
  const tone = MILE_COLOR[key] || { c: "var(--brand)", soft: "var(--brand-soft)" };
  const big = MILE_BIG.has(key) ? "big" : "";
  const target = byId(oid);
  const photo = key === "shotAt" && done && target && target.photoThumb ? `<img src="${target.photoThumb}" alt="">` : done ? "\u2713" : nowFlag ? "\xB7" : "";
  const clickable = done || nowFlag;
  return `<button class="mstep ${big} ${done ? "done" : ""} ${!done && nowFlag ? "now" : ""}" ${clickable ? "" : 'aria-disabled="true"'} data-act="mile" data-oid="${esc(oid)}" data-key="${esc(key)}" style="background:none;border:none;padding:0;${clickable ? "" : "opacity:.45;"}--c:${tone.c};--soft:${tone.soft}">
    <div class="mdotwrap"><div class="mdot">${photo}</div></div>
    <div class="mlab">${esc(label)}</div><div class="mtime">${done ? esc(fmtDT(time)) : nowFlag ? "\u70B9\u51FB\u6807\u8BB0" : ""}</div></button>`;
}
function priceCell(o) {
  const money = fmtMoney2(o.price);
  return o.photoThumb ? `<div class="rprice shot" style="background-image:url('${o.photoThumb}')"><span>${money}</span></div>` : `<div class="rprice">${money}</div>`;
}
function detailActions(o) {
  if (!o.shotAt) return `<button class="btn primary" data-act="mark-shot" data-oid="${esc(o.id)}">\u6807\u8BB0\u5DF2\u62CD\u6444(\u8BB0\u5F55\u5B9E\u9645\u62CD\u6444\u65F6\u95F4)</button>`;
  if (!o.submittedAt) return `<button class="btn primary" data-act="mark-submit" data-oid="${esc(o.id)}">\u6807\u8BB0\u5DF2\u63D0\u5BA1</button>`;
  const btns = [];
  if (needSub(o)) btns.push(`<button class="btn ${o.shortAt ? "ghost" : "tint"}" data-act="mark-short" data-oid="${esc(o.id)}" ${o.shortAt ? "disabled" : ""}>${o.shortAt ? "\u526F\u7247\u5DF2\u53D1" : "\u6807\u8BB0\u53D1\u526F\u7247"}</button>`);
  if (needMain(o)) btns.push(`<button class="btn ${o.longAt ? "ghost" : "tint"}" data-act="mark-long" data-oid="${esc(o.id)}" ${o.longAt ? "disabled" : ""}>${o.longAt ? "\u6B63\u7247\u5DF2\u53D1" : "\u6807\u8BB0\u53D1\u6B63\u7247"}</button>`);
  if (deliveredAll(o) && !o.publishedAt) btns.push(`<button class="btn primary" data-act="mile" data-oid="${esc(o.id)}" data-key="publishedAt">\u6807\u8BB0\u5DF2\u53D1\u5E03</button>`);
  return btns.length ? `<div class="btn2">${btns.join("")}</div>` : "";
}
function nextStep(o) {
  if (!o.shotAt) return null;
  if (!o.submittedAt) return { act: "mark-submit", label: "\u63D0\u5BA1" };
  if (needSub(o) && !o.shortAt) return { act: "mark-short", label: "\u53D1\u526F\u7247" };
  if (needMain(o) && !o.longAt) return { act: "mark-long", label: "\u53D1\u6B63\u7247" };
  if (deliveredAll(o) && !o.publishedAt) return { act: "mile", key: "publishedAt", label: "\u53D1\u5E03" };
  return null;
}
function stepBtn(o, extra = "") {
  const step = nextStep(o);
  if (!step) return "";
  return `<button class="mini-btn" style="${extra}" data-act="${step.act}" data-oid="${esc(o.id)}"${step.key ? ` data-key="${step.key}"` : ""}>${step.label}</button>`;
}
function openDetail(id) {
  const o = byId(id);
  if (!o) {
    ui.detail = null;
    return;
  }
  ui.detail = id;
  ui.payCtx = null;
  ui.editId = null;
  const od = overdueDays(o), money = orderMoney(o);
  const steps = [["shotAt", o.shotAt], ["submittedAt", o.submittedAt], ["shortAt", needSub(o) ? o.shortAt || "" : "skip"], ["longAt", needMain(o) ? o.longAt || "" : "skip"], ["publishedAt", o.publishedAt]];
  const visibleSteps = steps.filter((s) => s[1] !== "skip");
  const nextIdx = visibleSteps.findIndex((s) => !s[1]);
  const mile = visibleSteps.map((s, i) => mileStep(o.id, s[0], MILE_LABEL[s[0]], s[1], !!s[1], i === nextIdx)).join("");
  let lastDone = -1;
  visibleSteps.forEach((s, i) => {
    if (s[1]) lastDone = i;
  });
  const progress = lastDone < 0 ? 0 : (lastDone + 0.5) / visibleSteps.length * 72;
  const received = db.payments.filter((p) => p.oid === o.id).reduce((s, p) => s + (moneyCents(p.amount) || 0), 0) / 100;
  const payBtns = [];
  if (unDep(o) > 0) payBtns.push(`<button class="btn tint-blue" data-act="open-pay" data-oid="${esc(o.id)}" data-kind="deposit">\u6536\u5B9A\u91D1 ${esc(fmtMoney2(unDep(o)))}</button>`);
  if (unFin(o) > 0) payBtns.push(`<button class="btn ${isOver(o) ? "primary" : "pay"}" data-act="open-pay" data-oid="${esc(o.id)}" data-kind="final">\u6536\u5C3E\u6B3E<span class="pmoney">${esc(fmtMoney2(unFin(o)))}</span></button>`);
  if (!payBtns.length) payBtns.push(`<div style="text-align:center;color:#239648;font-weight:800;font-size:14px;padding:6px 0">\u6B3E\u9879\u5DF2\u5168\u90E8\u7ED3\u6E05</div>`);
  let snoozeHtml = "";
  if (payOf(o) === "\u5F85\u5C3E\u6B3E") {
    const log = remindLogOf(o), last = log[log.length - 1], recent = log.slice(-4).reverse();
    snoozeHtml = `<div class="sec-title" style="margin-top:16px">\u50AC\u6536\u8DDF\u8FDB<span class="more" data-act="remind-open" data-oid="${esc(o.id)}">\u518D\u50AC\u4E00\u6B21 \u203A</span></div>
      <div class="card" style="background:#F8F8FA;box-shadow:none;padding:12px 13px">
        <div class="rsub" style="margin:0${recent.length ? " 0 8px" : ""};line-height:1.5">${log.length ? `\u5DF2\u50AC ${log.length >= 50 ? "50+" : log.length} \u6B21 \xB7 \u6700\u8FD1 ${esc(fmtDT(last.at))}` : "\u8FD8\u6CA1\u50AC\u8FC7;\u7B2C\u4E00\u6B21\u8DDF\u8FDB\u4E5F\u8BB0\u4E00\u7B14,\u5BF9\u65B9\u600E\u4E48\u7B54\u4E0B\u6B21\u4E0D\u7528\u91CD\u65B0\u95EE"}</div>
        ${recent.map((entry) => `<div class="rline"><span class="rt">${esc(fmtD(entry.at))} ${esc(fmtHM(entry.at))}</span><span class="rn">${entry.note ? esc(entry.note) : "\u5DF2\u50AC"}</span></div>`).join("")}
        ${log.length > recent.length ? `<div class="rsub" style="margin-top:6px">\u53E6\u6709 ${log.length - recent.length} \u6B21\u66F4\u65E9\u7684\u8DDF\u8FDB</div>` : ""}
      </div>
      <div class="sec-title" style="margin-top:14px">\u50AC\u6536\u5907\u5FD8(\u6253\u5F00 App \u65F6\u67E5\u770B)</div>
      <div class="btn2">
        <button class="btn ghost" data-act="snooze" data-oid="${esc(o.id)}" data-d="1">1\u5929\u540E\u63D0\u9192</button>
        <button class="btn ghost" data-act="snooze" data-oid="${esc(o.id)}" data-d="3">3\u5929\u540E\u63D0\u9192</button>
        <button class="btn ghost" data-act="snooze" data-oid="${esc(o.id)}" data-d="7">7\u5929\u540E\u63D0\u9192</button>
      </div>
      ${snoozed(o) ? `<div class="rsub" style="text-align:center;margin-top:8px">\u5DF2\u8BBE\u63D0\u9192:${esc(fmtD(o.remindAt))} \u518D\u50AC\u6536 <button class="mini-btn" style="background:#F1F1F5;color:#7a7a82" data-act="clear-remind" data-oid="${esc(o.id)}">\u6E05\u9664</button></div>` : ""}`;
  }
  let expectHtml = "";
  const lateDays = expectOverdue(o);
  if (o.settleVia === "douyin") {
    const late = lateDays;
    expectHtml = `<div class="sec-title" style="margin-top:16px">\u5E73\u53F0\u5230\u8D26</div>
      <div class="card" style="background:#F8F8FA;box-shadow:none;padding:12px 13px">
        <div class="rsub" style="margin:0;line-height:1.6">${o.expectPayAt ? `\u9884\u8BA1 ${esc(fmtD(o.expectPayAt))} \u5230\u8D26${late > 0 ? ` \xB7 <b style="color:var(--red)">\u5DF2\u8D85\u671F ${late} \u5929</b>,\u53BB\u5E73\u53F0\u540E\u53F0\u770B\u7ED3\u7B97\u72B6\u6001` : ""}` : '\u8FD8\u6CA1\u586B\u9884\u8BA1\u5230\u8D26\u65E5\u3002\u586B\u4E0A\u4E4B\u540E:\u9996\u9875/\u6536\u6B3E\u9875\u4F1A\u63D0\u793A"\u9884\u8BA1\u54EA\u5929\u5230\u8D26",\u8FC7\u671F\u672A\u5230\u8D26\u6807\u7EA2\u63D0\u9192\u3002'}</div>
      </div>
      <div class="btn2" style="margin-top:8px">
        <button class="btn ghost" data-act="expect-open" data-oid="${esc(o.id)}">${o.expectPayAt ? "\u4FEE\u6539\u9884\u8BA1\u5230\u8D26\u65E5" : "\u8BBE\u7F6E\u9884\u8BA1\u5230\u8D26\u65E5"}</button>
        ${o.expectPayAt ? `<button class="btn ghost" data-act="expect-clear" data-oid="${esc(o.id)}">\u6E05\u9664</button>` : ""}
      </div>`;
  }
  $("#detail-body").innerHTML = `
    <div class="sheet-head" style="padding-left:0;padding-right:0">
      <div style="min-width:0">
        <div class="sheet-title" style="font-size:19px">${esc(o.store)}</div>
        <div class="hsub" style="margin-top:3px">${esc(o.cat)}${o.contact ? " \xB7 " + esc(o.contact) : ""}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="sheet-close" data-act="copy-order" data-oid="${esc(o.id)}" title="\u590D\u5236\u8BA2\u5355" aria-label="\u590D\u5236\u8BA2\u5355"><svg class="ic" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="12" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
        <button class="sheet-close" data-act="edit-order" data-oid="${esc(o.id)}" title="\u7F16\u8F91" style="background:var(--brand-soft);color:var(--brand)"><svg class="ic" viewBox="0 0 24 24"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/></svg></button>
        <button class="sheet-close" data-act="close-sheet"><svg class="ic" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
    </div>
    <div class="chiprow" style="margin:4px 0 2px">${workChip(o)}${payChip(o)}${o.reviewResult ? `<span class="chip ${o.reviewResult === "pass" ? "c-green" : "c-red"}">${REVIEW_LABEL[o.reviewResult]}</span>` : ""}${deliverLate(o) ? `<span class="chip c-red">\u8D8524h\u672A\u51FA\u7247</span>` : ""}${isOver(o) ? `<span class="chip c-red">\u6B20\u6B3E ${esc(od)} \u5929</span>` : ""}${o.settleVia === "douyin" && o.expectPayAt && unFin(o) > 0 ? `<span class="chip ${lateDays > 0 ? "c-red" : "c-blue"}">\u9884\u8BA1 ${esc(fmtD(o.expectPayAt))} \u5230\u8D26${lateDays > 0 ? ` \xB7 \u8D85\u671F ${esc(lateDays)} \u5929` : ""}</span>` : ""}${snoozed(o) ? `<span class="chip c-gray">\u5DF2\u8BBE\u63D0\u9192</span>` : ""}</div>
    ${isOver(o) ? `<div class="banner-red"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/></svg>
      <span>\u5C3E\u6B3E\u81EA\u62CD\u6444\u65E5(${esc(fmtD(o.shotAt))})\u8D77\u5DF2\u6B20 <b>${esc(od)} \u5929</b>,\u8FBE\u5230 ${esc(db.threshold)} \u5929\u50AC\u6536\u9608\u503C,\u5EFA\u8BAE\u7535\u8BDD\u8DDF\u8FDB\u3002${snoozed(o) ? `\u5DF2\u5907\u5FD8:${esc(fmtD(o.remindAt))} \u518D\u63D0\u9192\u3002` : ""}</span></div>` : ""}
    <div class="mile" style="--p:${progress.toFixed(1)}%">${mile}</div>
    <div class="shotline">
      <button class="mini-btn" data-act="shot-pick" data-oid="${esc(o.id)}">\u{1F4F7} ${o.photoThumb ? "\u91CD\u62CD\u95E8\u53E3\u7167" : "\u968F\u624B\u62CD \xB7 \u5230\u5E97\u95E8\u53E3\u6765\u4E00\u5F20"}</button>
      ${o.photoThumb ? `<button class="mini-btn" style="background:#F1F1F5;color:#7a7a82" data-act="shot-clear" data-oid="${esc(o.id)}">\u5220\u9664\u7167\u7247</button>` : ""}
    </div>
    <div style="margin-top:10px">${detailActions(o)}</div>
    ${o.submittedAt ? `<div class="sec-title" style="margin-top:14px">\u9001\u5BA1\u7ED3\u679C</div>
      <div class="btn2">
        <button class="btn ${o.reviewResult === "pass" ? "green" : "ghost"}" data-act="set-review" data-oid="${esc(o.id)}" data-v="pass">${o.reviewResult === "pass" ? "\u2713 \u5408\u683C" : "\u5408\u683C"}</button>
        <button class="btn ${o.reviewResult === "fail" ? "danger-ghost" : "ghost"}" data-act="set-review" data-oid="${esc(o.id)}" data-v="fail">${o.reviewResult === "fail" ? "\u2717 \u4E0D\u5408\u683C" : "\u4E0D\u5408\u683C"}</button>
      </div>` : ""}
    <div class="sec-title" style="margin-top:16px">\u6536\u6B3E</div>
    ${payBtns.join("")}
    ${snoozeHtml}
    ${expectHtml}
    <div class="info-grid">
      <div class="ig"><div class="k">\u9884\u7EA6\u65F6\u95F4</div><div class="v">${esc(fmtD(o.appt))} ${esc(fmtHM(o.appt))}</div></div>
      <div class="ig"><div class="k">\u5B9E\u9645\u62CD\u6444</div><div class="v">${esc(fmtDT(o.shotAt))}</div></div>
      ${accMulti() ? `<div class="ig"><div class="k">\u8D26\u53F7</div><div class="v" style="display:flex;align-items:center;gap:6px">${accTagHTML(accById(o.accountId))}<button class="mini-btn" data-act="copy-account" data-id="${o.accountId ?? ""}">\u62F7\u8D1D</button></div></div>` : ""}
      <div class="ig"><div class="k">\u5730\u70B9</div><div class="v">${esc(o.location || "\u2014")}${o.location ? `<button class="mini-btn" style="padding:4px 9px;font-size:11.5px;margin-left:6px;vertical-align:middle" data-act="nav-place" data-oid="${esc(o.id)}">\u5BFC\u822A</button>` : ""}</div></div>
      <div class="ig"><div class="k">\u5230\u5E97\u5B9A\u4F4D</div><div class="v">${o.gpsPlace ? `${esc(gpsText(o))}<button class="mini-btn" style="padding:4px 9px;font-size:11.5px;margin-left:6px;vertical-align:middle" data-act="nav-place" data-oid="${esc(o.id)}" data-gps="1">\u770B\u4F4D\u7F6E</button>` : `<button class="mini-btn" style="padding:4px 9px;font-size:11.5px" data-act="locate-now" data-oid="${esc(o.id)}">\u8BB0\u5F55\u5F53\u524D\u4F4D\u7F6E</button>`}</div></div>
      <div class="ig"><div class="k">\u53D1\u5E03\u65F6\u95F4</div><div class="v">${esc(fmtDT(o.publishedAt))}</div></div>
      <div class="ig"><div class="k">\u670D\u52A1\u5546</div><div class="v">${esc(o.channel || "\u76F4\u5BA2")}</div></div>
      <div class="ig"><div class="k">\u7EC4\u961F</div><div class="v">${esc(o.partner || (o.note && o.note.includes("\u4E0D\u7EC4\u961F") ? "\u4E0D\u7EC4\u961F" : "\u2014"))}</div></div>
      <div class="ig"><div class="k">\u603B\u4EF7</div><div class="v">${esc(fmtMoney2(o.price))}</div></div>
      <div class="ig"><div class="k">\u5B9A\u91D1 ${o.depositPaidAt ? "\xB7 \u5DF2\u6536 " + esc(fmtD(o.depositPaidAt)) : ""}</div><div class="v">${esc(fmtMoney2(o.deposit))}</div></div>
      <div class="ig"><div class="k">\u5C3E\u6B3E ${o.finalPaidAt ? "\xB7 \u5DF2\u6536 " + esc(fmtD(o.finalPaidAt)) : ""}</div><div class="v">${esc(fmtMoney2(money ? money.final / 100 : 0))}</div></div>
      <div class="ig"><div class="k">\u5DF2\u6536\u5408\u8BA1</div><div class="v" style="color:#239648">${received > 0 ? esc(fmtMoney2(received)) : "\u2014"}</div></div>
      <div class="ig"><div class="k">\u5F53\u524D\u5F85\u6536</div><div class="v" style="${owedOf(o) > 0 ? "color:var(--red)" : "color:#239648"}">${owedOf(o) > 0 ? esc(fmtMoney2(owedOf(o))) : "\u5DF2\u7ED3\u6E05"}</div></div>
      <div class="ig"><div class="k">\u7ED3\u7B97\u65B9\u5F0F</div><div class="v">${o.settleVia === "douyin" ? "\u6296\u97F3\u5546\u5355" : "\u79C1\u6536"}</div></div>
    </div>
    ${o.note ? `<div class="card" style="margin-top:12px;background:#F8F8FA;box-shadow:none"><div class="rsub" style="white-space:normal;line-height:1.6">${esc(o.note)}</div></div>` : ""}
    <div style="padding-top:16px"><button class="btn danger-ghost" data-act="del-order" data-oid="${esc(o.id)}">\u5220\u9664\u8BA2\u5355</button></div>`;
  showSheet("sheet-detail");
}
function rerenderDetail() {
  if (ui.detail != null && ui.editId == null && byId(ui.detail)) {
    const body = $("#detail-body"), top = body ? body.scrollTop : 0;
    openDetail(ui.detail);
    if (body) body.scrollTop = top;
  }
}

// src/app/order-actions.js
var fmtMoney3 = (n) => fmtMoney(n, ui.privacy);
var MILE_PRE = { shotAt: null, submittedAt: "shotAt", shortAt: "submittedAt", longAt: "submittedAt", publishedAt: "submittedAt" };
var MILE_ORDER = ["shotAt", "submittedAt", "shortAt", "longAt", "publishedAt"];
function mark(id, key, label) {
  const o = byId(id);
  if (!o || !Object.prototype.hasOwnProperty.call(MILE_LABEL, key) || o[key]) return false;
  const pre = MILE_PRE[key];
  if (pre && !o[pre]) {
    toast(`\u8BF7\u5148\u5B8C\u6210\u300C${MILE_LABEL[pre]}\u300D\u518D\u6807\u8BB0\u300C${MILE_LABEL[key]}\u300D`);
    return false;
  }
  if (key === "publishedAt" && !deliveredAll(o)) {
    toast("\u6B63\u7247/\u526F\u7247\u51FA\u9F50\u540E\u624D\u80FD\u6807\u8BB0\u53D1\u5E03");
    return false;
  }
  o[key] = nowStr();
  save();
  renderAll();
  rerenderDetail();
  Notify.syncDeliver();
  toast(label);
  return true;
}
function pay(id, kind, method = "\u5FAE\u4FE1") {
  const o = byId(id), spec = paymentSpec(kind);
  if (!o || !spec || !METHODS.includes(method)) {
    toast("\u6536\u6B3E\u8BA2\u5355\u3001\u7C7B\u578B\u6216\u65B9\u5F0F\u65E0\u6548");
    return false;
  }
  const m = orderMoney(o);
  if (!m || m[kind] <= 0) {
    toast("\u6CA1\u6709\u6709\u6548\u7684\u5F85\u6536\u91D1\u989D\uFF0C\u4E0D\u80FD\u8BB0\u8D26");
    return false;
  }
  if (hasReceipt(o, kind)) {
    toast("\u8BE5\u7B14\u6B3E\u9879\u5DF2\u8BB0\u5F55\uFF0C\u8BF7\u52FF\u91CD\u590D\u6536\u6B3E");
    return false;
  }
  const t = nowStr(), amount = m[kind] / 100;
  o[spec.field] = t;
  db.payments.push({ oid: id, kind: spec.label, amount, at: t, method });
  if (kind === "final") clearSnooze(o);
  save();
  renderAll();
  rerenderDetail();
  Notify.syncDaily();
  toast(`\u5DF2\u6536${spec.label} ${fmtMoney3(amount)} \xB7 ${method}`, { label: "\u64A4\u9500", run: () => undoPay(id, kind, t) });
  return true;
}
function clearSnooze(o) {
  if (!o || !o.remindAt) return;
  o.remindAt = null;
  Notify.cancelSnooze(o.id);
}
function undoPay(id, kind, at) {
  const spec = paymentSpec(kind), o = byId(id);
  if (!spec || !o) return false;
  const index = db.payments.findIndex((p) => p.oid === id && p.kind === spec.label && p.at === at);
  if (index < 0 || o[spec.field] !== at) {
    toast("\u8FD9\u7B14\u6536\u6B3E\u5DF2\u88AB\u6539\u52A8,\u65E0\u6CD5\u64A4\u9500");
    return false;
  }
  db.payments.splice(index, 1);
  o[spec.field] = null;
  save();
  renderAll();
  rerenderDetail();
  Notify.syncDaily();
  toast("\u5DF2\u64A4\u9500\u8BE5\u7B14\u6536\u6B3E");
  return true;
}
function openPay(oid, kind, keepMethod) {
  ui.payCtx = null;
  const o = byId(oid), spec = paymentSpec(kind);
  if (!o || !spec) {
    toast("\u6536\u6B3E\u8BA2\u5355\u6216\u7C7B\u578B\u65E0\u6548");
    return;
  }
  const m = orderMoney(o);
  if (!m || m[kind] <= 0 || hasReceipt(o, kind)) {
    toast("\u8BE5\u7B14\u6B3E\u9879\u6CA1\u6709\u5F85\u6536\u91D1\u989D\u6216\u5DF2\u7ECF\u8BB0\u5F55");
    return;
  }
  const method = keepMethod === void 0 ? o.settleVia === "douyin" ? "\u6296\u97F3\u5546\u5355" : "\u5FAE\u4FE1" : keepMethod;
  if (!METHODS.includes(method)) {
    toast("\u8BF7\u9009\u62E9\u6709\u6548\u7684\u6536\u6B3E\u65B9\u5F0F");
    return;
  }
  const amt = m[kind] / 100;
  ui.payCtx = { oid, kind, method };
  $("#pay-body").innerHTML = `
    <div style="text-align:center;padding:6px 0 2px">
      <div style="font-size:14px;font-weight:700">${esc(o.store)}</div>
      <div style="font-size:34px;font-weight:800;margin:8px 0 2px">${esc(fmtMoney3(amt))}</div>
      <div style="font-size:12px;color:var(--sub)">${spec.label} \xB7 ${o.settleVia === "douyin" ? "\u7EA6\u5B9A\u6296\u97F3\u5546\u5355\u7ED3\u7B97" : "\u79C1\u6536\u6B3E\u9879"} \xB7 \u4EC5\u4F5C\u5165\u8D26\u8BB0\u5F55</div>
    </div>
    <div class="sec-title" style="justify-content:center">\u6536\u6B3E\u65B9\u5F0F(\u8BB0\u5F55\u7528)</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">
      ${METHODS.map((m2) => `<button class="mchip ${ui.payCtx.method === m2 ? "on" : ""}" data-act="pay-method" data-m="${esc(m2)}">${esc(m2)}</button>`).join("")}
    </div>
    <div style="padding:18px 0 4px"><button class="btn green" data-act="confirm-pay">\u786E\u8BA4\u6536\u6B3E ${esc(fmtMoney3(amt))}</button></div>`;
  showSheet("sheet-pay");
}
var REMIND_QUICK = ["\u8BF4\u8FD9\u5468\u7ED9", "\u8BF4\u6708\u5E95\u7EDF\u4E00\u7ED3", "\u8D22\u52A1\u8D70\u6D41\u7A0B", "\u6CA1\u56DE\u590D/\u4E0D\u63A5", "\u5DF2\u8F6C\u5BF9\u516C", "\u8BF4\u62CD\u5B8C\u518D\u7ED3"];
function openRemind(oid) {
  const o = byId(oid);
  if (!o) {
    toast("\u8BA2\u5355\u4E0D\u5B58\u5728");
    return;
  }
  const log = remindLogOf(o), last = log[log.length - 1];
  ui.remindOid = oid;
  const note = $("#remind-note");
  if (note) note.value = "";
  $("#remind-sub").textContent = `\u300C${o.store}\u300D${log.length ? `\u5DF2\u50AC ${log.length >= 50 ? "50+" : log.length} \u6B21,\u6700\u8FD1 ${fmtDT(last.at)}` : "\u8FD8\u6CA1\u50AC\u8FC7"} \xB7 \u8BB0\u5F55\u65F6\u95F4\u81EA\u52A8\u53D6\u73B0\u5728`;
  $("#remind-quick").innerHTML = REMIND_QUICK.map((t) => `<button class="fchip" data-act="remind-quick" data-v="${esc(t)}">${esc(t)}</button>`).join("");
  showSheet("sheet-remind");
}
function saveRemind() {
  const id = ui.remindOid, o = byId(id);
  if (!o) {
    closeSheets();
    return;
  }
  const input = $("#remind-note");
  const note = (input && input.value ? input.value : "").trim().slice(0, 200);
  const at = nowStr();
  const seq = remindLogOf(o).length;
  const capped = seq >= 50;
  o.remindLog = [...remindLogOf(o), { at, note }].slice(-50);
  const back = ui.detail === id ? id : null;
  save();
  renderAll();
  closeSheets();
  if (back !== null && byId(back)) openDetail(back);
  toast(capped ? `\u5DF2\u8BB0\u5F55 \xB7 \u6700\u65E9\u4E00\u6761\u5DF2\u88AB\u6324\u51FA,\u53EA\u4FDD\u7559\u6700\u8FD1 50 \u6B21${note ? ` \xB7 ${note}` : ""}` : `\u5DF2\u8BB0\u5F55\u7B2C ${seq + 1} \u6B21\u50AC\u6536${note ? ` \xB7 ${note}` : ""}`);
}
function openExpect(oid) {
  const o = byId(oid);
  if (!o) {
    toast("\u8BA2\u5355\u4E0D\u5B58\u5728");
    return;
  }
  ui.expectOid = oid;
  $("#expect-sub").textContent = `\u300C${o.store}\u300D\u6296\u97F3\u5546\u5355,\u5C3E\u6B3E ${fmtMoney3(unFin(o))} \u7531\u5E73\u53F0\u7ED3\u7B97`;
  $("#expect-date").value = o.expectPayAt ? o.expectPayAt.slice(0, 10) : "";
  showSheet("sheet-expect");
}
function saveExpect() {
  const id = ui.expectOid, o = byId(id);
  if (!o) {
    closeSheets();
    return;
  }
  const day = $("#expect-date").value;
  const at = day ? `${day}T10:00` : "";
  if (!at || !validDateTime(at)) {
    toast("\u5148\u9009\u4E00\u4E2A\u6709\u6548\u7684\u5230\u8D26\u65E5\u671F");
    return;
  }
  const back = ui.detail === id ? id : null;
  o.expectPayAt = at;
  save();
  renderAll();
  closeSheets();
  if (back !== null && byId(back)) openDetail(back);
  toast(`\u5DF2\u8BB0\u4E0B\u9884\u8BA1 ${fmtD(at)} \u5230\u8D26`);
}
function clearExpect(oid) {
  const o = byId(oid);
  if (!o || !o.expectPayAt) return;
  o.expectPayAt = null;
  save();
  renderAll();
  rerenderDetail();
  toast("\u5DF2\u6E05\u9664\u9884\u8BA1\u5230\u8D26\u65E5");
}
function capturePlace(oid) {
  if (typeof TanJiGeo === "undefined") return;
  TanJiGeo.locate().then((place) => {
    const cur = byId(oid);
    if (!cur || !place) return;
    cur.gpsPlace = place;
    save();
    renderAll();
    rerenderDetail();
    toast("\u5DF2\u8BB0\u5F55\u5230\u5E97\u5B9A\u4F4D \u2713");
  }).catch(() => {
  });
}

// src/app/order-forms.js
function conflictLine(o) {
  const place = (o.location || "").trim() || gpsText(o);
  return `${esc(fmtHM(o.appt))} \u300C${esc(o.store)}\u300D${place ? ` \xB7 ${esc(place)}` : ""}`;
}
function conflictFor(date, time, excludeId) {
  const { same, overlap } = TanJiLogic.apptOverlap(db.orders, date, time, excludeId);
  if (!same.length) return "";
  const rows = (list) => list.map((o) => `<div>\xB7 ${conflictLine(o)}</div>`).join("");
  if (overlap.length) return `<b>\u8BE5\u65F6\u6BB5\u5DF2\u6709\u6392\u671F(\u524D\u540E 2 \u5C0F\u65F6\u5185):</b>${rows(overlap)}\u4E0D\u5F71\u54CD\u4FDD\u5B58\u2014\u2014\u53EF\u627E\u4EBA\u4EE3\u62CD\u6216\u9519\u5CF0\u3002`;
  return `<b>\u5F53\u5929\u5DF2\u6709 ${same.length} \u4E2A\u6392\u671F:</b>${rows(same)}`;
}
function updateDateRelative(prefix) {
  const el = $("#" + prefix + "-date-relative"), label = relativeDayLabel($("#" + prefix + "-date").value);
  el.textContent = label;
  el.style.display = label ? "inline-flex" : "none";
}
function updateConflict() {
  updateDateRelative("f");
  const el = $("#f-conflict");
  const date = $("#f-date").value, time = $("#f-time").value || "10:00";
  const msg = conflictFor(date, time, 0);
  if (msg) {
    el.innerHTML = msg;
    el.style.display = "block";
  } else el.style.display = "none";
}
function openNew() {
  $("#f-store").value = "";
  $("#f-price").value = "";
  $("#f-deposit").value = "";
  $("#f-contact").value = "";
  $("#f-note").value = "";
  $("#f-settle").value = "private";
  $("#f-partner").value = "";
  $("#f-location").value = "";
  $("#f-need-main").checked = true;
  $("#f-need-sub").checked = false;
  $("#f-date").value = TODAY;
  $("#f-time").value = "10:00";
  $("#f-err").style.display = "none";
  ui.draftProv = "";
  ui.draftAccId = ui.accFilter != null && accById(ui.accFilter) ? ui.accFilter : ACCS().length ? ACCS()[0].id : null;
  ui.draftAccIds = ui.draftAccId == null ? [] : [ui.draftAccId];
  renderAccPick("f-acc-block", ui.draftAccIds, true);
  renderProvPick("f-prov-block", "");
  updateConflict();
  showSheet("sheet-new");
}
function saveOrder() {
  const fail = (message) => {
    const el = $("#f-err");
    el.textContent = message;
    el.style.display = "block";
  };
  const store = $("#f-store").value.trim();
  const priceCents = moneyCents($("#f-price").value), depositCents = moneyCents($("#f-deposit").value, true);
  if (!store) {
    fail("\u8BF7\u586B\u5199\u5546\u5BB6\u540D\u79F0");
    return;
  }
  if (priceCents === null || depositCents === null || depositCents > priceCents) {
    fail("\u603B\u4EF7\u548C\u5B9A\u91D1\u987B\u4E3A\u6709\u6548\u975E\u8D1F\u91D1\u989D\uFF0C\u6700\u591A\u4E24\u4F4D\u5C0F\u6570\uFF0C\u5B9A\u91D1\u4E0D\u80FD\u8D85\u8FC7\u603B\u4EF7");
    return;
  }
  const needMain2 = $("#f-need-main").checked, needSub2 = $("#f-need-sub").checked;
  if (!needMain2 && !needSub2) {
    fail("\u51FA\u7247\u8981\u6C42\u81F3\u5C11\u8981\u52FE\u9009\u6B63\u7247\u6216\u526F\u7247");
    return;
  }
  const accountIds = ACCS().length ? accMulti() ? [...new Set(ui.draftAccIds || [])].filter((id) => accById(id)) : [ACCS()[0].id] : [null];
  if (accMulti() && !accountIds.length) {
    fail("\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u8D26\u53F7");
    return;
  }
  const date = $("#f-date").value || TODAY, time = $("#f-time").value || "10:00", appt = `${date}T${time}`;
  const settleVia = $("#f-settle").value;
  if (!validDateTime(appt)) {
    fail("\u8BF7\u586B\u5199\u6709\u6548\u7684\u9884\u7EA6\u65E5\u671F\u548C\u65F6\u95F4");
    return;
  }
  if (!["private", "douyin"].includes(settleVia)) {
    fail("\u8BF7\u9009\u62E9\u6709\u6548\u7684\u7ED3\u7B97\u65B9\u5F0F");
    return;
  }
  const maxId = db.orders.reduce((max, x) => Number.isSafeInteger(x.id) && x.id > 0 ? Math.max(max, x.id) : NaN, 0);
  const firstId = maxId + 1, lastId = firstId + accountIds.length - 1;
  if (!Number.isSafeInteger(firstId) || firstId < 1) {
    fail("\u8BA2\u5355\u7F16\u53F7\u8D85\u51FA\u5B89\u5168\u8303\u56F4\u6216\u5DF2\u6709\u5F02\u5E38\u7F16\u53F7\uFF0C\u65E0\u6CD5\u65B0\u5EFA");
    return;
  }
  if (!Number.isSafeInteger(lastId) || lastId >= 1e5) {
    fail("\u8BA2\u5355\u7F16\u53F7\u5DF2\u8FBE\u4E0A\u9650(99999),\u8BF7\u5148\u5BFC\u51FA\u5907\u4EFD\u5E76\u8054\u7CFB\u652F\u6301");
    return;
  }
  const base = {
    store,
    cat: $("#f-cat").value,
    contact: $("#f-contact").value.trim(),
    price: priceCents / 100,
    deposit: depositCents / 100,
    settleVia,
    channel: chanFromDraft(),
    partner: $("#f-partner").value.trim(),
    location: $("#f-location").value.trim(),
    deliverMain: needMain2,
    deliverSub: needSub2,
    reviewResult: "",
    publishedAt: null,
    appt,
    shotAt: null,
    submittedAt: null,
    shortAt: null,
    longAt: null,
    depositPaidAt: null,
    finalPaidAt: null,
    remindAt: null,
    note: $("#f-note").value.trim()
  };
  const created = accountIds.map((accountId, index) => ({ ...base, id: firstId + index, accountId }));
  db.orders.push(...created);
  save();
  Notify.syncDeliver();
  closeSheets();
  ui.selDay = date;
  ui.vMon = { y: +date.slice(0, 4), m: +date.slice(5, 7) };
  showTab("trip");
  renderAll();
  toast(created.length > 1 ? `\u5DF2\u6DFB\u52A0 ${created.length} \u7B14\u72EC\u7ACB\u9884\u7EA6:${store}` : `\u5DF2\u6DFB\u52A0\u9884\u7EA6:${store}`);
}
function duplicateOrder(oid) {
  const source = byId(oid);
  if (!source) return;
  const maxId = db.orders.reduce((max, x) => Number.isSafeInteger(x.id) && x.id > 0 ? Math.max(max, x.id) : NaN, 0), id = maxId + 1;
  if (!Number.isSafeInteger(id) || id < 1) {
    toast("\u8BA2\u5355\u7F16\u53F7\u5F02\u5E38\uFF0C\u65E0\u6CD5\u590D\u5236");
    return;
  }
  if (id >= 1e5) {
    toast("\u8BA2\u5355\u7F16\u53F7\u5DF2\u8FBE\u4E0A\u9650(99999),\u8BF7\u5148\u5BFC\u51FA\u5907\u4EFD\u5E76\u8054\u7CFB\u652F\u6301");
    return;
  }
  const copy = {
    ...source,
    id,
    shotAt: null,
    submittedAt: null,
    shortAt: null,
    longAt: null,
    depositPaidAt: null,
    finalPaidAt: null,
    remindAt: null,
    expectPayAt: null,
    reviewResult: "",
    publishedAt: null
  };
  for (const key of ["remindLog", "photoThumb", "gpsPlace"]) delete copy[key];
  db.orders.push(copy);
  save();
  Notify.syncDeliver();
  Notify.syncDaily();
  closeSheets();
  renderAll();
  openEdit(id);
  toast("\u5DF2\u590D\u5236\u8BA2\u5355\uFF0C\u6B63\u5728\u7F16\u8F91\u526F\u672C");
}
var EDIT_FIELDS = ["e-store", "e-cat", "e-settle", "e-partner", "e-location", "e-date", "e-time", "e-price", "e-deposit", "e-contact", "e-note"];
var EDIT_CHECKS = ["e-need-main", "e-need-sub"];
var moneyFieldValue = (id, fallback) => {
  const el = $("#" + id);
  if (!el) return fallback;
  if (el.dataset.masked === "1") return fallback;
  return el.value;
};
function editDraft() {
  return JSON.stringify([EDIT_FIELDS.map((id) => {
    const el = $("#" + id);
    return el ? el.value : "";
  }), EDIT_CHECKS.map((id) => {
    const el = $("#" + id);
    return el ? el.checked : false;
  }), ui.draftProv, ui.draftAccId]);
}
function renderEditReceipts(o) {
  const locked = hasAnyReceipt(o), masked = ui.privacy;
  $("#e-price").readOnly = locked || masked;
  $("#e-deposit").readOnly = locked || masked;
  $("#e-money-help").textContent = masked ? "\u9690\u79C1\u6A21\u5F0F\u5DF2\u9690\u85CF\u91D1\u989D\uFF1A\u603B\u4EF7\u4E0E\u5B9A\u91D1\u6682\u4E0D\u53EF\u67E5\u770B\u3001\u4E0D\u53EF\u4FEE\u6539\uFF0C\u5173\u6389\u9690\u79C1\u6A21\u5F0F\uFF08\u53F3\u4E0A\u89D2\u773C\u775B\uFF09\u540E\u518D\u7F16\u8F91\u3002" : locked ? "\u5DF2\u6709\u6536\u6B3E\u8BB0\u5F55\u6216\u5DF2\u6536\u6807\u8BB0\uFF0C\u4E0D\u80FD\u4FEE\u6539\u603B\u4EF7\u548C\u5B9A\u91D1\uFF1B\u8BF7\u5148\u64A4\u9500\u9519\u8BEF\u6536\u6B3E\u518D\u6539\u3002" : "\u91D1\u989D\u6700\u591A\u4E24\u4F4D\u5C0F\u6570\uFF0C\u5B9A\u91D1\u4E0D\u80FD\u8D85\u8FC7\u603B\u4EF7\uFF1B\u652F\u6301 0 \u5143\u65E0\u5B9A\u91D1\u3002";
  $("#e-payments").innerHTML = ["deposit", "final"].map((kind) => {
    const spec = paymentSpec(kind), received = hasReceipt(o, kind), due = kind === "deposit" ? unDep(o) : unFin(o);
    if (!received && due <= 0) return "";
    return `<button class="btn ${received ? "ghost" : kind === "deposit" ? "tint-blue" : "tint-green"}" data-act="${kind === "deposit" ? "toggle-dep" : "toggle-fin"}" data-oid="${esc(o.id)}">${received ? "\u64A4\u9500" + spec.label + "\u8BB0\u5F55" : "\u8865\u8BB0" + spec.label + "\u5DF2\u6536"}</button>`;
  }).join("") || '<div class="rsub">\u6CA1\u6709\u5F85\u6536\u6B3E\u9879\u6216\u53EF\u64A4\u9500\u7684\u6536\u6B3E\u8BB0\u5F55</div>';
}
function toggleReceipt(oid, kind) {
  const o = byId(oid), spec = paymentSpec(kind);
  if (!o || !spec || ui.editId !== oid) return;
  if (hasReceipt(o, kind)) {
    if (!confirm("\u64A4\u9500" + spec.label + "\u8BB0\u5F55\u5E76\u5220\u9664\u5BF9\u5E94\u6D41\u6C34\uFF1F\u4EC5\u7528\u4E8E\u7EA0\u6B63\u9519\u8BEF\u6536\u6B3E\uFF0C\u4E0D\u8868\u793A\u9000\u6B3E\u3002")) return;
    o[spec.field] = null;
    db.payments = db.payments.filter((p) => !(p.oid === oid && (p.kind === spec.label || p.kind === kind)));
    save();
    renderAll();
    Notify.syncDaily();
    toast("\u5DF2\u64A4\u9500" + spec.label + "\u8BB0\u5F55(\u542B\u6D41\u6C34)");
  } else {
    if (editDraft() !== ui.editSnapshot) {
      toast("\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\uFF0C\u8BF7\u5148\u4FDD\u5B58\uFF0C\u518D\u8865\u8BB0\u6536\u6B3E");
      return;
    }
    if (!pay(oid, kind, o.settleVia === "douyin" ? "\u6296\u97F3\u5546\u5355" : "\u5FAE\u4FE1")) return;
  }
  renderEditReceipts(o);
}
function openEdit(oid) {
  const o = byId(oid);
  if (!o) return;
  ui.editId = oid;
  ui.payCtx = null;
  const cats = ["\u5496\u5561", "\u9910\u996E", "\u70E7\u70E4", "\u706B\u9505", "\u8336\u996E", "\u751C\u54C1", "\u70D8\u7119", "\u7F8E\u53D1", "\u5065\u8EAB", "\u6C11\u5BBF", "\u96F6\u552E", "\u4F53\u9A8C\u9986", "\u9732\u8425", "\u670D\u9970", "\u5FEB\u9910", "\u5176\u4ED6"];
  const catOpts = [.../* @__PURE__ */ new Set([o.cat || "\u5176\u4ED6", ...cats])];
  $("#edit-body").innerHTML = `
    <div class="frow"><label>\u54C1\u540D/\u5546\u5BB6</label><input id="e-store" value="${esc(o.store || "")}"></div>
    <div class="frow"><label>\u7C7B\u578B</label><select id="e-cat">${catOpts.map((c) => `<option ${c === o.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
    <div class="frow"><label>\u7ED3\u7B97\u65B9\u5F0F</label><select id="e-settle"><option value="private" ${o.settleVia !== "douyin" ? "selected" : ""}>\u79C1\u6536(\u5FAE\u4FE1/\u652F\u4ED8\u5B9D/\u94F6\u884C\u5361)</option><option value="douyin" ${o.settleVia === "douyin" ? "selected" : ""}>\u6296\u97F3\u5546\u5355(\u5E73\u53F0\u7ED3\u7B97)</option></select></div>
    <div id="e-acc-block"></div>
    <div id="e-prov-block"></div>
    <div class="frow"><label>\u7EC4\u961F</label><input id="e-partner" value="${esc(o.partner || "")}" placeholder="\u7EC4\u961F/\u51FA\u955C\u642D\u6863,\u5355\u4EBA\u62CD\u6444\u53EF\u7A7A"></div>
    <div class="frow"><label>\u5730\u70B9</label><input id="e-location" value="${esc(o.location || "")}" placeholder="\u5982:\u4E07\u8C61\u57CE 3 \u5C42"></div>
    <div class="frow date-row"><label>\u9884\u7EA6\u65F6\u95F4</label><input id="e-date" type="date" value="${esc((o.appt || "").slice(0, 10))}"><input id="e-time" type="time" value="${esc((o.appt || "").slice(11, 16))}"><span class="date-relative" id="e-date-relative" aria-live="polite"></span></div>
    <div class="frow"><label>\u51FA\u7247\u8981\u6C42</label><div style="display:flex;gap:22px;align-items:center;padding:6px 2px">
      <label style="display:flex;gap:7px;align-items:center;font-size:14px"><input type="checkbox" id="e-need-main" ${needMain(o) ? "checked" : ""} style="width:17px;height:17px;accent-color:var(--brand)"> \u6B63\u7247</label>
      <label style="display:flex;gap:7px;align-items:center;font-size:14px"><input type="checkbox" id="e-need-sub" ${needSub(o) ? "checked" : ""} style="width:17px;height:17px;accent-color:var(--brand)"> \u526F\u7247</label>
    </div></div>
    <div class="frow"><label>\u9001\u5BA1\u7ED3\u679C</label><select id="e-review">
      <option value="" ${!o.reviewResult ? "selected" : ""}>\u672A\u9001\u5BA1/\u5F85\u5BA1</option>
      <option value="pass" ${o.reviewResult === "pass" ? "selected" : ""}>\u5408\u683C</option>
      <option value="fail" ${o.reviewResult === "fail" ? "selected" : ""}>\u4E0D\u5408\u683C</option>
    </select></div>
    <div class="frow"><label>\u603B\u4EF7(\xA5)</label><input id="e-price" type="number" inputmode="decimal" min="0" step="0.01" value="${ui.privacy ? "" : esc(o.price)}"${ui.privacy ? ' placeholder="\xA5\u2731\u2731\u2731" data-masked="1" readonly' : ""}></div>
    <div class="frow"><label>\u5B9A\u91D1(\xA5)</label><input id="e-deposit" type="number" inputmode="decimal" min="0" step="0.01" value="${ui.privacy ? "" : esc(o.deposit)}"${ui.privacy ? ' placeholder="\xA5\u2731\u2731\u2731" data-masked="1" readonly' : ""}></div>
    <div class="rsub" id="e-money-help" style="margin:6px 0;line-height:1.5"></div>
    <div class="frow"><label>\u8054\u7CFB\u65B9\u5F0F</label><input id="e-contact" value="${esc(o.contact || "")}"></div>
    <div class="frow"><label>\u5907\u6CE8</label><textarea id="e-note" rows="2">${esc(o.note || "")}</textarea></div>
    <div class="banner-amber" id="e-conflict"></div>
    <div class="sec-title">\u6536\u6B3E\u8BB0\u5F55(\u53EF\u64A4\u9500 / \u8865\u8BB0)</div>
    <div class="btn2" id="e-payments"></div>
    <div class="rsub" style="margin-top:6px;line-height:1.5">\u8865\u8BB0\u524D\u8BF7\u5148\u4FDD\u5B58\u4FEE\u6539\uFF1B\u6309\u5DF2\u4FDD\u5B58\u91D1\u989D\u8BB0\u4E00\u7B14\uFF0C\u5E73\u53F0\u5355\u4F7F\u7528\u6296\u97F3\u5546\u5355\uFF0C\u79C1\u6536\u9ED8\u8BA4\u5FAE\u4FE1\u3002\u64A4\u9500\u4EC5\u7528\u4E8E\u7EA0\u6B63\u9519\u8BEF\u6536\u6B3E\uFF0C\u4F1A\u540C\u65F6\u79FB\u9664\u5BF9\u5E94\u6D41\u6C34\u3002</div>`;
  ui.draftProv = o.channel || "\u76F4\u5BA2";
  ui.draftAccId = o.accountId ?? null;
  renderAccPick("e-acc-block", ui.draftAccId);
  renderProvPick("e-prov-block", ui.draftProv);
  renderEditReceipts(o);
  ui.editSnapshot = editDraft();
  updateEditConflict();
  ["e-date", "e-time"].forEach((id) => {
    $("#" + id).addEventListener("change", updateEditConflict);
    $("#" + id).addEventListener("input", updateEditConflict);
  });
  showSheet("sheet-edit");
}
function updateEditConflict() {
  updateDateRelative("e");
  const el = $("#e-conflict");
  const date = $("#e-date").value, time = $("#e-time").value || "10:00";
  const msg = conflictFor(date, time, ui.editId);
  if (msg) {
    el.innerHTML = msg;
    el.style.display = "block";
  } else el.style.display = "none";
}
function saveEdit() {
  const o = byId(ui.editId);
  if (!o) return;
  const store = $("#e-store").value.trim();
  const priceCents = moneyCents(moneyFieldValue("e-price", o.price)), depositCents = moneyCents(moneyFieldValue("e-deposit", o.deposit), true);
  if (!store) {
    toast("\u8BF7\u586B\u5199\u5546\u5BB6\u540D\u79F0");
    return;
  }
  if (priceCents === null || depositCents === null || depositCents > priceCents) {
    toast("\u603B\u4EF7\u548C\u5B9A\u91D1\u987B\u4E3A\u6709\u6548\u975E\u8D1F\u91D1\u989D\uFF0C\u6700\u591A\u4E24\u4F4D\u5C0F\u6570\uFF0C\u5B9A\u91D1\u4E0D\u80FD\u8D85\u8FC7\u603B\u4EF7");
    return;
  }
  if (hasAnyReceipt(o) && (priceCents !== moneyCents(o.price) || depositCents !== moneyCents(o.deposit))) {
    toast("\u5DF2\u6709\u6536\u6B3E\u8BB0\u5F55\uFF0C\u8BF7\u5148\u64A4\u9500\u9519\u8BEF\u6536\u6B3E\uFF0C\u518D\u4FEE\u6539\u603B\u4EF7\u6216\u5B9A\u91D1");
    return;
  }
  const date = $("#e-date").value || TODAY, time = $("#e-time").value || "10:00", appt = `${date}T${time}`;
  const settleVia = $("#e-settle").value;
  if (!validDateTime(appt)) {
    toast("\u8BF7\u586B\u5199\u6709\u6548\u7684\u9884\u7EA6\u65E5\u671F\u548C\u65F6\u95F4");
    return;
  }
  if (!["private", "douyin"].includes(settleVia)) {
    toast("\u8BF7\u9009\u62E9\u6709\u6548\u7684\u7ED3\u7B97\u65B9\u5F0F");
    return;
  }
  const needMain2 = $("#e-need-main").checked, needSub2 = $("#e-need-sub").checked;
  if (!needMain2 && !needSub2) {
    toast("\u51FA\u7247\u8981\u6C42\u81F3\u5C11\u8981\u52FE\u9009\u6B63\u7247\u6216\u526F\u7247");
    return;
  }
  o.store = store;
  o.cat = $("#e-cat").value;
  o.settleVia = settleVia;
  o.channel = chanFromDraft();
  o.partner = $("#e-partner").value.trim();
  o.location = $("#e-location").value.trim();
  if (accMulti()) o.accountId = ui.draftAccId ?? null;
  o.deliverMain = needMain2;
  o.deliverSub = needSub2;
  o.reviewResult = $("#e-review").value;
  o.appt = appt;
  o.price = priceCents / 100;
  o.deposit = depositCents / 100;
  o.contact = $("#e-contact").value.trim();
  o.note = $("#e-note").value.trim();
  if (o.settleVia !== "douyin" && o.expectPayAt != null) o.expectPayAt = null;
  if (o.settleVia === "douyin" || unFin(o) <= 0) clearSnooze(o);
  const returnDetail = ui.detail === o.id ? o.id : null;
  save();
  closeSheets();
  renderAll();
  Notify.syncDeliver();
  Notify.syncDaily();
  if (returnDetail !== null) openDetail(returnDetail);
  toast("\u5DF2\u4FDD\u5B58\u4FEE\u6539");
}
function initShotInput() {
  const input = $("#shot-file");
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    if (Store.blocked) {
      toast("\u672C\u673A\u6570\u636E\u8BFB\u53D6\u5F02\u5E38,\u5199\u5165\u5DF2\u6682\u505C;\u8BF7\u5148\u70B9\u300C\u91CD\u8BD5\u4FDD\u5B58 / \u8BFB\u53D6\u300D");
      return;
    }
    const target = byId(ui.detail);
    if (!target) {
      toast("\u5148\u6253\u5F00\u4E00\u7B14\u8BA2\u5355\u518D\u62CD");
      return;
    }
    try {
      target.photoThumb = await TanJiImage.doorThumb(file);
      if (!target.shotAt) target.shotAt = nowStr();
      await save();
      renderAll();
      rerenderDetail();
      Notify.syncDeliver();
      toast("\u5DF2\u968F\u624B\u62CD \xB7 \u62CD\u6444\u65F6\u95F4\u5DF2\u8BB0\u5F55");
      capturePlace(target.id);
    } catch (e) {
      toast("\u8FD9\u5F20\u56FE\u5904\u7406\u4E0D\u4E86,\u6362\u4E00\u5F20\u8BD5\u8BD5");
    }
  });
}

// src/app/export.js
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1] || "");
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}
async function nativeShareFile(name, content) {
  const { Filesystem, Directory, Encoding, Share } = CAP;
  const opts = { path: name, directory: Directory.Cache };
  if (typeof content === "string") {
    opts.data = "\uFEFF" + content;
    opts.encoding = Encoding.UTF8;
  } else {
    opts.data = await blobToBase64(new Blob([content]));
  }
  const res = await Filesystem.writeFile(opts);
  await Share.share({ title: name, url: res.uri, dialogTitle: "\u5206\u4EAB\u5BFC\u51FA" });
}
function download(name, content, type) {
  if (isNative && CAP && CAP.Filesystem && CAP.Share) {
    nativeShareFile(name, content).then(() => toast("\u5DF2\u8C03\u8D77\u7CFB\u7EDF\u5206\u4EAB \u2713")).catch((e) => {
      console.error("\u5BFC\u51FA\u5931\u8D25", e);
      toast("\u5BFC\u51FA\u5931\u8D25:" + (e && e.message || e));
    });
    return;
  }
  const isText = typeof content === "string";
  const blob = new Blob([isText ? "\uFEFF" + content : content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2500);
}
function q(v) {
  const text = String(v ?? "");
  return `"${(typeof v === "string" && /^[\s]*[=+@-]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
}
function exportCsv() {
  const head = ["ID", "\u54C1\u540D/\u5546\u5BB6", "\u7C7B\u578B", "\u7ED3\u7B97\u65B9\u5F0F", "\u670D\u52A1\u5546", "\u7EC4\u961F", "\u8D26\u53F7", "\u5730\u70B9", "\u5230\u5E97\u5B9A\u4F4D", "\u8054\u7CFB\u65B9\u5F0F", "\u603B\u4EF7", "\u5B9A\u91D1", "\u9884\u7EA6\u65F6\u95F4", "\u5B9E\u9645\u62CD\u6444", "\u63D0\u5BA1\u65F6\u95F4", "\u526F\u7247\u53D1\u51FA", "\u6B63\u7247\u53D1\u51FA", "\u51FA\u7247\u8981\u6C42", "\u9001\u5BA1\u7ED3\u679C", "\u53D1\u5E03\u65F6\u95F4", "\u5DE5\u4F5C\u72B6\u6001", "\u6536\u6B3E\u72B6\u6001", "\u5F85\u6536\u91D1\u989D", "\u6B20\u6B3E\u5929\u6570", "\u50AC\u6536\u5907\u5FD8", "\u50AC\u6536\u6B21\u6570", "\u6700\u8FD1\u50AC\u6536", "\u9884\u8BA1\u5230\u8D26", "\u5907\u6CE8"];
  const lines = db.orders.map((o) => [
    o.id,
    o.store,
    o.cat,
    o.settleVia === "douyin" ? "\u6296\u97F3\u5546\u5355" : "\u79C1\u6536",
    o.channel || "",
    o.partner || "",
    (accById(o.accountId) || {}).name || "",
    o.location || "",
    gpsText(o),
    o.contact,
    o.price,
    o.deposit,
    o.appt,
    o.shotAt,
    o.submittedAt,
    o.shortAt,
    o.longAt,
    [needMain(o) ? "\u6B63\u7247" : "", needSub(o) ? "\u526F\u7247" : ""].filter(Boolean).join("+") || "\u672A\u914D\u7F6E",
    o.reviewResult ? REVIEW_LABEL[o.reviewResult] : "",
    o.publishedAt || "",
    workOf(o),
    payOf(o),
    owedOf(o),
    isOver(o) ? overdueDays(o) : 0,
    o.remindAt ? fmtD(o.remindAt) : "",
    remindLogOf(o).length,
    lastRemind(o) ? fmtD(lastRemind(o).at) : "",
    o.expectPayAt ? fmtD(o.expectPayAt) : "",
    o.note
  ].map(q).join(","));
  const phead = ["\u5E8F\u53F7", "\u8BA2\u5355ID", "\u5546\u5BB6", "\u7C7B\u578B", "\u91D1\u989D", "\u5230\u8D26\u65F6\u95F4", "\u6536\u6B3E\u65B9\u5F0F"];
  const plines = db.payments.map((p, i) => [i + 1, p.oid, storeOf(p.oid), p.kind, p.amount, p.at, p.method].map(q).join(","));
  download(`\u63A2\u8BB0-\u5BFC\u51FA-${TODAY}.csv`, [head.map(q).join(","), ...lines, "", "", phead.map(q).join(","), ...plines].join("\n"), "text/csv;charset=utf-8");
  toast("\u5DF2\u5BFC\u51FA CSV(\u8BA2\u5355 + \u6D41\u6C34)\u2713");
}
function exportJson() {
  download(`\u63A2\u8BB0-${Store.mode === "work" ? "\u5DE5\u4F5C" : "\u6F14\u793A"}\u5907\u4EFD-${toISO(/* @__PURE__ */ new Date())}.json`, JSON.stringify(backupDocument(), null, 2), "application/json");
  toast("\u5DF2\u5BFC\u51FA JSON \u5907\u4EFD");
}
function exportDb() {
  const bytes = buildSqliteBytes();
  if (!bytes) {
    toast("SQLite \u5F15\u64CE\u8FD8\u5728\u52A0\u8F7D,\u51E0\u79D2\u540E\u518D\u8BD5");
    return;
  }
  download(`\u63A2\u8BB0-${TODAY}.db`, bytes, "application/octet-stream");
  toast("\u5DF2\u5BFC\u51FA SQLite \u6570\u636E\u5E93 \u2713");
}
var SCHEMA = `<span class="c">-- \u63A2\u8BB0 TanJi \xB7 \u672C\u673A SQLite \u7ED3\u6784(v0.6 \xB7 \u5355\u6570\u636E\u96C6\u89C6\u56FE)</span>
<span class="c">-- \u6CE8\u610F:App \u5185\u771F\u5B9E\u5E93\u5728\u540C\u4E00\u4E2A .db \u91CC\u7528 mode \u5217\u533A\u5206 work/demo \u4E24\u5957\u6570\u636E,
--       orders/accounts \u4E3B\u952E\u4E3A (mode,id),payments \u5E26 mode,settings \u4E3B\u952E\u4E3A (scope,key);
--       \u672C\u9875\u4E0E\u300C\u5BFC\u51FA .db\u300D\u5C55\u793A\u7684\u662F\u53BB\u6389 mode \u7684\u5355\u6570\u636E\u96C6\u89C6\u56FE\u3002
--       \u8DE8\u8BBE\u5907\u642C\u8FD0\u8BF7\u7528 JSON \u5907\u4EFD(\u7EDF\u8BA1\u9875\u53EF\u5BFC\u5165),\u4E0D\u8981\u76F4\u63A5\u5BF9\u62F7 .db\u3002</span>
CREATE TABLE orders (
  id             INTEGER PRIMARY KEY,
  store          TEXT NOT NULL,  <span class="c">-- \u54C1\u540D/\u5546\u5BB6\u540D\u79F0</span>
  category       TEXT,           <span class="c">-- \u5E97\u94FA\u7C7B\u578B</span>
  contact        TEXT,           <span class="c">-- \u8054\u7CFB\u4EBA/\u7535\u8BDD</span>
  price          REAL NOT NULL,  <span class="c">-- \u6210\u4EA4\u603B\u4EF7</span>
  deposit        REAL DEFAULT 0, <span class="c">-- \u5B9A\u91D1</span>
  appt_at        TEXT,           <span class="c">-- \u9884\u7EA6\u65F6\u95F4</span>
  shot_at        TEXT,           <span class="c">-- \u5B9E\u9645\u62CD\u6444\u65F6\u95F4</span>
  submitted_at   TEXT,           <span class="c">-- \u63D0\u5BA1\u65F6\u95F4</span>
  short_sent_at  TEXT,           <span class="c">-- \u526F\u7247(\u77ED\u7247)\u53D1\u51FA</span>
  long_sent_at   TEXT,           <span class="c">-- \u6B63\u7247(\u957F\u7247)\u53D1\u51FA</span>
  deposit_paid_at TEXT,          <span class="c">-- \u5B9A\u91D1\u5230\u8D26\u65F6\u95F4</span>
  final_paid_at  TEXT,           <span class="c">-- \u5C3E\u6B3E\u5230\u8D26\u65F6\u95F4</span>
  settle_via     TEXT DEFAULT 'private',
                 <span class="c">-- \u7ED3\u7B97\u65B9\u5F0F:private \u79C1\u6536 / douyin \u6296\u97F3\u5546\u5355(\u5E73\u53F0\u7ED3\u7B97,\u4E0D\u50AC\u6536)</span>
  remind_at      TEXT,           <span class="c">-- \u50AC\u6536\u5907\u5FD8:\u4E0B\u6B21\u63D0\u9192\u65F6\u95F4(1/3/7 \u5929)</span>
  channel        TEXT,           <span class="c">-- \u670D\u52A1\u5546:\u8702\u5411\u3001\u5C0F\u7231\u3001\u91D1\u57CE\u3001\u98DF\u7269\u3001\u76F4\u5BA2\u2026</span>
  partner        TEXT,           <span class="c">-- \u7EC4\u961F/\u51FA\u955C\u642D\u6863:\u82B1\u82B1\u3001\u90B1\u90B1\u2026(\u7A7A=\u4E0D\u7EC4\u961F/\u672A\u8BB0)</span>
  location       TEXT,           <span class="c">-- \u5730\u70B9:\u95E8\u5E97\u5730\u5740/\u697C\u5C42(\u624B\u586B,\u5BFC\u822A\u6309\u5B83\u67E5)</span>
  gps_place      TEXT,           <span class="c">-- \u5230\u5E97\u5B9A\u4F4D \u62CD\u6444\u65F6\u81EA\u52A8\u8BB0\u5F55\u7684 GPS \u5750\u6807\u4E32 \u4E0E\u624B\u586B location \u5E76\u5B58</span>
  deliver_main   INTEGER DEFAULT 1, <span class="c">-- \u51FA\u7247\u8981\u6C42:1=\u9700\u8981\u6B63\u7247</span>
  deliver_sub    INTEGER DEFAULT 1, <span class="c">-- \u51FA\u7247\u8981\u6C42:1=\u9700\u8981\u526F\u7247(\u7F3A\u7701 1=\u65E7\u5355\u6B63\u526F\u7247\u90FD\u8981)</span>
  review_result  TEXT DEFAULT '',   <span class="c">-- \u9001\u5BA1\u7ED3\u679C:''\u5F85\u5BA1 / pass \u5408\u683C / fail \u4E0D\u5408\u683C</span>
  published_at   TEXT,              <span class="c">-- \u53D1\u5E03\u65F6\u95F4(\u91CC\u7A0B\u7891\u53EF\u6539)</span>
  account_id     INTEGER,           <span class="c">-- \u6240\u5C5E\u8D26\u53F7(accounts.id,\u7A7A=\u672A\u6307\u5B9A)</span>
  note           TEXT,
  remind_log     TEXT,           <span class="c">-- \u50AC\u6536\u8DDF\u8FDB\u75D5\u8FF9:JSON \u6570\u7EC4 \u6BCF\u6761\u542B at \u65F6\u95F4\u4E0E note \u7B54\u590D</span>
  expect_pay_at  TEXT,           <span class="c">-- \u5E73\u53F0\u5355(\u6296\u97F3\u5546\u5355)\u9884\u8BA1\u5230\u8D26\u65F6\u95F4;\u8FC7\u4E86\u8FD9\u5929\u4ECD\u672A\u5230\u8D26\u4F1A\u63D0\u793A</span>
  created_at     TEXT, updated_at TEXT
);
CREATE TABLE accounts (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,  <span class="c">-- \u6635\u79F0(\u5FC5\u586B)</span>
  phone      TEXT,           <span class="c">-- \u624B\u673A\u53F7(\u9009\u586B,\u4E00\u952E\u62F7\u8D1D\u7528)</span>
  douyin     TEXT,           <span class="c">-- \u6296\u97F3\u8D26\u53F7(\u9009\u586B)</span>
  color      INTEGER DEFAULT 0, <span class="c">-- \u6807\u8BC6\u8272\u5E8F\u53F7(\u8F7B\u67D4\u8272\u677F 0-7,\u5217\u8868\u5E95\u8272\u968F\u5B83)</span>
  avatar     TEXT,           <span class="c">-- \u5934\u50CF dataURL(\u76F8\u518C\u9009\u56FE\u81EA\u52A8\u88C1\u5706\u538B\u7F29,\u4EC5\u5B58\u672C\u673A)</span>
  created_at TEXT
);
CREATE TABLE payments (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id),
  kind     TEXT,  <span class="c">-- \u5B9E\u9645\u5B58\u4E2D\u6587\u6807\u7B7E:'\u5B9A\u91D1' / '\u5C3E\u6B3E'(\u4E0E method \u4E00\u6837\u53EA\u4F5C\u8BB0\u5F55,\u4E0D\u505A\u652F\u4ED8)</span>
  amount   REAL, paid_at TEXT,
  method   TEXT,   <span class="c">-- \u5FAE\u4FE1 / \u652F\u4ED8\u5B9D / \u94F6\u884C\u5361 / \u6296\u97F3\u5546\u5355 / \u5176\u4ED6(\u4EC5\u8BB0\u5F55,\u4E0D\u505A\u652F\u4ED8)</span>
  note     TEXT
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
<span class="c">-- \u5BFC\u51FA\u89C6\u56FE\uFF1BApp \u5185\u771F\u5B9E\u8868\u662F settings(scope,key)\uFF1Ascope=mode\uFF0Ckey=json / backup</span>
<span class="c">-- collect_threshold_days = 15 \xB7 app_version = 0.6</span>

<span class="c">-- \u5E38\u7528\u67E5\u8BE2:\u957F\u671F\u672A\u6536\u5C3E\u6B3E(\u79C1\u6536\u5355)</span>
SELECT store, price - deposit AS due,
       julianday('now') - julianday(shot_at) AS days
FROM orders
WHERE final_paid_at IS NULL AND shot_at IS NOT NULL AND settle_via='private'
ORDER BY days DESC;`;
$("#schema-pre").innerHTML = SCHEMA;
async function previewImport(file) {
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error("\u5907\u4EFD\u6587\u4EF6\u4E0D\u80FD\u8D85\u8FC7 10 MB");
    const state = validateState(JSON.parse((await file.text()).replace(/^\uFEFF/, "")));
    for (const order of state.orders) {
      for (const [kind, key, expected] of [["\u5B9A\u91D1", "depositPaidAt", order.deposit], ["\u5C3E\u6B3E", "finalPaidAt", order.price - order.deposit]]) {
        const entries = state.payments.filter((p) => p.oid === order.id && p.kind === kind);
        const total2 = entries.reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
        if (entries.length > 1 || entries.length > 0 && !order[key] || total2 !== Math.round((order[key] ? expected : 0) * 100)) throw new Error(`\u8BA2\u5355\u300C${order.store}\u300D\u7684${kind}\u6D41\u6C34\u4E0E\u5DF2\u6536\u72B6\u6001\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u5148\u6838\u5BF9\u5907\u4EFD`);
      }
    }
    Store.pending = state;
    const total = state.payments.reduce((sum, p) => sum + p.amount, 0);
    document.querySelector("#import-summary").textContent = `${file.name}\uFF1A${state.orders.length} \u7B14\u8BA2\u5355\u3001${state.payments.length} \u7B14\u6D41\u6C34\u3001\u5B9E\u6536 ${fmtMoney(total, ui.privacy)}\u3001\u50AC\u6536\u9608\u503C ${state.threshold} \u5929\u3002\u5C06\u66FF\u6362\u5F53\u524D${Store.mode === "work" ? "\u5DE5\u4F5C" : "\u6F14\u793A"}\u6570\u636E\uFF0C\u66FF\u6362\u524D\u81EA\u52A8\u4FDD\u5B58\u4E00\u4EFD\u672C\u673A\u5907\u4EFD\u3002`;
    showSheet("sheet-import");
  } catch (error) {
    Store.pending = null;
    toast(`\u4E0D\u80FD\u5BFC\u5165\uFF1A${error.message}`);
  }
}
async function confirmImport() {
  if (!Store.pending || Store.busy) return;
  const state = Store.pending;
  if (await replaceData(state)) {
    Store.pending = null;
    toast("\u5907\u4EFD\u5DF2\u6062\u590D\uFF0C\u66FF\u6362\u524D\u6570\u636E\u53EF\u5728\u7EDF\u8BA1\u9875\u6062\u590D");
  }
}
async function restoreCheckpoint() {
  if (Store.busy || Store.blocked) return;
  Store.busy = true;
  let saved;
  try {
    saved = await readSnapshot(Store.mode, "backup");
  } finally {
    Store.busy = false;
  }
  if (saved.uncertain) {
    toast("\u90E8\u5206\u5907\u4EFD\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u5DF2\u6682\u505C\u6062\u590D\uFF1B\u8BF7\u5BFC\u51FA\u66FF\u6362\u524D\u5907\u4EFD\u5E76\u91CD\u8BD5");
    return;
  }
  if (!saved.value) {
    toast("\u6CA1\u6709\u53EF\u7528\u7684\u66FF\u6362\u524D\u5907\u4EFD");
    return;
  }
  if (!confirm(`\u6062\u590D\u66FF\u6362\u524D\u7684 ${saved.value.orders.length} \u7B14\u8BA2\u5355\u548C ${saved.value.payments.length} \u7B14\u6D41\u6C34\uFF1F\u5F53\u524D\u6570\u636E\u5C06\u4F5C\u4E3A\u65B0\u7684\u66FF\u6362\u524D\u5907\u4EFD\u4FDD\u7559\u3002`)) return;
  if (await replaceData(saved.value)) toast("\u5DF2\u6062\u590D\u66FF\u6362\u524D\u6570\u636E");
}
async function exportCheckpoint() {
  const mode = Store.mode;
  const saved = await readSnapshot(mode, "backup");
  if (!saved.value) {
    toast("\u6CA1\u6709\u53EF\u7528\u7684\u66FF\u6362\u524D\u5907\u4EFD");
    return;
  }
  download(`\u63A2\u8BB0-${mode === "work" ? "\u5DE5\u4F5C" : "\u6F14\u793A"}-\u66FF\u6362\u524D\u5907\u4EFD.json`, JSON.stringify(backupDocument(saved.value), null, 2), "application/json");
  toast("\u5DF2\u5BFC\u51FA\u66FF\u6362\u524D\u5907\u4EFD\uFF0C\u539F\u5B58\u50A8\u672A\u6539\u52A8");
}

// src/app/share-image.js
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function buildTodayImage(day = TODAY) {
  const date = /* @__PURE__ */ new Date(day + "T00:00");
  const list = db.orders.filter(accMatch).filter((o) => o.appt.slice(0, 10) === day).sort((a, b) => a.appt.localeCompare(b.appt));
  const S = 2, W = 1080, rowH = 112, headH = 240, footH = 110, gap = 18, pad2 = 56;
  const rows = Math.max(list.length, 1);
  const H = headH + rows * (rowH + gap) + footH;
  const c = document.createElement("canvas");
  c.width = W * S;
  c.height = H * S;
  const g = c.getContext("2d");
  g.scale(S, S);
  g.fillStyle = "#F2F2F7";
  g.fillRect(0, 0, W, H);
  const gr = g.createLinearGradient(0, 0, W, headH);
  gr.addColorStop(0, "#FF8A3D");
  gr.addColorStop(1, "#E8352A");
  g.fillStyle = gr;
  g.fillRect(0, 0, W, headH - 28);
  g.fillStyle = "rgba(255,255,255,.9)";
  g.font = "600 26px -apple-system,PingFang SC,sans-serif";
  g.fillText("\u63A2\u8BB0 TanJi \xB7 \u62CD\u6444\u884C\u7A0B", pad2, 62);
  g.fillStyle = "#fff";
  g.font = "800 58px -apple-system,PingFang SC,sans-serif";
  g.fillText(`${date.getFullYear()}\u5E74${date.getMonth() + 1}\u6708${date.getDate()}\u65E5 \u5468${dowOf(day)}`, pad2, 136);
  g.font = "600 26px -apple-system,PingFang SC,sans-serif";
  g.fillStyle = "rgba(255,255,255,.88)";
  g.fillText(list.length ? `${list.length} \u4E2A\u62CD\u6444\u5B89\u6392` : "\u5F53\u5929\u6682\u65E0\u62CD\u6444\u5B89\u6392", pad2, 186);
  let y = headH;
  const WT = { "\u5F85\u62CD\u6444": ["#007AFF"], "\u540E\u671F\u4E2D": ["#AF52DE"], "\u53D1\u7247\u4E2D": ["#FF9500"], "\u5DF2\u4EA4\u4ED8": ["#239648"] };
  if (!list.length) {
    g.fillStyle = "#8E8E93";
    g.font = "500 30px -apple-system,PingFang SC";
    g.fillText("\u{1F319} \u4F11\u606F,\u660E\u5929\u518D\u6218", pad2, y + 66);
    y += rowH + gap;
  }
  for (const o of list) {
    g.fillStyle = "#fff";
    rr(g, pad2, y, W - pad2 * 2, rowH, 20);
    g.fill();
    g.fillStyle = "#FF6A2B";
    g.font = "800 40px -apple-system,PingFang SC";
    g.fillText(fmtHM(o.appt), pad2 + 30, y + 56);
    g.fillStyle = "#1C1C1E";
    g.font = "700 34px -apple-system,PingFang SC";
    g.fillText(o.store, pad2 + 156, y + 46, W - pad2 * 2 - 320);
    const st = WT[workOf(o)][0];
    g.fillStyle = st;
    g.font = "700 24px -apple-system,PingFang SC";
    g.fillText("\u25CF " + workOf(o), pad2 + 158, y + 88);
    g.fillStyle = "#8E8E93";
    g.font = "500 24px -apple-system,PingFang SC";
    g.fillText(o.cat, pad2 + 300, y + 88, W - pad2 * 2 - 300);
    y += rowH + gap;
  }
  g.fillStyle = "#B9B9C0";
  g.font = "500 24px -apple-system,PingFang SC";
  g.fillText("\u7531\u300C\u63A2\u8BB0\u300D\u751F\u6210 \xB7 \u4E0D\u542B\u91D1\u989D\u4FE1\u606F", pad2, y + 34);
  return new Promise((res) => c.toBlob((b) => res(b), "image/png"));
}
async function shareToday() {
  refreshClock();
  const day = ui.tab === "trip" ? ui.selDay : TODAY;
  toast("\u6B63\u5728\u751F\u6210\u884C\u7A0B\u56FE\u7247\u2026");
  const blob = await buildTodayImage(day);
  if (!blob) {
    toast("\u56FE\u7247\u751F\u6210\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
    return;
  }
  ui.shareDay = day;
  ui.shareBlob = blob;
  $("#sheet-share .sheet-title").textContent = `${day} \xB7 \u884C\u7A0B\u5206\u4EAB`;
  if (ui.shareUrl) URL.revokeObjectURL(ui.shareUrl);
  ui.shareUrl = URL.createObjectURL(blob);
  $("#share-body").innerHTML = `<img src="${ui.shareUrl}" style="width:100%;border-radius:16px;border:.5px solid var(--line)">
    <div style="padding-top:14px"><button class="btn primary" data-act="share-confirm">\u5206\u4EAB / \u4FDD\u5B58\u56FE\u7247</button></div>`;
  showSheet("sheet-share");
}

// src/app/stats.js
function statsFor(period, list) {
  refreshClock();
  return TanJiLogic.statsFor({ orders: db.orders, payments: db.payments, period, list, now });
}
function headBtns(share) {
  return `<div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
    <span style="font-size:10px;color:var(--sub)">${Store.mode === "demo" ? "\u6F14\u793A" : "\u5DE5\u4F5C"}</span>
    ${share ? `<button class="icon-btn" data-act="share" aria-label="\u5206\u4EAB\u884C\u7A0B"><svg class="ic" viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/></svg></button>` : ""}
    <button class="icon-btn ${ui.privacy ? "on" : ""}" data-act="privacy" aria-label="${ui.privacy ? "\u663E\u793A\u91D1\u989D" : "\u9690\u85CF\u91D1\u989D"}"><svg class="ic" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>${ui.privacy ? '<path d="M4.5 4.5l15 15"/>' : ""}</svg></button>
  </div>`;
}

// src/app/views/orders.js
var fmtMoney4 = (n) => fmtMoney(n, ui.privacy);
function chipMatch(o) {
  const w = workOf(o);
  switch (ui.chip) {
    case "wait":
      return w === "\u5F85\u62CD\u6444";
    case "doing":
      return w === "\u540E\u671F\u4E2D" || w === "\u53D1\u7247\u4E2D";
    case "unpaid":
      return owedOf(o) > 0;
    case "over":
      return isOver(o);
    case "done":
      return w === "\u5DF2\u4EA4\u4ED8";
    default:
      return true;
  }
}
function renderOrders() {
  const q2 = ui.q.trim().toLowerCase();
  const hit = (o) => q2 && [o.store, o.location, o.contact, o.channel, o.partner, o.note, o.cat].some((v) => String(v ?? "").toLowerCase().includes(q2));
  const all = db.orders.filter(accMatch).filter(chipMatch).filter((o) => !q2 || hit(o)).sort((a, b) => (b.shotAt || b.appt).localeCompare(a.shotAt || a.appt));
  const cnt = (k) => db.orders.filter(accMatch).filter((o) => {
    const t = ui.chip;
    ui.chip = k;
    const r = chipMatch(o);
    ui.chip = t;
    return r;
  }).length;
  const chips = [["all", "\u5168\u90E8"], ["wait", "\u5F85\u62CD\u6444"], ["doing", "\u8FDB\u884C\u4E2D"], ["unpaid", "\u5F85\u6536\u6B3E"], ["over", "\u903E\u671F"], ["done", "\u5DF2\u5B8C\u7ED3"]].map(([k, l]) => `<button class="fchip ${ui.chip === k ? "on" : ""}" data-act="chip" data-chip="${k}">${l} <b>${cnt(k)}</b></button>`).join("");
  const rows = all.length ? all.map((o) => `
    <div class="order-swipe" data-oid="${esc(o.id)}">
      <div class="order-swipe-actions"><button type="button" tabindex="-1" data-act="copy-order" data-oid="${esc(o.id)}" aria-label="\u590D\u5236 ${esc(o.store)}"><svg class="ic" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="12" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>\u590D\u5236</span></button></div>
      <div class="row order-swipe-track${accBar(o)}" style="${accTint(o)}" data-act="open" data-oid="${o.id}">
        <div class="rmain">
          <div class="rname">${esc(o.store)}</div>
          <div class="rsub">${o.shotAt ? `\u62CD\u6444 ${fmtD(o.shotAt)}` : `\u9884\u7EA6 ${fmtD(o.appt)} ${fmtHM(o.appt)}`} \xB7 ${esc(o.cat)}${o.partner ? " \xB7 \u51FA\u955C " + esc(o.partner) : ""}</div>
          <div class="chiprow">${accOrderTag(o)}${workChip(o)}${payChip(o)}${o.channel && o.channel !== "\u76F4\u5BA2" ? `<span class="chip c-gray">${esc(o.channel)}</span>` : ""}${isOver(o) ? `<span class="chip c-red">\u6B20 ${overdueDays(o)} \u5929</span>` : ""}${snoozed(o) ? '<span class="chip c-gray">\u5DF2\u8BBE\u63D0\u9192</span>' : ""}${stepBtn(o)}</div>
        </div>
        <div class="rside">${priceCell(o)}
          <div class="rsub" style="${owedOf(o) > 0 ? "color:var(--red);font-weight:700" : ""}">${owedOf(o) > 0 ? "\u5F85\u6536 " + fmtMoney4(owedOf(o)) : "\u5DF2\u7ED3\u6E05"}</div>
        </div>
        <button class="icon-btn" style="width:40px;height:40px;background:var(--brand-soft);color:var(--brand);box-shadow:none" data-act="edit-order" data-oid="${esc(o.id)}" aria-label="\u7F16\u8F91 ${esc(o.store)}" title="\u7F16\u8F91\u8BA2\u5355"><svg class="ic" viewBox="0 0 24 24"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/></svg></button>
      </div>
    </div>`).join("") : `<div class="empty"><div class="e-ic">\u{1F50D}</div>\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u8BA2\u5355</div>`;
  $("#v-orders").innerHTML = `
    <div class="htop-row">
      <div><div class="eyebrow">\u5DE5\u4F5C \xD7 \u6536\u6B3E \u53CC\u8F68\u72B6\u6001</div><h1 class="big">\u8BA2\u5355</h1></div>
      <div style="display:flex;gap:8px;align-items:center">${headBtns(false)}
        <button class="btn-pill" data-act="new-order"><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>\u9884\u7EA6</button></div>
    </div>
    ${accChipbarHTML()}
    <div class="search"><svg class="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
      <input id="q-input" placeholder="\u641C\u7D22\u5546\u5BB6 / \u5730\u70B9 / \u8054\u7CFB\u4EBA / \u5907\u6CE8" value="${esc(ui.q)}"></div>
    <div class="chips">${chips}</div>
    <div class="card rows">${rows}</div>`;
  initOrderSwipeActions();
  const qi = $("#q-input");
  let composing = false;
  const search = (value) => {
    ui.q = value;
    const pos = qi.selectionStart;
    renderOrders();
    const q22 = $("#q-input");
    q22.focus();
    q22.setSelectionRange(pos, pos);
  };
  qi.addEventListener("compositionstart", () => {
    composing = true;
  });
  qi.addEventListener("compositionend", () => {
    composing = false;
    search(qi.value);
  });
  qi.addEventListener("input", (e) => {
    if (e.isComposing || composing) return;
    search(e.target.value);
  });
}
function initOrderSwipeActions() {
  document.querySelectorAll("#v-orders .order-swipe").forEach((item) => {
    const track = item.querySelector(".order-swipe-track");
    let start = null;
    track.addEventListener("touchstart", (event) => {
      if (event.touches.length !== 1 || event.target.closest?.("button,input,textarea,select")) {
        start = null;
        return;
      }
      document.querySelectorAll("#v-orders .order-swipe.open").forEach((other) => {
        if (other !== item) other.classList.remove("open");
      });
      const touch = event.touches[0];
      start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, base: item.classList.contains("open") ? -78 : 0, swiped: false };
    }, { passive: true });
    track.addEventListener("touchmove", (event) => {
      if (!start || event.touches.length !== 1) {
        start = null;
        return;
      }
      const touch = Array.from(event.touches).find((item2) => item2.identifier === start.id);
      if (!touch) return;
      const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
      if (!start.swiped && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) start.swiped = true;
      if (!start.swiped) return;
      event.preventDefault();
      const offset = Math.max(-78, Math.min(0, start.base + dx));
      track.style.transition = "none";
      track.style.transform = `translateX(${offset}px)`;
    }, { passive: false });
    track.addEventListener("touchend", (event) => {
      if (!start) return;
      const touch = Array.from(event.changedTouches).find((item2) => item2.identifier === start.id);
      if (!touch) {
        start = null;
        return;
      }
      const dx = touch.clientX - start.x, swiped = start.swiped;
      start = null;
      track.style.transition = "";
      track.style.transform = "";
      if (!swiped) return;
      event.preventDefault();
      if (dx < -32) item.classList.add("open");
      else if (dx > 24) item.classList.remove("open");
    }, { passive: false });
    track.addEventListener("touchcancel", () => {
      start = null;
      track.style.transition = "";
      track.style.transform = "";
    }, { passive: true });
  });
}

// src/app/views/pay.js
var fmtMoney5 = (n) => fmtMoney(n, ui.privacy);
function renderPay() {
  const rows0 = db.orders.filter(accMatch).filter((o) => owedOf(o) > 0);
  const unDepSum = rows0.reduce((s, o) => s + unDep(o), 0);
  const unFinSum = rows0.reduce((s, o) => s + unFin(o), 0);
  const dySum = rows0.filter((o) => o.settleVia === "douyin").reduce((s, o) => s + unFin(o), 0);
  const overAll = db.orders.filter(accMatch).filter(isOver);
  const over = overAll.filter((o) => !snoozed(o));
  const overSum = over.reduce((s, o) => s + unFin(o), 0);
  const bucket = (o) => {
    const d = overdueDays(o);
    return d > 30 ? "g30" : d > 7 ? "m830" : "s7";
  };
  const rows = rows0.filter((o) => ui.bucket === "all" || (ui.bucket === "over" ? isOver(o) && !snoozed(o) : ui.bucket === "snoozed" ? isOver(o) && snoozed(o) : bucket(o) === ui.bucket)).sort((a, b) => snoozed(a) - snoozed(b) || overdueDays(b) - overdueDays(a) || a.appt.localeCompare(b.appt));
  const listHtml = rows.length ? rows.map((o) => {
    const d = overdueDays(o), isDep = unDep(o) > 0 && !isOver(o), isDy = o.settleVia === "douyin", sn = snoozed(o);
    const late = isDy ? expectOverdue(o) : 0;
    const dyNote = isDy && o.expectPayAt ? ` \xB7 \u9884\u8BA1 ${fmtD(o.expectPayAt)} \u5230\u8D26${late > 0 ? `(\u5DF2\u8D85 ${late} \u5929)` : ""}` : "";
    const due = isDep ? { kind: "deposit", amt: unDep(o), sub: `\u9884\u7EA6 ${fmtD(o.appt)} ${fmtHM(o.appt)} \xB7 \u5B9A\u91D1`, btn: "\u6807\u8BB0\u5DF2\u6536" } : isDy ? { kind: "final", amt: unFin(o), sub: `${o.shotAt ? "\u62CD\u6444 " + fmtD(o.shotAt) : "\u5F85\u62CD\u6444"} \xB7 \u6296\u97F3\u5546\u5355\u7ED3\u7B97${dyNote}`, btn: "\u6807\u8BB0\u5230\u8D26" } : { kind: "final", amt: unFin(o), sub: `${o.shotAt ? "\u62CD\u6444 " + fmtD(o.shotAt) : "\u9884\u7EA6 " + fmtD(o.appt)} \xB7 ${workOf(o)}`, btn: "\u6807\u8BB0\u5DF2\u6536" };
    const chip = isDep ? '<span class="chip c-gray">\u5F85\u5B9A\u91D1</span>' : isDy ? `<span class="chip ${late > 0 ? "c-red" : "c-blue"}">\u5E73\u53F0\u7ED3\u7B97${o.expectPayAt ? ` \xB7 ${fmtD(o.expectPayAt)}${late > 0 ? " \u5DF2\u8D85\u671F" : ""}` : ""}</span>` : isOver(o) ? sn ? `<span class="chip c-gray">\u5DF2\u8BBE\u63D0\u9192 \xB7 ${fmtD(o.remindAt)}\u518D\u50AC</span>` : `<span class="chip c-red">\u903E\u671F \xB7 \u6B20 ${d} \u5929</span>` : `<span class="chip ${d > 7 ? "c-orange" : "c-gray"}">${o.shotAt ? "\u6B20\u6B3E " + d + " \u5929" : "\u672A\u62CD\u6444 \xB7 \u5C1A\u672A\u8D77\u7B97\u8D26\u671F"}</span>`;
    return `<div class="row${accBar(o)}" style="${accTint(o)}" data-act="open" data-oid="${o.id}">
      <div class="rmain"><div class="rname">${esc(o.store)}</div>
        <div class="rsub">${due.sub} ${fmtMoney5(due.amt)}</div>
        <div class="chiprow">${accOrderTag(o)}${chip}${!isDep && unDep(o) > 0 ? `<span class="chip c-gray">\u53E6\u5F85\u5B9A\u91D1 ${fmtMoney5(unDep(o))}</span>` : ""}</div>
      </div>
      <button class="mini-btn green" data-act="open-pay" data-oid="${o.id}" data-kind="${due.kind}">${due.btn}</button>
    </div>`;
  }).join("") : `<div class="empty"><div class="e-ic">\u2705</div>\u8BE5\u533A\u95F4\u6682\u65E0\u5F85\u6536\u6B3E</div>`;
  const flow = [...db.payments].filter((p) => accOrderIds().has(p.oid)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8).map((p) => {
    const po = db.orders.find((x) => x.id === p.oid);
    return `<div class="row${accBar(po)}" style="${accTint(po)}">
      <div class="rmain"><div class="rname" style="font-size:14px">+${fmtMoney5(p.amount)} \xB7 ${esc(storeOf(p.oid))}</div>
        <div class="rsub">${esc(p.kind)} \xB7 ${fmtD(p.at)} ${fmtHM(p.at)}${accMulti() ? ` \xB7 ${accTagHTML(po ? accById(po.accountId) : null)}` : ""}</div></div>
      <span class="chip ${METHOD_CLS[p.method] || "c-gray"}">${esc(p.method)}</span>
    </div>`;
  }).join("");
  $("#v-pay").innerHTML = `
    <div class="htop-row"><div><div class="eyebrow">\u8D44\u91D1\u7EBF \xB7 \u8D26\u671F\u81EA\u5B9E\u9645\u62CD\u6444\u65E5\u8D77\u7B97</div><h1 class="big">\u6536\u6B3E</h1></div>
    <div style="display:flex;gap:8px">${headBtns(false)}</div></div>
    ${accChipbarHTML()}
    <div class="card" style="padding:16px;margin-bottom:12px">
      <div style="font-size:12px;color:var(--sub)">\u5F85\u6536\u6B3E\u603B\u989D</div>
      <div style="font-size:32px;font-weight:800;letter-spacing:.3px;margin:4px 0 2px">${fmtMoney5(unDepSum + unFinSum)}</div>
      <div class="chiprow">
        <span class="chip c-orange">\u5C3E\u6B3E\xB7\u79C1\u6536 ${fmtMoney5(unFinSum - dySum)}</span>
        ${dySum > 0 ? `<span class="chip c-blue">\u6296\u97F3\u5546\u5355 ${fmtMoney5(dySum)}</span>` : ""}
        <span class="chip c-gray">\u5B9A\u91D1 ${fmtMoney5(unDepSum)}</span>
        ${over.length ? `<span class="chip c-red">\u903E\u671F ${over.length} \u7B14 \xB7 ${fmtMoney5(overSum)}</span>` : '<span class="chip c-green">\u65E0\u903E\u671F</span>'}
        ${overAll.length > over.length ? `<span class="chip c-gray">${overAll.length - over.length} \u7B14\u5DF2\u8BBE\u63D0\u9192</span>` : ""}
      </div>
    </div>
    <div class="seg" style="margin-bottom:12px">
      ${[["all", "\u5168\u90E8"], ["s7", "\u22647\u5929"], ["m830", "8\u201330\u5929"], ["g30", "30\u5929+"]].map(([k, l]) => `<button class="${ui.bucket === k ? "on" : ""}" data-act="bucket" data-bucket="${k}">${l}</button>`).join("")}
    </div>
    <div class="chips" style="margin-bottom:12px"><button class="fchip ${ui.bucket === "over" ? "on" : ""}" data-act="bucket" data-bucket="over">\u5F85\u50AC\u6536 ${over.length}</button><button class="fchip ${ui.bucket === "snoozed" ? "on" : ""}" data-act="bucket" data-bucket="snoozed">\u5DF2\u8BBE\u63D0\u9192 ${overAll.length - over.length}</button></div>
    <div class="card rows">${listHtml}</div>
    <div class="sec-title">\u6536\u6B3E\u6D41\u6C34 <span class="more" data-act="export-csv">\u5BFC\u51FA \u203A</span></div>
    <div class="card rows">${flow || '<div class="empty">\u6682\u65E0\u6536\u6B3E\u8BB0\u5F55</div>'}</div>`;
}

// src/app/views/stats.js
var fmtMoney6 = (n) => fmtMoney(n, ui.privacy);
function accountSectionHtml() {
  const accs = ACCS();
  if (!accs.length) return `<div class="menu-row" data-act="open-account">
    <span class="menu-ic" style="background:var(--brand-soft);color:var(--brand)"><svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5.5 19.5c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/></svg></span>
    <div class="menu-t"><div class="menu-name">\u6DFB\u52A0\u8D26\u53F7</div><div class="menu-sub">\u591A\u8D26\u53F7\u8FBE\u4EBA:\u8BA2\u5355\u6302\u8D26\u53F7\u3001\u8D44\u6599\u4E00\u952E\u62F7\u8D1D\u53BB\u62A5\u540D;\u5355\u8D26\u53F7\u6570\u636E\u81EA\u52A8\u5F52\u5C5E,\u754C\u9762\u96F6\u6253\u6270</div></div>
    <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg></div>`;
  let html = "";
  for (const a of accs) {
    const c = accColor(a);
    const n = db.orders.filter((o) => o.accountId === a.id).length;
    html += `<div class="row" style="background:${c.bg};border-radius:14px;align-items:center;gap:12px">
      ${accAvatarHTML(a)}
      <div style="flex:1;min-width:0"><div class="rname" style="font-size:14.5px">${esc(a.name)}</div>
        <div class="rsub">\u6296\u97F3:${esc(a.douyin || "\u2014")} \xB7 \u624B\u673A ${esc(a.phone || "\u2014")} \xB7 ${n} \u5355</div></div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="mini-btn" data-act="copy-account" data-id="${a.id}">\u62F7\u8D1D</button>
        <button class="mini-btn" style="background:rgba(0,0,0,.06);color:#55555e" data-act="open-account" data-id="${a.id}">\u7F16\u8F91</button></div>
    </div>`;
  }
  const unassigned = accMulti() ? db.orders.filter((o) => o.accountId == null).length : 0;
  if (unassigned) html += `<div class="row" style="align-items:center;gap:10px">
    <div class="rmain"><div class="rsub" style="color:var(--orange)">${unassigned} \u7B14\u8BA2\u5355\u672A\u6307\u5B9A\u8D26\u53F7(\u542B\u5386\u53F2\u5355)</div></div>
    <button class="mini-btn" data-act="assign-open">\u6279\u91CF\u6539\u6302</button></div>`;
  return html;
}
function renderStats() {
  const st = statsFor(ui.period, db.orders.filter(accMatch));
  const avg = st.deals.length ? Math.round(st.dealSum / st.deals.length * 100) / 100 : 0;
  let days = [];
  if (ui.period === "M") {
    const e = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (let d = new Date(st.start); d <= e; d.setDate(d.getDate() + 1)) days.push(toISO(d));
  } else {
    for (let i = +ui.period - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(toISO(d));
    }
  }
  const daily = days.map((d) => st.paid.filter((p) => p.at.slice(0, 10) === d).reduce((s, p) => s + Math.round(p.amount * 100), 0) / 100);
  const mx = Math.max(...daily, 1);
  const bars = daily.map((v, i) => `<div class="bar ${v ? "" : "zero"}" title="${days[i]} \u5B9E\u6536 ${fmtMoney6(v)}"><i style="height:${Math.max(3, Math.round(v / mx * 100))}%"></i></div>`).join("");
  const totOwed = db.orders.filter(accMatch).reduce((s, o) => s + owedOf(o), 0);
  const sending = db.orders.filter(accMatch).filter((o) => ["\u540E\u671F\u4E2D", "\u53D1\u7247\u4E2D"].includes(workOf(o))).length;
  const segP = [["7", "\u8FD17\u5929"], ["30", "\u8FD130\u5929"], ["M", "\u672C\u6708"]].map(([k, l]) => `<button class="${ui.period === k ? "on" : ""}" data-act="period" data-period="${k}">${l}</button>`).join("");
  const byM = /* @__PURE__ */ Object.create(null);
  st.paid.forEach((p) => {
    byM[p.method] = (byM[p.method] || 0) + p.amount;
  });
  const entries = Object.entries(byM).sort((a, b) => b[1] - a[1]);
  const mxm = Math.max(...entries.map((e) => e[1]), 1);
  const chRows = entries.length ? entries.map(([m, v]) => `
    <div class="row" style="padding:9px 0">
      <span class="chip ${METHOD_CLS[m] || "c-gray"}" style="width:70px;justify-content:center">${esc(m)}</span>
      <div style="flex:1;height:8px;background:#F0F0F4;border-radius:4px;overflow:hidden"><i style="display:block;height:100%;width:${Math.max(4, Math.round(v / mxm * 100))}%;background:var(--brand);border-radius:4px"></i></div>
      <div class="rside" style="min-width:74px"><div class="rprice" style="font-size:13.5px">${fmtMoney6(v)}</div></div>
    </div>`).join("") : '<div class="empty" style="padding:18px 0">\u8BE5\u533A\u95F4\u6682\u65E0\u6536\u6B3E</div>';
  $("#v-stats").innerHTML = `
    <div class="htop-row"><div><div class="eyebrow">\u5B9E\u65F6\u7EDF\u8BA1 \xB7 \u6253\u5F00\u5373\u5237\u65B0</div><h1 class="big">\u7EDF\u8BA1</h1></div>
    <div style="display:flex;gap:8px">${headBtns(false)}</div></div>
    ${accChipbarHTML()}
    <div class="seg" style="margin-bottom:14px">${segP}</div>
    <div class="mini-grid">
      <div class="mini"><div class="mv">${fmtMoney6(st.dealSum)}</div><div class="ml">\u6210\u4EA4\u989D \xB7 ${st.deals.length} \u5355</div></div>
      <div class="mini"><div class="mv" style="color:#239648">${fmtMoney6(st.paidSum)}</div><div class="ml">\u5B9E\u6536\u91D1\u989D \xB7 ${st.paid.length} \u7B14</div></div>
      <div class="mini"><div class="mv" style="color:var(--brand)">${st.done.length} \u5355</div><div class="ml">\u5DF2\u4EA4\u4ED8\u5B8C\u7ED3(\u6309\u4EA4\u4ED8\u65E5)</div></div>
      <div class="mini"><div class="mv">${fmtMoney6(avg)}</div><div class="ml">\u5BA2\u5355\u4EF7</div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:14px;font-weight:800">\u6BCF\u65E5\u5B9E\u6536</span>
        <span style="font-size:11.5px;color:var(--sub)">${ui.period === "M" ? "\u672C\u6708" : "\u8FD1" + ui.period + "\u5929"}\u5408\u8BA1 <b style="color:#239648;font-size:13px">${fmtMoney6(st.paidSum)}</b></span>
      </div>
      <div class="bars">${bars}</div>
      <div class="bar-x"><span>${fmtD(days[0])}</span><span>${fmtD(days[days.length - 1])}</span></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:14px;font-weight:800">\u6536\u6B3E\u6E20\u9053\u6784\u6210</span>
        <span style="font-size:11.5px;color:var(--sub)">${ui.period === "M" ? "\u672C\u6708" : "\u8FD1" + ui.period + "\u5929"}</span>
      </div>
      <div style="margin-top:4px">${chRows}</div>
    </div>
    <div class="card rows" style="margin-top:14px">
      <div class="row"><div class="rmain"><div class="rname" style="font-size:14px">\u5F53\u524D\u5F85\u6536\u6B3E</div><div class="rsub">\u542B\u5B9A\u91D1\u4E0E\u5C3E\u6B3E</div></div>
        <div class="rside"><div class="rprice" style="color:var(--red)">${fmtMoney6(totOwed)}</div></div></div>
      <div class="row"><div class="rmain"><div class="rname" style="font-size:14px">\u5F85\u53D1\u7247\u8BA2\u5355</div><div class="rsub">\u540E\u671F\u4E2D / \u53D1\u7247\u4E2D</div></div>
        <div class="rside"><div class="rprice" style="color:var(--orange)">${sending} \u5355</div></div></div>
    </div>
    <div class="sec-title">\u6211\u7684\u8D26\u53F7 <span class="more" data-act="open-account">+ \u6DFB\u52A0 \u203A</span></div>
    <div class="card rows">${accountSectionHtml()}</div>
    <div class="sec-title">\u6570\u636E\u7BA1\u7406(\u672C\u673A SQLite \u5B58\u50A8)</div>
    <div class="card rows">
      <div class="menu-row" data-act="open-schema">
        <span class="menu-ic" style="background:var(--blue-soft);color:var(--blue)"><svg class="ic" viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/></svg></span>
        <div class="menu-t"><div class="menu-name">\u6570\u636E\u7ED3\u6784 \xB7 SQLite</div><div class="menu-sub">orders / payments / settings,\u771F\u5B9E .db \u5B58\u4E8E\u672C\u673A,\u53EF\u5BFC\u51FA\u8FC1\u79FB</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </div>
      <div class="menu-row">
        <span class="menu-ic" style="background:var(--orange-soft);color:#E8850A"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/></svg></span>
        <div class="menu-t"><div class="menu-name">\u5C3E\u6B3E\u50AC\u6536\u9608\u503C</div><div class="menu-sub">\u8D85\u8FC7\u8BE5\u5929\u6570\u672A\u6536\u5C3E\u6B3E\u5373\u6807\u8BB0\u300C\u5DF2\u903E\u671F\u300D;\u63D0\u9192\u4EE5\u6253\u5F00 App \u67E5\u770B\u4E3A\u51C6</div></div>
        <div class="stepper">
          <button data-act="th" data-v="-1">\u2212</button><span>${db.threshold} \u5929</span><button data-act="th" data-v="1">+</button>
        </div>
      </div>
      <div class="menu-row" data-act="export-db">
        <span class="menu-ic" style="background:var(--blue-soft);color:var(--blue)"><svg class="ic" viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/></svg></span>
        <div class="menu-t"><div class="menu-name">\u5BFC\u51FA SQLite \u6570\u636E\u5E93(.db)</div><div class="menu-sub">\u5B8C\u6574\u6570\u636E\u5E93\u6587\u4EF6,\u53EF\u7528\u4EFB\u610F SQLite \u5DE5\u5177\u6253\u5F00</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </div>
      <div class="menu-row" data-act="export-csv">
        <span class="menu-ic" style="background:var(--green-soft);color:#239648"><svg class="ic" viewBox="0 0 24 24"><path d="M12 4v11M7.5 11l4.5 4.5L16.5 11"/><path d="M4.5 19.5h15"/></svg></span>
        <div class="menu-t"><div class="menu-name">\u5BFC\u51FA CSV</div><div class="menu-sub">\u8BA2\u5355\u8868 + \u6536\u6B3E\u6D41\u6C34,Excel / Numbers \u53EF\u76F4\u63A5\u6253\u5F00</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </div>
      <div class="menu-row" data-act="export-json">
        <span class="menu-ic" style="background:var(--purple-soft);color:var(--purple)"><svg class="ic" viewBox="0 0 24 24"><path d="M8 4.5H6A2.5 2.5 0 0 0 3.5 7v3A2.5 2.5 0 0 1 1 12.5 2.5 2.5 0 0 1 3.5 15v3A2.5 2.5 0 0 0 6 20.5h2M16 4.5h2A2.5 2.5 0 0 1 20.5 7v3a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0-2.5 2.5v3a2.5 2.5 0 0 1-2.5 2.5h-2"/></svg></span>
        <div class="menu-t"><div class="menu-name">\u5BFC\u51FA JSON \u5907\u4EFD</div><div class="menu-sub">\u542B\u8BA2\u5355 + \u6536\u6B3E\u6D41\u6C34 + \u8BBE\u7F6E,\u53EF\u7528\u4E8E\u8FC1\u79FB</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </div>
      <div class="menu-row" data-act="import-json" role="button" tabindex="0">
        <div class="menu-t"><div class="menu-name">\u5BFC\u5165 JSON \u5907\u4EFD</div><div class="menu-sub">\u9884\u89C8\u540E\u6062\u590D\u8BA2\u5355\u3001\u6D41\u6C34\u4E0E\u8BBE\u7F6E\uFF1B\u66FF\u6362\u524D\u81EA\u52A8\u5907\u4EFD</div></div>
      </div>
      <div class="menu-row" data-act="restore-backup" role="button" tabindex="0">
        <div class="menu-t"><div class="menu-name">\u6062\u590D\u66FF\u6362\u524D\u7684\u6570\u636E</div><div class="menu-sub">\u64A4\u56DE\u6700\u8FD1\u4E00\u6B21\u5BFC\u5165\u6216\u6E05\u7A7A\uFF0C\u4EC5\u4FDD\u7559\u6700\u8FD1\u4E00\u4EFD</div></div>
      </div>
      ${isNative ? `<div class="menu-row" data-act="notify-toggle" role="button" tabindex="0">
        <span class="menu-ic" style="background:var(--blue-soft);color:var(--blue)"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg></span>
        <div class="menu-t"><div class="menu-name">\u903E\u671F\u50AC\u6536\u6BCF\u65E5\u63D0\u9192</div><div class="menu-sub">\u6BCF\u5929 09:00 \u672C\u5730\u901A\u77E5 \xB7 \u53EA\u62A5\u6761\u6570\u4E0E\u6700\u957F\u5929\u6570,\u4E0D\u542B\u91D1\u989D</div></div>
        <span class="tag-badge">${db.notifyEnabled === false ? "\u5DF2\u5173\u95ED" : "\u5DF2\u5F00\u542F"}</span>
      </div>` : ""}
      <div class="menu-row" data-act="switch-mode" role="button" tabindex="0">
        <div class="menu-t"><div class="menu-name">${Store.mode === "demo" ? "\u8FDB\u5165\u5DE5\u4F5C\u6570\u636E" : "\u5207\u6362\u5230\u6F14\u793A\u6570\u636E"}</div><div class="menu-sub">\u5F53\u524D\u4E3A${Store.mode === "demo" ? "\u6F14\u793A" : "\u5DE5\u4F5C"}\u6570\u636E\uFF1B\u4E24\u5957\u6570\u636E\u72EC\u7ACB\u4FDD\u5B58\uFF0C\u4E92\u4E0D\u8986\u76D6</div></div>
      </div>
      <div class="menu-row" data-act="clear-data" role="button" tabindex="0">
        <div class="menu-t"><div class="menu-name" style="color:var(--red)">\u6E05\u7A7A\u5F53\u524D${Store.mode === "demo" ? "\u6F14\u793A" : "\u5DE5\u4F5C"}\u6570\u636E</div><div class="menu-sub">\u9700\u786E\u8BA4\uFF1B\u6E05\u7A7A\u8BA2\u5355\u4E0E\u6D41\u6C34\uFF0C\u8D26\u53F7\u4E0E\u8BBE\u7F6E\u4FDD\u7559\uFF1B\u66FF\u6362\u524D\u81EA\u52A8\u5907\u4EFD\uFF0C\u4E0D\u5F71\u54CD\u53E6\u4E00\u5957\u6570\u636E</div></div>
      </div>
      <div class="rsub" style="text-align:center;padding:10px 0 2px;color:#B9B9C0;white-space:normal">\u63A2\u8BB0 TanJi v0.6 \xB7 \u6570\u636E\u4EC5\u5B58\u672C\u673A\uFF0C\u8BF7\u5B9A\u671F\u5BFC\u51FA\u5907\u4EFD</div>
    </div>
    <div class="sec-title">\u5173\u4E8E</div>
    <div class="card rows">
      <a class="menu-row" href="${LEGAL_BASE}privacy.html" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        <span class="menu-ic" style="background:var(--blue-soft);color:var(--blue)"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3l7.5 3v6c0 4.4-3.1 8.2-7.5 9.5C7.6 20.2 4.5 16.4 4.5 12V6L12 3z"/></svg></span>
        <div class="menu-t"><div class="menu-name">\u9690\u79C1\u653F\u7B56</div><div class="menu-sub">\u7EAF\u672C\u5730\u8FD0\u884C \xB7 \u4E0D\u6536\u96C6\u3001\u4E0D\u4E0A\u4F20\u4EFB\u4F55\u6570\u636E</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </a>
      <a class="menu-row" href="${LEGAL_BASE}support.html" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        <span class="menu-ic" style="background:var(--green-soft);color:#239648"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg></span>
        <div class="menu-t"><div class="menu-name">\u652F\u6301\u4E0E\u5E38\u89C1\u95EE\u9898</div><div class="menu-sub">\u5907\u4EFD\u3001\u8FC1\u79FB\u3001\u901A\u77E5\u4E0E\u5BFC\u51FA\u95EE\u9898</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </a>
      ${APP_STORE_URL ? `<a class="menu-row" href="${APP_STORE_URL}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        <span class="menu-ic" style="background:var(--brand-soft);color:var(--brand)"><svg class="ic" viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg></span>
        <div class="menu-t"><div class="menu-name">iOS \u539F\u751F\u7248 \xB7 \u4E70\u65AD</div><div class="menu-sub">\u79BB\u7EBF\u66F4\u7A33 \xB7 \u63A8\u9001\u66F4\u65B0 \xB7 \u672C\u5730\u901A\u77E5\u63D0\u9192</div></div>
        <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>
      </a>` : `<div class="menu-row" data-act="app-store-soon">
        <span class="menu-ic" style="background:var(--brand-soft);color:var(--brand)"><svg class="ic" viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg></span>
        <div class="menu-t"><div class="menu-name">iOS \u539F\u751F\u7248 \xB7 \u4E70\u65AD</div><div class="menu-sub">\u79BB\u7EBF\u66F4\u7A33 \xB7 \u63A8\u9001\u66F4\u65B0 \xB7 \u672C\u5730\u901A\u77E5\u63D0\u9192</div></div>
        <span class="tag-badge">\u5373\u5C06\u4E0A\u67B6</span>
      </div>`}
    </div>`;
}

// src/app/views/trip.js
var fmtMoney7 = (n) => fmtMoney(n, ui.privacy);
function orderRowTrip(o) {
  const depChip = unDep(o) > 0 ? `<span class="chip c-red">\u5F85\u5B9A\u91D1 ${fmtMoney7(unDep(o))}</span>` : "";
  return `<div class="row trip-row${accBar(o)}" style="${accTint(o)}" data-act="open" data-oid="${o.id}">
    <div class="trip-row-head">
      <div class="rside" style="width:52px"><div class="rprice" style="color:var(--brand)">${fmtHM(o.appt)}</div><div class="rsub" style="margin:0">${esc(o.cat)}</div></div>
      <div class="rmain"><div class="rname">${esc(o.store)}</div>${o.location ? `<div class="rsub trip-place">${esc(o.location)}</div>` : ""}</div>
      <div class="rside"><div class="rprice">${fmtMoney7(o.price)}</div><div class="rsub">${owedOf(o) > 0 ? "\u5F85\u6536 " + fmtMoney7(owedOf(o)) : "\u5DF2\u7ED3\u6E05"}</div></div>
      <button class="icon-btn" style="width:40px;height:40px;background:var(--brand-soft);color:var(--brand);box-shadow:none" data-act="edit-order" data-oid="${esc(o.id)}" aria-label="\u7F16\u8F91 ${esc(o.store)}" title="\u7F16\u8F91\u8BA2\u5355"><svg class="ic" viewBox="0 0 24 24"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/></svg></button>
    </div>
    <div class="chiprow trip-chips">${accOrderTag(o)}${workChip(o)}${depChip || payChip(o)}${o.channel && o.channel !== "\u76F4\u5BA2" ? `<span class="chip c-gray">${esc(o.channel)}</span>` : ""}</div>
  </div>`;
}
function renderTrip() {
  const { y, m } = ui.vMon;
  const first = new Date(y, m - 1, 1);
  const off = (first.getDay() + 6) % 7;
  const dim = new Date(y, m, 0).getDate();
  const mOrders = db.orders.filter(accMatch).filter((o) => +o.appt.slice(0, 4) === y && +o.appt.slice(5, 7) === m);
  const mSum = mOrders.reduce((s, o) => s + o.price, 0);
  const mPrefix = `${y}-${pad(m)}`;
  const mPaidSum = db.payments.filter((p) => accOrderIds().has(p.oid) && String(p.at || "").slice(0, 7) === mPrefix).reduce((s, p) => s + p.amount, 0);
  const byDay = {};
  mOrders.forEach((o) => {
    const k = o.appt.slice(0, 10);
    if (!byDay[k]) byDay[k] = { n: 0, s: 0 };
    byDay[k].n++;
    byDay[k].s += o.price;
  });
  let bFire = 0, bMoney = 0;
  Object.values(byDay).forEach((v) => {
    const b = dayBadge(v.n, v.s);
    if (b && b.e === "\u{1F525}") bFire++;
    if (b && b.e === "\u{1F4B0}") bMoney++;
  });
  const mBadges = (bFire ? " \u{1F525}" + bFire : "") + (bMoney ? " \u{1F4B0}" + bMoney : "");
  let cells = "";
  for (let i = 0; i < off; i++) cells += '<div class="mc"></div>';
  for (let d = 1; d <= dim; d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const ds = mOrders.filter((o) => o.appt.slice(0, 10) === iso);
    const dv = byDay[iso] || { n: 0, s: 0 };
    const bdg = dayBadge(dv.n, dv.s);
    cells += `<button class="mc ${iso === ui.selDay ? "sel" : ""} ${iso === TODAY ? "today" : ""}" data-act="day" data-day="${iso}" title="${bdg ? bdg.t : ""}">
      <span class="n">${d}</span><span class="d">${ds.length ? "<i></i>".repeat(Math.min(ds.length, 6)) : ""}</span>${bdg ? `<span class="bdg">${bdg.e}</span>` : ""}</button>`;
  }
  const list = db.orders.filter(accMatch).filter((o) => o.appt.slice(0, 10) === ui.selDay).sort((a, b) => a.appt.localeCompare(b.appt));
  const listHtml = list.length ? list.map(orderRowTrip).join("") : `<div class="empty"><div class="e-ic">\u{1F4ED}</div>\u8FD9\u4E00\u5929\u6682\u65E0\u62CD\u6444\u5B89\u6392</div>`;
  const tomorrow = dOff(1).slice(0, 10);
  let up = "";
  const mdays = [...new Set(mOrders.map((o) => o.appt.slice(0, 10)))].sort();
  for (const iso of mdays) {
    const ds = mOrders.filter((o) => o.appt.slice(0, 10) === iso).sort((a, b) => a.appt.localeCompare(b.appt));
    const d = /* @__PURE__ */ new Date(iso + "T00:00");
    const tag = iso === TODAY ? " \xB7 \u4ECA\u5929" : iso === tomorrow ? " \xB7 \u660E\u5929" : "";
    up += `<div class="sec-title">${d.getMonth() + 1}\u6708${d.getDate()}\u65E5 \u5468${dowOf(iso)}${tag}</div>
    <div class="card rows">${ds.map(orderRowTrip).join("")}</div>`;
  }
  if (!up) up = `<div class="empty">${m}\u6708\u6682\u65E0\u6863\u671F \xB7 \u70B9\u53F3\u4E0A\u89D2\u300C\u9884\u7EA6\u300D\u65B0\u589E</div>`;
  const week = upcoming7(), weekCount = week.reduce((s, d) => s + d.count, 0), weekSum = week.reduce((s, d) => s + d.sum, 0);
  const weekHtml = `<div class="sec-title" style="margin-top:14px;margin-bottom:6px"><span>\u672A\u6765 7 \u5929${weekCount ? ` \xB7 ${weekCount} \u5355` : " \xB7 \u6682\u65E0\u6863\u671F"}</span>${weekSum ? `<span style="font-weight:600">${esc(fmtMoney7(weekSum))}</span>` : ""}</div>
    <div class="n7">${week.map((d, i) => {
    const wd = i === 0 ? "\u4ECA\u5929" : i === 1 ? "\u660E\u5929" : `\u5468${dowOf(d.day)}`;
    return `<button class="n7d ${d.day === ui.selDay ? "on" : ""}" data-act="day" data-day="${d.day}">
        <div class="w">${wd}</div><div class="d">${d.day.slice(5, 7)}-${d.day.slice(8, 10)}</div><div class="c">${d.count ? `${d.count} \u5355` : "\u7A7A"}</div></button>`;
  }).join("")}</div>`;
  $("#v-trip").innerHTML = `
    <div class="htop-row">
      <div><div class="eyebrow">\u6574\u6708\u6863\u671F \xB7 \u2039 \u203A \u53EF\u7FFB\u6708</div><h1 class="big">\u884C\u7A0B</h1>
      <div class="hsub">\u5DE6\u53F3\u6ED1\u52A8\u5207\u65E5 \xB7 \u70B9\u65E5\u671F\u67E5\u770B \xB7 \u5206\u4EAB\u751F\u6210\u5F53\u65E5\u884C\u7A0B\u56FE</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        ${headBtns(true)}
        <button class="btn-pill" data-act="new-order"><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>\u9884\u7EA6</button>
      </div>
    </div>
    ${accChipbarHTML()}
    <div class="mgrid">
      <div class="mhead">
        <div class="mtitle">${y}\u5E74${m}\u6708<span class="msum">${mOrders.length} \u4E2A\u6863\u671F \xB7 \u6210\u4EA4 ${fmtMoney7(mSum)} \xB7 \u5B9E\u6536 ${fmtMoney7(mPaidSum)}${mBadges}</span></div>
        <div class="mnav">
          <button data-act="mnav" data-d="-1">\u2039</button>
          <button data-act="mtoday" class="mtod">\u4ECA\u5929</button>
          <button data-act="mnav" data-d="1">\u203A</button>
        </div>
      </div>
      <div class="mgrid-dow">${"\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u65E5".split("").map((x) => `<span>\u5468${x}</span>`).join("")}</div>
      <div class="mgrid-c">${cells}</div>
    </div>
    ${weekHtml}
    <div class="sec-title">${ui.selDay === TODAY ? "\u4ECA\u65E5\u884C\u7A0B" : `${+ui.selDay.slice(5, 7)}\u6708${+ui.selDay.slice(8, 10)}\u65E5 \u5468${dowOf(ui.selDay)}`}${list.length && dayBadge(list.length, list.reduce((s, o) => s + o.price, 0)) ? ` \xB7 ${dayBadge(list.length, list.reduce((s, o) => s + o.price, 0)).e} ${dayBadge(list.length, list.reduce((s, o) => s + o.price, 0)).t}` : ""}</div>
    <div class="card rows">${listHtml}</div>
    <div class="sec-title">${m}\u6708\u5168\u90E8\u6863\u671F \xB7 \u5F80\u4E0B\u6EDA\u770B\u6574\u6708</div>
    ${up}`;
}
function tripSwipeStep(dx, dy, duration) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (duration < 0 || duration > 800 || ax < 56 || ay > 48 || ax < ay * 1.35) return 0;
  return dx < 0 ? 1 : -1;
}
function shiftTripDay(step) {
  if (step !== 1 && step !== -1) return;
  const date = /* @__PURE__ */ new Date(ui.selDay + "T00:00:00");
  if (Number.isNaN(date.getTime())) return;
  date.setDate(date.getDate() + step);
  ui.selDay = toISO(date);
  ui.vMon = { y: date.getFullYear(), m: date.getMonth() + 1 };
  renderTrip();
}
function initTripGestures() {
  const view = $("#v-trip");
  if (!view) return;
  let start = null;
  const reset = () => {
    start = null;
  };
  view.addEventListener("touchstart", (event) => {
    if (ui.tab !== "trip" || event.touches.length !== 1 || event.target.closest?.(".n7,.chipbar")) {
      reset();
      return;
    }
    const touch = event.touches[0];
    start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, at: event.timeStamp };
  }, { passive: true });
  view.addEventListener("touchmove", (event) => {
    if (start && event.touches.length !== 1) reset();
  }, { passive: true });
  view.addEventListener("touchend", (event) => {
    if (!start || ui.tab !== "trip") {
      reset();
      return;
    }
    const touch = Array.from(event.changedTouches).find((item) => item.identifier === start.id);
    if (!touch) {
      reset();
      return;
    }
    const step = tripSwipeStep(touch.clientX - start.x, touch.clientY - start.y, event.timeStamp - start.at);
    reset();
    if (!step) return;
    event.preventDefault();
    shiftTripDay(step);
  }, { passive: false });
  view.addEventListener("touchcancel", reset, { passive: true });
}

// src/app/actions.js
var ACTIONS = {};
function registerAction(name, fn) {
  ACTIONS[name] = fn;
}
registerAction("tab", (t, oid) => {
  showTab(t.dataset.tab);
});
registerAction("open", (t, oid) => {
  openDetail(oid);
});
registerAction("close-sheet", (t, oid) => {
  closeSheets();
});
registerAction("new-order", (t, oid) => {
  openNew();
});
registerAction("save-order", (t, oid) => {
  saveOrder();
});
registerAction("goto-collect", (t, oid) => {
  ui.bucket = db.orders.some((o) => isOver(o) && !snoozed(o)) ? "over" : "snoozed";
  showTab("pay");
  renderAll();
});
registerAction("chip", (t, oid) => {
  ui.chip = t.dataset.chip;
  renderOrders();
});
registerAction("bucket", (t, oid) => {
  ui.bucket = t.dataset.bucket;
  renderPay();
});
registerAction("period", (t, oid) => {
  ui.period = t.dataset.period;
  renderStats();
});
registerAction("day", (t, oid) => {
  const day = t.dataset.day || ui.selDay;
  ui.selDay = day;
  const dy = +day.slice(0, 4), dm = +day.slice(5, 7);
  if (dy !== ui.vMon.y || dm !== ui.vMon.m) ui.vMon = { y: dy, m: dm };
  renderTrip();
});
registerAction("mnav", (t, oid) => {
  let m = ui.vMon.m + +t.dataset.d, y = ui.vMon.y;
  if (m < 1) {
    m = 12;
    y--;
  }
  if (m > 12) {
    m = 1;
    y++;
  }
  ui.vMon = { y, m };
  ui.selDay = `${y}-${pad(m)}-${pad(Math.min(+ui.selDay.slice(8, 10), new Date(y, m, 0).getDate()))}`;
  renderTrip();
});
registerAction("mtoday", (t, oid) => {
  ui.vMon = { y: now.getFullYear(), m: now.getMonth() + 1 };
  ui.selDay = TODAY;
  renderTrip();
});
registerAction("mark-shot", (t, oid) => {
  if (mark(oid, "shotAt", "\u5DF2\u8BB0\u5F55\u5B9E\u9645\u62CD\u6444\u65F6\u95F4 \u2713")) capturePlace(oid);
});
registerAction("nav-place", (t, oid) => {
  const o = byId(oid);
  if (!o) return;
  const url = t.dataset.gps || !o.location ? TanJiGeo.mapUrl({ place: o.gpsPlace, name: o.store }) : TanJiGeo.mapUrl({ query: o.location });
  if (!url) {
    toast("\u8FD9\u5355\u8FD8\u6CA1\u6709\u5730\u70B9,\u5148\u586B\u5730\u70B9\u6216\u8BB0\u5F55\u5F53\u524D\u4F4D\u7F6E");
    return;
  }
  if (!TanJiGeo.open(url)) toast("\u6253\u4E0D\u5F00\u5730\u56FE,\u8BF7\u624B\u52A8\u641C\u7D22\u8BE5\u5730\u5740");
});
registerAction("locate-now", (t, oid) => {
  const o = byId(oid);
  if (!o) return;
  toast("\u6B63\u5728\u83B7\u53D6\u5F53\u524D\u4F4D\u7F6E\u2026");
  TanJiGeo.locate().then((place) => {
    const cur = byId(oid);
    if (!cur) return;
    cur.gpsPlace = place;
    save();
    renderAll();
    rerenderDetail();
    toast("\u5DF2\u8BB0\u5F55\u5230\u5E97\u5B9A\u4F4D \u2713");
  }).catch(() => toast("\u5B9A\u4F4D\u5931\u8D25,\u8BF7\u786E\u8BA4\u5DF2\u5141\u8BB8\u300C\u4F7F\u7528 App \u671F\u95F4\u300D\u5B9A\u4F4D"));
});
registerAction("mark-submit", (t, oid) => {
  mark(oid, "submittedAt", "\u5DF2\u6807\u8BB0\u63D0\u5BA1 \u2713");
});
registerAction("mark-short", (t, oid) => {
  mark(oid, "shortAt", "\u5DF2\u6807\u8BB0\u53D1\u526F\u7247 \u2713");
});
registerAction("mark-long", (t, oid) => {
  mark(oid, "longAt", "\u5DF2\u6807\u8BB0\u53D1\u6B63\u7247 \u2713");
});
registerAction("acc-filter", (t, oid) => {
  ui.accFilter = t.dataset.id === "" ? null : +t.dataset.id;
  renderAll();
});
registerAction("acc-pick", (t, oid) => {
  ui.draftAccId = t.dataset.id === "" ? null : +t.dataset.id;
  renderAccPick("e-acc-block", ui.draftAccId);
});
registerAction("acc-toggle", (t, oid) => {
  const id = +t.dataset.id;
  if (!accById(id)) return;
  const selected = new Set(ui.draftAccIds || []);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  ui.draftAccIds = [...selected];
  ui.draftAccId = ui.draftAccIds[0] ?? null;
  renderAccPick("f-acc-block", ui.draftAccIds, true);
});
registerAction("prov-pick", (t, oid) => {
  ui.draftProv = t.dataset.v;
  {
    const ctx = t.closest('[id$="-block"]');
    if (ctx) renderProvPick(ctx.id, ui.draftProv);
  }
});
registerAction("pal-pick", (t, oid) => {
  ui.draftColor = +t.dataset.i;
  renderPal();
  renderAvatarPreview();
});
registerAction("open-account", (t, oid) => {
  openAccount(t.dataset.id != null ? +t.dataset.id : null);
});
registerAction("save-account", (t, oid) => {
  saveAccount();
});
registerAction("delete-account", (t, oid) => {
  deleteAccount();
});
registerAction("pick-avatar", (t, oid) => {
  $("#avatar-file").click();
});
registerAction("shot-pick", (t, oid) => {
  $("#shot-file").click();
});
registerAction("shot-clear", (t, oid) => {
  const target = byId(oid);
  if (!target || !target.photoThumb) return;
  if (!confirm("\u5220\u9664\u8FD9\u5F20\u968F\u624B\u62CD\u7167?")) return;
  target.photoThumb = null;
  save();
  renderAll();
  rerenderDetail();
  toast("\u7167\u7247\u5DF2\u5220\u9664");
});
registerAction("remove-avatar", (t, oid) => {
  ui.draftAvatar = null;
  renderAvatarPreview();
});
registerAction("crop-cancel", (t, oid) => {
  closeCrop();
});
registerAction("crop-use", (t, oid) => {
  useCrop();
});
registerAction("copy-account", (t, oid) => {
  const a = accById(t.dataset.id);
  if (!a) {
    toast("\u8BE5\u8BA2\u5355\u672A\u6307\u5B9A\u8D26\u53F7,\u65E0\u8D44\u6599\u53EF\u62F7");
    return;
  }
  copyText(accountCopyText(a)).then((ok) => toast(ok ? `\u5DF2\u62F7\u8D1D\u300C${a.name}\u300D\u8D44\u6599 \u2713` : "\u62F7\u8D1D\u5931\u8D25,\u8BF7\u624B\u52A8\u957F\u6309\u590D\u5236"));
});
registerAction("assign-open", (t, oid) => {
  ui.assignAcc = ACCS()[0] ? ACCS()[0].id : null;
  $("#assign-list").innerHTML = ACCS().map((a) => {
    const c = accColor(a);
    return `<button type="button" class="acc-opt ${ui.assignAcc === a.id ? "sel" : ""}" data-act="assign-pick" data-id="${a.id}" style="${ui.assignAcc === a.id ? `border-color:${c.ink};background:${c.bg}` : ""}">
          <span class="acc-dot"></span>${accAvatarHTML(a, "width:30px;height:30px;font-size:14px;border-radius:10px")}
          <span class="acc-name">${esc(a.name)}</span><span class="acc-cnt">${db.orders.filter((o) => o.accountId === a.id).length} \u5355</span></button>`;
  }).join("");
  showSheet("sheet-assign");
});
registerAction("assign-pick", (t, oid) => {
  ui.assignAcc = +t.dataset.id;
  {
    const list = $("#assign-list");
    list.querySelectorAll(".acc-opt").forEach((el) => {
      const sel = +el.dataset.id === ui.assignAcc;
      el.classList.toggle("sel", sel);
      el.style.borderColor = sel ? accColor(accById(ui.assignAcc)).ink : "";
      el.style.background = sel ? accColor(accById(ui.assignAcc)).bg : "";
    });
  }
});
registerAction("assign-run", (t, oid) => {
  const n = db.orders.filter((o) => o.accountId == null).length;
  if (!n) {
    toast("\u6CA1\u6709\u672A\u6307\u5B9A\u7684\u8BA2\u5355");
    return;
  }
  if (ui.assignAcc == null) {
    toast("\u5148\u9009\u4E00\u4E2A\u8D26\u53F7");
    return;
  }
  db.orders.forEach((o) => {
    if (o.accountId == null) o.accountId = ui.assignAcc;
  });
  save();
  closeSheets();
  renderAll();
  toast(`\u5DF2\u628A ${n} \u7B14\u8BA2\u5355\u6539\u6302\u5230\u300C${accById(ui.assignAcc).name}\u300D`);
});
registerAction("set-review", (t, oid) => {
  const o = byId(oid), v = t.dataset.v;
  if (!o || !["pass", "fail"].includes(v)) return;
  o.reviewResult = o.reviewResult === v ? "" : v;
  save();
  renderAll();
  rerenderDetail();
  toast(o.reviewResult ? `\u5DF2\u6807\u8BB0${REVIEW_LABEL[o.reviewResult]}` : "\u5DF2\u6E05\u9664\u9001\u5BA1\u7ED3\u679C");
});
registerAction("open-pay", (t, oid) => {
  openPay(oid, t.dataset.kind);
});
registerAction("pay-method", (t, oid) => {
  if (ui.payCtx) {
    ui.payCtx.method = t.dataset.m;
    openPay(ui.payCtx.oid, ui.payCtx.kind, ui.payCtx.method);
  }
});
registerAction("confirm-pay", (t, oid) => {
  const ctx = ui.payCtx;
  ui.payCtx = null;
  if (!ctx) {
    toast("\u6536\u6B3E\u64CD\u4F5C\u5DF2\u7ED3\u675F\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u6536\u6B3E");
    return;
  }
  const returnDetail = ui.detail === ctx.oid ? ctx.oid : null;
  closeSheets();
  pay(ctx.oid, ctx.kind, ctx.method);
  if (returnDetail !== null && byId(returnDetail)) openDetail(returnDetail);
});
registerAction("snooze", (t, oid) => {
  const o = byId(oid);
  if (o) {
    const d = +t.dataset.d;
    o.remindAt = dOff(d, "09:00");
    save();
    renderAll();
    rerenderDetail();
    Notify.scheduleSnooze(o, d);
    Notify.syncDaily();
    toast(`\u5DF2\u5907\u5FD8:${d} \u5929\u540E(${fmtD(o.remindAt)})\u63D0\u9192\u50AC\u6536 \u2713`);
  }
});
registerAction("notify-toggle", (t, oid) => {
  Notify.toggle();
});
registerAction("clear-remind", (t, oid) => {
  const o = byId(oid);
  if (o) {
    o.remindAt = null;
    save();
    renderAll();
    rerenderDetail();
    Notify.cancelSnooze(oid);
    Notify.syncDaily();
    toast("\u5DF2\u6E05\u9664\u50AC\u6536\u63D0\u9192");
  }
});
registerAction("remind-open", (t, oid) => {
  openRemind(oid);
});
registerAction("remind-quick", (t, oid) => {
  const el = $("#remind-note");
  if (el) {
    el.value = t.dataset.v || "";
    if (el.focus) el.focus();
  }
});
registerAction("remind-save", (t, oid) => {
  saveRemind();
});
registerAction("expect-open", (t, oid) => {
  openExpect(oid);
});
registerAction("expect-save", (t, oid) => {
  saveExpect();
});
registerAction("expect-clear", (t, oid) => {
  clearExpect(oid);
});
registerAction("toast-undo", (t, oid) => {
  const action = dismissToast();
  if (action && typeof action.run === "function") action.run();
});
registerAction("mile", (t, oid) => {
  const o = byId(oid), key = t.dataset.key;
  if (!o || !Object.prototype.hasOwnProperty.call(MILE_LABEL, key)) return;
  if (o[key]) {
    const after = MILE_ORDER.slice(MILE_ORDER.indexOf(key) + 1).filter((k) => o[k]);
    const photoNote = key === "shotAt" && o.photoThumb ? "\u95E8\u53E3\u7684\u968F\u624B\u7167\u4E5F\u4F1A\u4E00\u5E76\u5220\u9664\u3002" : "";
    const msg = after.length ? `\u6E05\u9664\u300C${MILE_LABEL[key]}\u300D\uFF1F\u5176\u540E\u7684\u300C${after.map((k) => MILE_LABEL[k]).join("\u300D\u300C")}\u300D\u4E5F\u5C06\u4E00\u5E76\u6E05\u9664\u3002` : `\u6E05\u9664\u300C${MILE_LABEL[key]}\u300D\u8BB0\u5F55?`;
    if (confirm(msg + photoNote)) {
      [key, ...after].forEach((k) => o[k] = null);
      if (key === "shotAt") delete o.photoThumb;
      save();
      renderAll();
      rerenderDetail();
      Notify.syncDeliver();
      Notify.syncDaily();
      toast("\u5DF2\u6E05\u9664,\u53EF\u91CD\u65B0\u6807\u8BB0");
    }
  } else if (mark(oid, key, "\u5DF2\u6807\u8BB0\u300C" + MILE_LABEL[key] + "\u300D") && key === "shotAt") capturePlace(oid);
});
registerAction("copy-order", (t, oid) => {
  duplicateOrder(oid);
});
registerAction("edit-order", (t, oid) => {
  openEdit(oid);
});
registerAction("save-edit", (t, oid) => {
  saveEdit();
});
registerAction("toggle-dep", (t, oid) => {
  toggleReceipt(oid, "deposit");
});
registerAction("toggle-fin", (t, oid) => {
  toggleReceipt(oid, "final");
});
registerAction("privacy", (t, oid) => {
  ui.privacy = !ui.privacy;
  renderAll();
  rerenderDetail();
  toast(ui.privacy ? "\u5DF2\u9690\u85CF\u91D1\u989D \xB7 \u622A\u56FE\u6A21\u5F0F" : "\u5DF2\u6062\u590D\u663E\u793A\u91D1\u989D");
});
registerAction("app-store-soon", (t, oid) => {
  toast("iOS \u539F\u751F\u7248\u5373\u5C06\u4E0A\u67B6,\u4E0A\u7EBF\u540E\u53EF\u76F4\u63A5\u5728 App Store \u4E70\u65AD");
});
registerAction("share", (t, oid) => {
  shareToday();
});
registerAction("share-confirm", (t, oid) => {
  if (ui.shareBlob) {
    const name = "\u62CD\u6444\u884C\u7A0B-" + ui.shareDay + ".png";
    const file = new File([ui.shareBlob], name, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: ui.shareDay + " \u62CD\u6444\u884C\u7A0B" }).catch((error) => {
        if (error.name !== "AbortError") toast("\u5206\u4EAB\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
      });
    } else {
      download(name, ui.shareBlob, "image/png");
      toast("\u56FE\u7247\u5DF2\u4FDD\u5B58");
    }
  }
});
registerAction("del-order", (t, oid) => {
  if (confirm("\u5220\u9664\u8BE5\u8BA2\u5355\u53CA\u5176\u6D41\u6C34?")) {
    db.orders = db.orders.filter((o) => o.id !== oid);
    db.payments = db.payments.filter((p) => p.oid !== oid);
    save();
    closeSheets();
    renderAll();
    Notify.cancelOrder(oid);
    Notify.syncDaily();
    toast("\u8BA2\u5355\u5DF2\u5220\u9664");
  }
});
registerAction("export-csv", (t, oid) => {
  exportCsv();
});
registerAction("export-json", (t, oid) => {
  exportJson();
});
registerAction("export-db", (t, oid) => {
  exportDb();
});
registerAction("open-schema", (t, oid) => {
  showSheet("sheet-schema");
});
registerAction("th", (t, oid) => {
  const opts = [7, 15, 30, 45];
  let i = opts.indexOf(db.threshold);
  i = Math.min(opts.length - 1, Math.max(0, i + +t.dataset.v));
  db.threshold = opts[i];
  save();
  renderAll();
  rerenderDetail();
  Notify.syncDaily();
  toast(`\u50AC\u6536\u9608\u503C\u5DF2\u8BBE\u4E3A ${db.threshold} \u5929`);
});
registerAction("import-json", (t, oid) => {
  $("#import-file").value = "";
  $("#import-file").click();
});
registerAction("confirm-import", (t, oid) => {
  confirmImport();
});
registerAction("restore-backup", (t, oid) => {
  restoreCheckpoint();
});
registerAction("switch-mode", (t, oid) => {
  switchMode(Store.mode === "demo" ? "work" : "demo");
});
registerAction("clear-data", (t, oid) => {
  if (confirm("\u6E05\u7A7A\u5F53\u524D" + (Store.mode === "work" ? "\u5DE5\u4F5C" : "\u6F14\u793A") + "\u6570\u636E\uFF1F\u8BA2\u5355\u4E0E\u6D41\u6C34\u4F1A\u6E05\u7A7A\uFF0C\u8D26\u53F7\u4E0E\u8BBE\u7F6E\u4FDD\u7559\uFF0C\u66FF\u6362\u524D\u4F1A\u81EA\u52A8\u5907\u4EFD\u3002")) replaceData({ orders: [], payments: [], threshold: db.threshold, notifyEnabled: db.notifyEnabled, accounts: db.accounts || [], providers: db.providers || [] }).then((ok) => {
    if (ok) toast("\u5DF2\u6E05\u7A7A\uFF0C\u66FF\u6362\u524D\u6570\u636E\u53EF\u5728\u7EDF\u8BA1\u9875\u6062\u590D");
  });
});
registerAction("export-checkpoint", (t, oid) => {
  exportCheckpoint();
});
registerAction("retry-storage", (t, oid) => {
  if (Store.lockedOut) {
    location.reload();
  } else if (Store.blocked) {
    loadState().then(() => {
      closeSheets();
      renderAll();
      showTab("home");
    });
  } else save();
});
var TAP_GUARD = /* @__PURE__ */ new Set(["privacy", "set-review", "th", "notify-toggle"]);
var lastTap = { act: "", oid: 0, at: 0 };
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act, oid = +t.dataset.oid || 0;
  if (!Store.ready || Store.busy) {
    toast("\u6B63\u5728\u8BFB\u5199\u6570\u636E\uFF0C\u8BF7\u7A0D\u5019");
    return;
  }
  if (Store.blocked && !["retry-storage", "export-json", "export-csv", "export-db", "export-checkpoint", "tab", "open", "close-sheet", "privacy", "app-store-soon", "goto-collect", "chip", "bucket", "period", "day", "mnav", "mtoday", "share", "share-confirm", "open-schema", "open-account", "acc-filter", "acc-pick", "prov-pick", "pal-pick", "copy-account", "assign-open", "pick-avatar", "crop-cancel", "crop-use", "shot-pick", "nav-place", "remind-open", "expect-open"].includes(act)) {
    toast("\u4E3A\u4FDD\u62A4\u539F\u6570\u636E\uFF0C\u5199\u5165\u5DF2\u6682\u505C\uFF0C\u8BF7\u5148\u91CD\u8BD5\u8BFB\u53D6");
    return;
  }
  refreshClock();
  const fn = ACTIONS[act];
  if (fn) {
    if (TAP_GUARD.has(act)) {
      const now2 = Date.now();
      if (act === lastTap.act && oid === lastTap.oid && now2 - lastTap.at < 350) return;
      lastTap = { act, oid, at: now2 };
    }
    fn(t, oid);
  }
});
["f-date", "f-time"].forEach((id) => $("#" + id).addEventListener("change", updateConflict));
["f-date", "f-time"].forEach((id) => $("#" + id).addEventListener("input", updateConflict));

// src/app/views/home.js
var fmtMoney8 = (n) => fmtMoney(n, ui.privacy);
function renderHome() {
  const flt = db.orders.filter(accMatch);
  const overAll = flt.filter(isOver);
  const over = overAll.filter((o) => !snoozed(o));
  const overSum = over.reduce((s, o) => s + owedOf(o), 0);
  const maxOver = over.length ? Math.max(...over.map(overdueDays)) : 0;
  const todays = flt.filter((o) => o.appt.slice(0, 10) === TODAY).sort((a, b) => a.appt.localeCompare(b.appt));
  const todoToday = todays.filter((o) => !o.shotAt);
  const sending = flt.filter((o) => ["\u540E\u671F\u4E2D", "\u53D1\u7247\u4E2D"].includes(workOf(o))).sort((a, b) => (a.shotAt || "").localeCompare(b.shotAt || ""));
  const m = statsFor("M", flt);
  const totOwed = flt.reduce((s, o) => s + owedOf(o), 0);
  let alertCard;
  if (over.length) {
    alertCard = `<div class="alert-card" data-act="goto-collect">
      <svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg>
      <div class="alert-main"><div class="alert-t">${over.length} \u7B14\u5C3E\u6B3E\u903E\u671F \xB7 \u5F85\u50AC\u6536 ${fmtMoney8(overSum)}</div>
      <div class="alert-s">\u6700\u957F\u5DF2\u6B20 ${maxOver} \u5929${overAll.length > over.length ? ` \xB7 \u53E6\u6709 ${overAll.length - over.length} \u7B14\u5DF2\u8BBE\u63D0\u9192` : ""} \xB7 \u70B9\u51FB\u8FDB\u5165\u50AC\u6536\u6E05\u5355</div></div>
      <svg class="ic" style="opacity:.9" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>
    </div>`;
  } else if (overAll.length) {
    const soon = overAll.map((o) => o.remindAt).sort()[0];
    alertCard = `<div class="alert-card amber" data-act="goto-collect">
      <svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/></svg>
      <div class="alert-main"><div class="alert-t">${overAll.length} \u7B14\u5C3E\u6B3E\u5DF2\u8BBE\u50AC\u6536\u63D0\u9192</div>
      <div class="alert-s">\u6700\u65E9 ${fmtD(soon)} \u518D\u63D0\u9192 \xB7 \u70B9\u51FB\u67E5\u770B\u6E05\u5355</div></div>
      <svg class="ic" style="opacity:.9" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>
    </div>`;
  } else {
    alertCard = `<div class="alert-card calm">
      <svg class="ic" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
      <div class="alert-main"><div class="alert-t">\u6536\u6B3E\u72B6\u6001\u5065\u5EB7</div><div class="alert-s">\u6682\u65E0\u903E\u671F\u5C3E\u6B3E,\u5171\u5F85\u6536 ${fmtMoney8(totOwed)}</div></div>
    </div>`;
  }
  const todayRows = todays.length ? todays.map((o) => {
    const depChip = unDep(o) > 0 ? `<span class="chip c-red">\u5F85\u5B9A\u91D1 ${fmtMoney8(unDep(o))}</span>` : "";
    const punch = o.shotAt ? "" : `<button class="mini-btn" style="padding:6px 10px;font-size:12px" data-act="mark-shot" data-oid="${esc(o.id)}">\u6253\u5361</button>`;
    return `<div class="row${accBar(o)}" style="${accTint(o)}${o.shotAt ? ";opacity:.66" : ""}" data-act="open" data-oid="${o.id}">
      <div class="rside" style="width:52px"><div class="rprice" style="color:var(--brand)">${fmtHM(o.appt)}</div><div class="rsub" style="margin:0">\u9884\u7EA6</div></div>
      <div class="rmain"><div class="rname">${esc(o.store)}</div>
        <div class="chiprow">${accOrderTag(o)}${workChip(o)}${depChip || payChip(o)}<span class="chip c-gray">${esc(o.cat)}</span></div></div>
      <div class="rside">${priceCell(o)}</div>
      ${punch || '<svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>'}
    </div>`;
  }).join("") : `<div class="empty"><div class="e-ic">\u{1F319}</div>\u4ECA\u65E5\u65E0\u62CD\u6444\u5B89\u6392<br>\u53BB\u300C\u884C\u7A0B\u300D\u9875\u770B\u770B\u63A5\u4E0B\u6765\u7684\u6863\u671F</div>`;
  const sendRows = sending.length ? sending.slice(0, 4).map((o) => {
    const miss = [
      !o.submittedAt ? "\u5F85\u63D0\u5BA1" : "",
      needMain(o) && !o.longAt ? "\u5F85\u6B63\u7247" : "",
      needSub(o) && !o.shortAt ? "\u5F85\u526F\u7247" : "",
      deliveredAll(o) && !o.publishedAt ? "\u5F85\u53D1\u5E03" : ""
    ].filter(Boolean).map((t) => `<span class="chip c-orange">${t}</span>`).join("");
    const late = deliverLate(o) ? `<span class="chip c-red">\u8D8524h</span>` : "";
    return `<div class="row${accBar(o)}" style="${accTint(o)}" data-act="open" data-oid="${o.id}">
      <div class="rmain"><div class="rname">${esc(o.store)}</div><div class="rsub">\u62CD\u6444\u4E8E ${fmtD(o.shotAt)} \xB7 ${fmtMoney8(o.price)}</div>
        <div class="chiprow">${accOrderTag(o)}${late}${miss}</div></div>
      ${stepBtn(o, "padding:8px 12px") || '<svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg>'}
    </div>`;
  }).join("") + (sending.length > 4 ? `<div class="row" data-act="tab" data-tab="orders">
      <div class="rmain"><div class="rsub">\u8FD8\u6709 ${sending.length - 4} \u5355\u5F85\u53D1\u7247 \xB7 \u67E5\u770B\u5168\u90E8</div></div>
      <svg class="ic" style="color:#C6C6CD"><path d="M9.5 6l6 6-6 6"/></svg></div>` : "") : `<div class="empty">\u6CA1\u6709\u5F85\u53D1\u7247\u7684\u8BA2\u5355 \u{1F389}</div>`;
  $("#v-home").innerHTML = `
    <div class="htop-row">
      <div><div class="eyebrow">${now.getMonth() + 1}\u6708${now.getDate()}\u65E5 \u5468${dowOf(TODAY)}</div>
      <div class="hsub">\u4ECA\u65E5 ${todays.length} \u5355${todays.length ? ` \xB7 ${todoToday.length ? `\u5F85\u62CD ${todoToday.length}` : "\u5DF2\u5168\u90E8\u62CD\u5B8C"}` : ""} \xB7 ${over.length ? `${over.length} \u7B14\u5F85\u50AC\u6536` : "\u6536\u6B3E\u6B63\u5E38"}</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        ${headBtns(true)}
        <button class="btn-pill" data-act="new-order"><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>\u9884\u7EA6</button>
      </div>
    </div>
    ${accChipbarHTML()}
    ${alertCard}
    <div class="sec-title">\u4ECA\u65E5\u62CD\u6444${todays.length ? ` <span class="rsub" style="font-weight:600">${todays.length - todoToday.length}/${todays.length} \u5DF2\u62CD</span>` : ""} <span class="more" data-act="tab" data-tab="trip">\u884C\u7A0B \u203A</span></div>
    <div class="card rows">${todayRows}</div>
    <div class="sec-title">\u5F85\u53D1\u7247 <span class="more" data-act="tab" data-tab="orders">\u5168\u90E8 \u203A</span></div>
    <div class="card rows">${sendRows}</div>
    <div class="sec-title">\u672C\u6708\u901F\u89C8 <span class="more" data-act="tab" data-tab="stats">\u7EDF\u8BA1 \u203A</span></div>
    <div class="mini-grid">
      <div class="mini"><div class="mv" style="color:#239648">${fmtMoney8(m.paidSum)}</div><div class="ml">\u672C\u6708\u5B9E\u6536 \xB7 ${m.paid.length} \u7B14</div></div>
      <div class="mini"><div class="mv">${fmtMoney8(m.dealSum)}</div><div class="ml">\u672C\u6708\u6210\u4EA4 \xB7 ${m.deals.length} \u5355</div></div>
      <div class="mini"><div class="mv" style="color:var(--red)">${fmtMoney8(totOwed)}</div><div class="ml">\u5F53\u524D\u5F85\u6536\u6B3E</div></div>
      <div class="mini"><div class="mv" style="color:var(--orange)">${sending.length}</div><div class="ml">\u5F85\u53D1\u7247\u8BA2\u5355</div></div>
    </div>`;
}

// src/app/main.js
Object.defineProperty(globalThis, "__TANJI__", { value: {
  Store,
  ui,
  get db() {
    return db;
  },
  renderTrip,
  statsFor,
  backupDocument,
  previewImport,
  buildSqliteBytes
}, configurable: true });
registerRenderers({ home: renderHome, trip: renderTrip, orders: renderOrders, pay: renderPay, stats: renderStats });
registerDetailRerender(rerenderDetail);
registerStorageHooks({ renderAll, showTab, toast, closeSheets, notify: Notify, resetFilters() {
  ui.q = "";
  ui.chip = "all";
  ui.bucket = "all";
  ui.accFilter = null;
} });
registerBadgeCounter(() => db.orders.filter(accMatch).filter((o) => isOver(o) && !snoozed(o)).length);
registerDailySync(() => Notify.syncDaily());
registerBytesBuilder(buildSqliteBytes);
document.documentElement.classList.toggle("native", isNative);
if (!isNative && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => toast("\u79BB\u7EBF\u7F13\u5B58\u5B89\u88C5\u5931\u8D25\uFF0C\u8054\u7F51\u65F6\u4ECD\u53EF\u4F7F\u7528")));
}
$("#import-file").addEventListener("change", (event) => previewImport(event.target.files[0]));
document.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches('[role="button"][data-act]')) {
    event.preventDefault();
    event.target.click();
  }
});
document.addEventListener("visibilitychange", refreshVisible);
addEventListener("pageshow", refreshVisible);
setInterval(refreshVisible, 6e4);
async function flushPendingWrites() {
  try {
    if (Store.queue) await Store.queue;
  } catch (e) {
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPendingWrites();
});
addEventListener("pagehide", flushPendingWrites);
addEventListener("storage", (event) => {
  if (event.key !== storageKey(Store.mode) || !event.newValue) return;
  try {
    if (JSON.parse(event.newValue).revision > Store.revision) {
      Store.blocked = true;
      setStorageStatus("\u5176\u4ED6\u9875\u9762\u5DF2\u66F4\u65B0\u6570\u636E\uFF0C\u5DF2\u6682\u505C\u672C\u9875\u5199\u5165\u3002\u8BF7\u5237\u65B0\u8BFB\u53D6\u6700\u65B0\u6570\u636E\u3002");
    }
  } catch (error) {
  }
});
$("#f-date").value = TODAY;
(async () => {
  try {
    if (isNative) await nativeOpen();
  } catch (e) {
    console.error("[TanJi] SQLite \u521D\u59CB\u5316\u5931\u8D25", e);
  }
  await acquireWriter();
  const had = await loadState();
  renderAll();
  showTab("home");
  Notify.cancelMode("demo");
  Notify.syncDaily();
  markDailySynced();
  Notify.syncDeliver();
  initAvatarInput();
  initShotInput();
  initSheetGestures();
  initTripGestures();
  if (!had && !Store.blocked) await save();
  initSqlite().then((s) => {
    if (s) {
      Store.sqlite3 = s;
      if (!Store.blocked && !Store.busy) persistFull();
    } else if (!isNative) toast("SQLite \u5F15\u64CE\u672A\u80FD\u52A0\u8F7D\uFF0CJSON \u4FDD\u5B58\u548C\u5907\u4EFD\u4ECD\u53EF\u7528");
  });
})();
