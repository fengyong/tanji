/**
 * 探记 TanJi —— 架构守护(P2b,2026-11-23)
 *
 * 为什么需要这一类测试
 * ------------------
 * P0/P1 拆层的全部价值在于分层不再被腐蚀。但「storage.js 不许碰 UI」
 * 「视图层不许碰存储」「logic.js 不许碰 DOM」过去只是注释里的约定 ——
 * 约定会被下一次赶工的提交悄悄打破,而代码评审很难逐行盯住 import。
 * 这里把分层规则变成静态断言:架构腐蚀 = 测试变红。
 *
 * 覆盖四条规则:
 *   1. 内核纯度:logic.js 零 DOM / 零存储 / 零平台引用
 *   2. 无环:src/app 的 import 图不许有循环依赖
 *   3. 方向:只允许白名单内的跨层边(层序见下)
 *   4. 禁区:视图/动作/业务层不得出现平台与存储关键字
 *   5. 入口完整:任何 src/app 模块必须可达(防 tree-shake 静默丢模块,
 *      P0 的 actions.js 事故就是这一类)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'src', 'app');

/* ---------- 工具:解析 import 图 ---------- */

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? jsFiles(p) : (e.name.endsWith('.js') ? [p] : []);
  });
}

/** 模块短名(vies/home.js → views/home) */
const short = p => path.relative(APP, p).replace(/\.js$/, '');

/** file → [直接 import 的模块短名] */
function importGraph() {
  const graph = new Map();
  for (const file of jsFiles(APP)) {
    const src = fs.readFileSync(file, 'utf8');
    // 同时覆盖 import … from './x.js' / '../x.js' 与副作用引入 import './x.js'
    const deps = [...src.matchAll(/from '\.+\/([\w/-]+)\.js'/g)].map(m => m[1]);
    for (const m of src.matchAll(/import '\.+\/([\w/-]+)\.js'/g)) deps.push(m[1]);
    graph.set(short(file), [...new Set(deps)]);
  }
  return graph;
}

/* ---------- 规则 1:内核纯度 ---------- */

test('内核 purity:logic.js 零 DOM/存储/平台引用', () => {
  const src = fs.readFileSync(path.join(ROOT, 'www', 'logic.js'), 'utf8');
  // 剥掉注释与字符串后扫描(注释里允许出现这些词,因为注释在解释为什么不用它们)
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const banned of ['document', 'window.', 'localStorage', 'indexedDB', 'TanjiCap', 'require(', 'fetch(']) {
    assert.ok(!code.includes(banned), `logic.js 出现禁区引用「${banned}」——内核必须保持纯函数,否则将来无法搬到 Swift/其他端`);
  }
});

/* ---------- 规则 2:无环 ---------- */

test('import 图无环', () => {
  const graph = importGraph();
  const state = new Map(); // 0=未访问 1=访问中 2=完成
  const stack = [];
  let cycle = null;
  function dfs(node) {
    state.set(node, 1); stack.push(node);
    for (const dep of graph.get(node) || []) {
      if (!graph.has(dep)) continue;
      if (state.get(dep) === 1) { cycle = [...stack.slice(stack.indexOf(dep)), dep]; return; }
      if (!state.get(dep)) dfs(dep);
      if (cycle) return;
    }
    stack.pop(); state.set(node, 2);
  }
  for (const node of graph.keys()) { if (!state.get(node)) dfs(node); if (cycle) break; }
  assert.equal(cycle, null, `import 图存在环:${cycle ? cycle.join(' → ') : ''}——环意味着只能靠 globalThis 挂回绕,见 docs/refactor-p1-globals-elimination.md`);
});

/* ---------- 规则 3:依赖方向白名单 ---------- */

test('依赖方向:只允许白名单内的跨层边', () => {
  const graph = importGraph();
  // 层序:低 ← 高(高层可以 import 低层);同层业务模块之间不许互引(views 例外,见白名单)
  const LAYER = {
    env: 0, util: 1, demo: 2, storage: 3, 'sqlite-bytes': 4,
    ui: 4, derived: 5,
    sheets: 6, accounts: 6, stats: 6, notify: 6,
    'views/home': 7, 'views/trip': 7, 'views/orders': 7, 'views/pay': 7, 'views/stats': 7,
    'order-forms': 7, 'order-actions': 7, detail: 7, 'share-image': 7, export: 7,
    actions: 8, main: 9,
  };
  // 白名单:跨层但层序不够表达的特殊允许边(每条必须带理由)
  const ALLOWED = new Set([
    'export→sheets',        // 导入预览/导出反馈的 toast 与弹层
    'order-actions→detail', // 收款/撤销后重开详情(P1 遗留,T2 后续可再解)
    'accounts→ui',          // 账号表单读 ui.draftAccId 等草稿态
    'sheets→ui',            // 弹层手势读 ui 状态
    'notify→ui',            // toggle 后 renderAll
    'notify→sheets',        // 通知开关的 toast
    'accounts→sheets',      // 账号表单的弹层与 toast
    'order-forms→order-actions', // 编辑保存后联动(打卡定位等)
    'order-forms→detail',   // 表单保存后回详情
    'views/home→detail',    // 首页点行进详情
    'views/orders→detail',  // 订单页点行进详情
    'stats→ui',             // headBtns 读 ui.privacy
    'stats→storage',        // 读 Store.mode 徽标
    'detail→accounts',      // 详情页账号标签
    'share-image→ui',       // 分享日读 ui.selDay
  ]);
  for (const [from] of graph) {
    assert.notEqual(LAYER[from], undefined, `未登记的模块 ${from}:加层序或白名单(架构变更必须显式过这里)`);
  }
  const violations = [];
  for (const [from, deps] of graph) {
    for (const to of deps) {
      const key = `${from}→${to}`;
      if (LAYER[to] > LAYER[from]) violations.push(`${key}(反向)`);
      else if (LAYER[to] === LAYER[from] && !ALLOWED.has(key)) violations.push(`${key}(同层互引)`);
    }
  }
  assert.deepEqual([...new Set(violations)], [], '依赖方向违规:\n  ' + [...new Set(violations)].join('\n  '));
});

/* ---------- 规则 4:禁区关键字 ---------- */

test('禁区:视图/业务/动作层不得出现平台与存储关键字', () => {
  const CHECK = ['views/', 'detail.js', 'order-forms.js', 'order-actions.js', 'accounts.js', 'stats.js', 'sheets.js', 'share-image.js'];
  for (const rel of CHECK) {
    const files = rel.endsWith('/') ? jsFiles(path.join(APP, rel)) : [path.join(APP, rel)];
    for (const file of files) {
      const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const banned of ['TanjiCap', 'indexedDB', 'localStorage', 'sqlite3InitModule']) {
        assert.ok(!code.includes(banned), `${short(file)} 出现禁区关键字「${banned}」——平台/存储访问只能走 storage.js / env.js`);
      }
    }
  }
});

/* ---------- 规则 5:入口可达性(防 tree-shake 丢模块) ---------- */

test('入口完整:每个 src/app 模块从 main.js 可达', () => {
  const graph = importGraph();
  const reached = new Set(['main']);
  const queue = ['main'];
  while (queue.length) {
    const node = queue.shift();
    for (const dep of graph.get(node) || []) {
      if (!reached.has(dep)) { reached.add(dep); queue.push(dep); }
    }
  }
  const orphans = [...graph.keys()].filter(m => !reached.has(m));
  assert.deepEqual(orphans, [],
    `这些模块从 main.js 不可达:${orphans.join(', ')}——` +
    '无导出被引用且无副作用引入时,esbuild 会 tree-shake 掉它(P0 的 actions.js 事件委托就是这样丢的)');
});
