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
const storage = read('storage.js');

test('插件桥的全局名必须与消费端读的名字完全一致', () => {
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'src', 'cap-plugins.js'), 'utf8');
  const exposed = bridge.match(/window\.(\w*Cap)\s*=/);
  assert.ok(exposed, 'src/cap-plugins.js 里找不到 window.XxxCap = {...} 的桥定义');

  const consumed = storage.match(/window\.(\w*Cap)/);
  assert.ok(consumed, 'storage.js 里找不到对插件桥的读取');

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

test('脚本加载顺序:插件桥最先,storage 最后', () => {
  const tags = [...index.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.deepEqual(
    tags,
    ['cap-plugins.js', 'imaging.js', 'logic.js', 'geo.js', 'storage.js'],
    'www 脚本加载顺序变了:storage.js 依赖前面几个模块的全局对象(TanJiCap/TanJiImage/TanJiLogic/TanJiGeo)',
  );
});

test('清除催收提醒必须接 cancelSnooze(只撤备忘段),不能接删单语义的 cancelOrder', () => {
  // P2-1 的接线层防线:clear-remind 若接 cancelOrder,会连带撤掉同单的 24h 出片提醒。
  // Notify.cancelSnooze 原语有行为级测试(native-reliability),但不经过点击处理器——
  // 变异实测把处理器改回 cancelOrder 时其余测试全绿,接线只能在这里静态钉住。
  const m = index.match(/case 'clear-remind':\{[\s\S]*?break\}/);
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
