/**
 * 探记 TanJi —— 接线一致性(静态检查)
 *
 * 为什么要这一类测试
 * ------------------
 * 2026-11-22 复查时发现:src/cap-plugins.js 把插件桥挂在 `window.TanJiCap`,
 * 而 www/storage.js 第 1 行读的是 `window.TanjiCap`(小写 j)。
 * 大小写只差一个字母,JS 不会报错,后果却是:
 *   CAP = null → isNative = false → 整条原生路径(SQLite / 本地通知 / 分享面板)
 *   被静默跳过,数据退回 IndexedDB 照样能存 —— 肉眼完全看不出问题,
 *   只有把 App 装到真机、去查那台设备上到底有没有 SQLite 库才会发现。
 *
 * 这类"接错线"没法靠跑起来发现(跑起来是好的,只是走错了路),只能静态比对。
 * 同理,保存按钮一旦被写回滚动区,也只有量一下位置才知道 —— 这里先静态钉住结构,
 * 运行期的位置断言在 tests/browser-smoke.cjs 里。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', 'www');
const read = name => fs.readFileSync(path.join(WEB, name), 'utf8');

const index = read('index.html');
// P0 拆层后:storage.js → src/app/storage.js;平台桥读取上移到 env.js;
// 事件委托 → actions.js;initShotInput → order-forms.js;refreshVisible → ui.js
const readApp = name => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', name), 'utf8');
const envSrc = readApp('env.js');
const actionsSrc = readApp('actions.js');

test('插件桥的全局名必须与消费端读的名字完全一致', () => {
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'src', 'cap-plugins.js'), 'utf8');
  const exposed = bridge.match(/window\.(\w*Cap)\s*=/);
  assert.ok(exposed, 'src/cap-plugins.js 里找不到 window.XxxCap = {...} 的桥定义');

  const consumed = envSrc.match(/window\.(\w*Cap)/);
  assert.ok(consumed, 'src/app/env.js 里找不到对插件桥的读取');

  assert.equal(
    exposed[1],
    consumed[1],
    `插件桥挂的是 window.${exposed[1]},而 storage.js 读的是 window.${consumed[1]}:` +
      '大小写不一致会让 CAP 为 null,原生 SQLite/通知/分享被静默跳过(不报错,只是全部不生效)',
  );

  // 已构建的产物也要跟着改,否则改了源码忘了 build:plugins 一样是坏的
  const bundle = read('cap-plugins.js');
  assert.ok(
    bundle.includes(`window.${consumed[1]}=`),
    `www/cap-plugins.js 里没有 window.${consumed[1]}=:记得跑 npm run build:plugins`,
  );
});

test('脚本加载顺序:插件桥最先,app.js 模块入口最后', () => {
  const tags = [...index.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.deepEqual(
    tags,
    ['cap-plugins.js', 'imaging.js', 'logic.js', 'geo.js'],
    'www 经典脚本加载顺序变了:app 模块依赖前面的全局对象(TanJiCap/TanJiImage/TanJiLogic/TanJiGeo)',
  );
  assert.ok(
    index.includes('<script type="module" src="app.js"></script>'),
    '缺少 app.js 模块入口(P0 拆层后页面逻辑由它加载,且必须在经典脚本之后)',
  );
  assert.ok(
    index.indexOf('src="app.js"') > index.indexOf('src="geo.js"'),
    'app.js 必须排在经典脚本之后加载',
  );
});

test('清除催收提醒必须接 cancelSnooze(只撤备忘段),不能接删单语义的 cancelOrder', () => {
  // P2-1 的接线层防线:clear-remind 若接 cancelOrder,会连带撤掉同单的 24h 出片提醒。
  // Notify.cancelSnooze 原语有行为级测试(native-reliability),但不经过点击处理器——
  // 变异实测把处理器改回 cancelOrder 时其余测试全绿,接线只能在这里静态钉住。
  const m = actionsSrc.match(/case 'clear-remind':\{[\s\S]*?break\}/);
  assert.ok(m, '找不到 clear-remind 处理器(case 块结构可能变了)');
  assert.match(m[0], /Notify\.cancelSnooze\(/, 'clear-remind 应调用 Notify.cancelSnooze(只撤备忘段)');
  assert.doesNotMatch(m[0], /cancelOrder/, 'clear-remind 不能调 cancelOrder(删单语义,会连带撤掉 24h 出片提醒)');
});

test('保存按钮必须落在常驻操作条里,而不是滚动区', () => {
  // 新建预约:滚动区以 flush 结尾,紧跟一个 sheet-foot 包住保存按钮
  const create = index.match(
    /<div class="sheet-body flush">[\s\S]*?<\/div>\s*<div class="sheet-foot"><button class="btn primary" data-act="save-order">/,
  );
  assert.ok(create, '新建弹层:保存按钮应放在 sheet-body 之外的 sheet-foot 里(否则要滚到底才看得见)');

  // 编辑订单:body 是动态渲染的,foot 必须是静态的常驻按钮
  assert.match(
    index,
    /<div class="sheet-body flush" id="edit-body"><\/div>\s*<div class="sheet-foot"><button class="btn primary" data-act="save-edit">/,
    '编辑弹层:保存按钮应放在 sheet-foot 里,不能塞进 edit-body',
  );

  assert.equal(
    (index.match(/data-act="save-order"/g) || []).length,
    1,
    '保存预约按钮应只有一个(否则同一动作有两处入口,一处漏改就会出现"看得见点不动")',
  );
  assert.equal((index.match(/data-act="save-edit"/g) || []).length, 1, '保存修改按钮应只有一个');
});

test('随手拍输入在只读模式下必须拒绝写入(change 处理器绕过 data-act 白名单)', () => {
  // shot-pick 在 blocked 白名单里(能打开相册),但 initShotInput 的 change 处理器
  // 不经过 data-act 守卫——若不自带 Store.blocked 检查,只读模式下会改内存、
  // 报"已随手拍"的成功提示,而 save() 已被拦截,关 App 即丢。
  const m = readApp('order-forms.js').match(/function initShotInput\(\)\{[\s\S]*?\n\}/);
  assert.ok(m, '找不到 initShotInput(函数结构可能变了)');
  const guardIdx = m[0].indexOf('Store.blocked');
  const writeIdx = m[0].indexOf('photoThumb=');
  assert.ok(guardIdx > 0, 'initShotInput 里应有 Store.blocked 检查');
  assert.ok(writeIdx > 0, 'initShotInput 里应能定位到 photoThumb 写入');
  assert.ok(guardIdx < writeIdx, '只读检查必须发生在写入 photoThumb 之前');
});

/* ---------- P0 拆分安全网(2026-11-22) ---------- */

test('markup 里出现的每个 data-act 都必须在事件委托里有对应 case', () => {
  // 拆层前的接线安全网:静态枚举全部 data-act(含 JS 模板串里字面写死的),
  // 逐个断言事件委托 switch 有对应 case —— 少一个就是"看得见点不动"的按钮。
  // 注意 case 只在事件委托段内统计:chipMatch 里还有一个 switch(ui.chip),
  // 它的 'wait'/'doing' 等是筛选值,不是动作,不能拿来抵数。
  const appAll = fs.readdirSync(path.join(__dirname, '..', 'src', 'app'), { recursive: true })
    .filter(f => String(f).endsWith('.js'))
    .map(f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', String(f)), 'utf8'))
    .join('\n');
  const acts = [...new Set([...(index + '\n' + appAll).matchAll(/data-act="([a-z0-9-]+)"/g)].map(m => m[1]))];
  assert.ok(acts.length >= 60, `只枚举到 ${acts.length} 个 data-act,数量异常,正则或 markup 可能变了`);
  const delegation = actionsSrc.slice(actionsSrc.indexOf("document.addEventListener('click'"));
  const cases = new Set([...delegation.matchAll(/case '([a-z0-9-]+)':/g)].map(m => m[1]));
  const missing = acts.filter(a => !cases.has(a));
  assert.deepEqual(
    missing,
    [],
    `这些 data-act 在事件委托里没有对应 case(点了没反应):${missing.join(',')}`,
  );
});

/* ---------- 第五轮深度 review 的回归(2026-11-22) ---------- */

test('前台刷新要按自然日重排每日催收汇总', () => {
  // 每日 09:00 汇总是一条 repeats:true 的通知,body 在排程那刻就冻结了。
  // 订单跨过催收阈值是「时间推移」而不是「数据变化」,没有任何数据事件会触发重排 ——
  // 只能靠日切这条时间轴。漏了这一步,拍完第 16 天的单永远不进汇总。
  const m = readApp('ui.js').match(/function refreshVisible\(\)\{[\s\S]*?\n\}/);
  assert.ok(m, '找不到 refreshVisible(函数结构可能变了)');
  assert.match(m[0], /syncDailyOnNewDay\(\)/, '前台刷新必须按日重排每日催收汇总');
  // 日切重排不能排在「正在输入就跳过」之后,否则用户正打着字,汇总永远停在昨天的口径
  const syncIdx = m[0].indexOf('syncDailyOnNewDay()');
  const inputIdx = m[0].indexOf("activeElement");
  assert.ok(syncIdx < inputIdx, '日切重排必须排在输入框检查之前');
});

test('切后台/关页前要排干待写队列', () => {
  // 原生端每次 save() 都是一次异步 SQLite 写:界面早显示「已保存」了,真正落盘还在队列里。
  // 用户点完「确认收款」立刻上滑杀 App,这一笔就没了 —— 没有挂起前刷盘就守不住。
  // 断言要盯住真正的调用语句,不能只匹配函数名(注释里也写着这两个词,会假绿)。
  const mainSrc = readApp('main.js');
  assert.match(
    mainSrc,
    /addEventListener\('visibilitychange',[\s\S]{0,120}flushPendingWrites\(\)/,
    '切后台(visibilitychange=hidden)必须排干待写队列',
  );
  assert.match(
    mainSrc,
    /addEventListener\('pagehide',\s*flushPendingWrites\)/,
    '关页(pagehide)必须排干待写队列',
  );
});

test('里程碑未来节点不置 disabled:前置守卫的提示必须点得到', () => {
  // 置了 disabled,按钮就点不动,用户只会看到「点了没反应」;
  // 而 mark() 里那句「请先完成『提审』再标记『副片发出』」是更有用的反馈。
  // 用 aria-disabled + 变暗表达「还没到这一步」,点击交给前置守卫解释原因。
  const m = readApp('detail.js').match(/function mileStep\([\s\S]*?\n\}/);
  assert.ok(m, '找不到 mileStep(函数结构可能变了)');
  assert.doesNotMatch(m[0], /disabled aria-disabled/, '未来节点不能置 disabled(守卫提示会永远点不到)');
  assert.match(m[0], /aria-disabled="true"/, '仍应保留 aria-disabled 表达「还没到这一步」');
});
