/**
 * 探记 TanJi —— 架构守护(P2b,2026-11-23)
 *
 * 为什么需要这一类测试
 * ------------------
 * P0/P1 拆层的全部价值在于分层不再被腐蚀。但「storage.js 不许碰 UI」
 * 「视图/业务层不许直接碰平台原语(插件桥/IndexedDB/localStorage)」
 * 「logic.js 不许碰 DOM」过去只是注释里的约定 ——
 * (注意:视图层 import db/Store 读数据是设计内行为,被禁的是原语关键字)
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
const { execFileSync, spawnSync } = require('node:child_process');

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
    ui: 4, 'native-tabs': 4, derived: 5,
    sheets: 6, accounts: 6, stats: 6, notify: 6,
    'views/home': 7, 'views/trip': 7, 'views/orders': 7, 'views/pay': 7, 'views/stats': 7, 'views/settings': 7,
    'order-forms': 7, 'order-actions': 7, detail: 7, 'share-image': 7, export: 7, 'avatar-crop': 7,
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
  // 口径声明:import 图正则只认单引号相对路径(当前代码风格下无遗漏);
  // 改风格(双引号/裸模块名)时必须同步放宽,否则本文件整体失效。
  const CHECK = ['views/', 'detail.js', 'order-forms.js', 'order-actions.js', 'accounts.js', 'stats.js', 'sheets.js', 'share-image.js', 'export.js', 'avatar-crop.js', 'notify.js', 'actions.js', 'main.js'];
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

/* ---------- 规则 6:线束与组合根的注册一致性(第六轮 review 附-4 建议) ---------- */

test('harness 与 main.js 的 register* 调用集合一致', () => {
  // harness-entry.mjs 复刻了一份组合根:main.js 未来新增 register* 时,
  // 线束若缺注册,测试会在「组合根未注入」的假象下静默通过 —— 这里静态钉住两边集合。
  const mainSrc = fs.readFileSync(path.join(APP, 'main.js'), 'utf8');
  const harnessSrc = fs.readFileSync(path.join(ROOT, 'tests', 'harness-entry.mjs'), 'utf8');
  const regs = src => new Set([...src.matchAll(/register([A-Z]\w*)\(/g)].map(m => 'register' + m[1]));
  const a = regs(mainSrc), b = regs(harnessSrc);
  const onlyMain = [...a].filter(x => !b.has(x));
  const onlyHarness = [...b].filter(x => !a.has(x));
  assert.deepEqual([...onlyMain, ...onlyHarness], [],
    `注册集合不一致:仅 main.js 有 [${onlyMain}]、仅 harness 有 [${onlyHarness}]——两边必须同步注册`);
});

/* ---------- CI 入口:测试必须经过依赖安装与 harness 构建 ---------- */

test('CI 两个回归 job 都先安装依赖,再运行完整 npm test', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.doesNotMatch(workflow, /run:\s*node --test tests\//, 'CI 不能绕过 npm test 的 harness 构建步骤');
  for (const job of ['web', 'native']) {
    const match = workflow.match(new RegExp(`\\n  ${job}:[\\s\\S]*?(?=\\n  [a-z]+:|$)`));
    assert.ok(match, `CI 缺少 ${job} job`);
    assert.match(match[0], /run:\s*npm ci(?:\s|$)/, `${job} job 必须先安装依赖`);
    assert.match(match[0], /run:\s*npm test\b/, `${job} job 必须运行完整 npm test`);
    assert.ok(match[0].indexOf('npm ci') < match[0].indexOf('npm test'), `${job} job 必须先安装依赖再测试`);
  }
  assert.match(workflow, /branches:\s*\[main, native-app, tanji-native-hg\]/);
  assert.match(workflow, /HG 构建产物校验[\s\S]*?check-web-sync\.cjs --artifact-only/);
  assert.match(workflow, /main \/ native 漂移校验[\s\S]*?check-web-sync\.cjs --main-ref origin\/main/);
});

test('HG 产物校验显式绕过漂移锁,且禁止更新旧锁文件', () => {
  const script = path.join(ROOT, 'scripts', 'check-web-sync.cjs');
  const output = execFileSync(process.execPath, [script, '--artifact-only'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(output, /www 构建产物与源码一致/);
  assert.match(output, /跳过 main \/ native 跨版本漂移校验/);

  const result = spawnSync(process.execPath, [script, '--artifact-only', '--update'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HG 独立分支不更新 main \/ native 漂移锁/);
});

/* ---------- 规则 7:PWA 缓存策略(第七轮 review P1) ---------- */

test('sw.js:app.js 在 ASSETS 且必须 network-first', () => {
  // app.js 是入库构建产物、随提交常变;cache-first + VERSION 不 bump =
  // 老 PWA 永久吃旧包(评审实证:v0.5.0 后 12+ 提交未 bump)。
  // 防线:network-first 让内容更新即时生效,VERSION bump 只兜 ASSETS 成员变更。
  const sw = fs.readFileSync(path.join(ROOT, 'www', 'sw.js'), 'utf8');
  assert.ok(sw.includes("'./app.js'"), 'ASSETS 缺少 ./app.js');
  assert.ok(!sw.includes("'./storage.js'"), 'ASSETS 还留着已删除的 storage.js');
  assert.match(sw, /fresh=[^;]*\/app\.js/, 'app.js 必须走 network-first(fresh),不许回 cache-first');
  assert.doesNotMatch(sw, /storage\.js'\)/, 'fresh 规则里还有死掉的 storage.js 条目');
});
