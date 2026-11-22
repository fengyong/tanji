# P0 重构实施规格书:index.html 拆层 + ESM 化(v3)

> **这份文档是实施合同。** 执行人(agent 或人)按本文档逐字执行;
> 验收人按第 8 章清单逐条验收。规格未覆盖的情况,走第 7 章偏差协议,
> **禁止自由发挥**。
>
> 动手前必读仓库根目录 `AGENTS.md`(提交前缀、推送账号、禁 `git add -A`,全部适用)。
>
> **版本基线(v3,2026-11-22)**:行号与结构以 `native-app@9b113d3` 实测为权威;
> 行号只是导航,分节注释 `/* ================= XXX ================= */` 是权威切缝。
>
> **v3 重要变更(推翻 v2 的"main 先行"决策)**:经核实,main 分支是零构建
> 纯静态站——平铺布局、无 package.json/npm/esbuild、无 logic.js、
> index.html 为 46 个提交前的老单体。它无法作为拆分基线。
> **拆分改在 `native-app` 进行,main 全程不动。**
> 后果(已确认可接受):index.html / storage.js 与 main 的人工合并关系
> 本来就存在(DIVERGED),本轮不增加也不减少;main 将来以 native 为真源
> 追平结构,是独立项目,不在本规格范围。
>
> v2 变更:行号全量重测;新增 `syncDailyOnNewDay` 归属;ui.js 依赖规则放宽(§5 规则 4)。

## 0. 一句话目标

把 `www/index.html` 内约 1830 行内联 script(616–2450 行)按既有分节切成
`src/app/` 下的 ESM 模块,esbuild 打包为 `www/app.js`;
**行为逐字节不变**,全部工作在 `native-app` 分支进行。

## 1. 红线(违反任意一条,本次提交作废)

1. **纯搬运**:除第 4 章列出的 3 处"特许签名调整"外,不改任何函数体、不改执行顺序、
   不改文案、不改 CSS、不改 markup。
2. **基线是 `native-app`**:工作分支从 `native-app` 切;**main 分支全程一个字节都不碰**。
3. `www/logic.js` **一个字节都不动**(它是 CJS 测试直接 require 的规格文件)。
4. `www/imaging.js`、`www/geo.js`、`www/cap-plugins.js`、`www/vendor/` 本轮不动;
   `www/sw.js` 仅 P0-4 由验收人改(见 §6 P0-4)。
5. 每阶段结束必须 `npm test` 全绿 + `npm run check` 通过,才允许进入下一阶段。
6. 提交一律显式路径;提交标题遵守 AGENTS.md 硬规则 1(`<agent>/<模型> <类型>(<作用域>): ...`)。

## 2. 目标结构(native-app 分支)

```
src/app/                  ← 新增,ESM 源码(native-only,main 无对应物)
  main.js                 启动编排(原 2398–2449)
  env.js                  CAP / isNative / APP_STORE_URL / LEGAL_BASE —— 平台差异唯一入口
  util.js                 纯工具(无状态、零依赖)
  ui.js                   ui 状态对象 + 时钟/日切封装 + showTab / renderAll / refreshVisible
  derived.js              派生逻辑薄包装 + 数据查找 + chip/标签常量
  demo.js                 demoSeed
  storage.js              从 www/storage.js 平移 + 显式 export(函数体不动)
  sqlite-bytes.js         buildSqliteBytes + initSqlite(SQLite 字节构建)
  export.js               导出 CSV/JSON/.db + download / nativeShareFile
  accounts.js             多账号体系 + 勋章
  order-forms.js          新建预约 / 编辑订单 / 冲突检测 / 随手拍输入
  order-actions.js        状态操作 / 收款 / 催收 / 平台预计到账 / 到店定位回写
  detail.js               详情弹层 + MILE_LABEL + rerenderDetail
  share-image.js          今日行程分享图
  sheets.js               弹层 / Toast / 手势
  stats.js                统计入口 + 顶栏按钮
  actions.js              事件委托(P0-3 改为 action 注册表)
  views/
    home.js trip.js orders.js pay.js stats.js   ← 五个 render 函数各一文件
www/
  index.html              只剩 markup + style + script 外链
  app.js                  ← 构建产物(同 cap-plugins.js 先例:native-only,别手改)
  logic.js imaging.js geo.js cap-plugins.js vendor/ icons/  不动
  storage.js              ← 删除(源码已平移到 src/app/storage.js)
```

`package.json` 新增:

```json
"build:app": "esbuild src/app/main.js --bundle --format=esm --outfile=www/app.js",
"sync": "npm run build:plugins && npm run build:app && cap sync ios"
```

`www/index.html` 的 script 区最终形态(顺序固定):

```html
<script src="cap-plugins.js"></script>
<script src="imaging.js"></script>
<script src="logic.js"></script>
<script src="geo.js"></script>
<script type="module" src="app.js"></script>
```

(sql.js 的 vendor 脚本与 inline 初始化保持原位置不动;`TanJiLogic` / `TanJiGeo` /
`TanJiImaging` 继续以全局存在,ESM 内通过 `globalThis.TanJiLogic` 访问。)

## 3. 符号归属总表(唯一权威,执行人不许自创归属)

来源行号 = `native-app@9b113d3` 的 `www/index.html`;锚点 = 分节注释。
**每个分节内未单独列名的函数/常量,跟随其所在分节整体搬迁。**

### util.js —— 零依赖,不许 import 任何 app 内模块

| 符号 | 来源(锚点:工具段) |
|---|---|
| `$` `pad` `esc` `dOff` `toISO` `fmtD` `fmtHM` `fmtDT` `DOW` `dowOf` `greeting` `validDateTime` `nowStr` `daysBetween` | 617–648 工具段内 |
| `fmtMoney` | 645,**特许调整 A** |
| `copyText` | 901(多账号段内,clipboard 助手,允许 import env.js 读 CAP) |
| `now` `TODAY` + `tickClock()` | 620–621 + 622–625 拆分,**特许调整 B** |

**例外**:`syncDailyOnNewDay` / `lastDailySyncDay`(约 626–637,工具段内)
**不归 util.js**——它调用 `Notify.syncDaily()`,归 ui.js(见下)。

### env.js

| 符号 | 来源 |
|---|---|
| `APP_STORE_URL` `LEGAL_BASE` | 657–664 |
| `CAP` `isNative` | 从 src/app/storage.js 头部(原 www/storage.js 第 1–2 行)**上移至此**,storage.js 改为从 env.js import |

### ui.js —— 允许 import util.js 与 storage.js(仅用 `Notify`,见 §5 规则 4)

| 符号 | 来源 |
|---|---|
| `ui` 状态对象 | 651 |
| `refreshClock` | 622–625 的 ui 部分(调 `tickClock()` 后同步 `ui.selDay/vMon`) |
| `syncDailyOnNewDay` `lastDailySyncDay` | 约 626–637(工具段内,随 refreshClock 成对搬迁) |
| `showTab` `renderAll` | 2206–2219(Tab 路由段) |
| `refreshVisible` | 2406–2411(启动段内;detail 重绘经 main.js 注入,见 §5 规则 2) |

### derived.js —— 允许 import storage.js(只读 db)

| 符号 | 来源 |
|---|---|
| 全部 `TanJiLogic` 薄包装(workOf … upcoming7、deliverLate) | 派生逻辑段(794–828) |
| `WORK_CLS` `PAY_CLS` `METHODS` `METHOD_CLS` `REVIEW_LABEL` | 派生逻辑段内 |
| `payChip` `workChip` | 派生逻辑段内 |
| `byId` `gpsText` `storeOf` | 1013–1016(从多账号段内抽出) |

### 其余文件按分节整段搬迁

| 目标文件 | 锚点(起始行) | 备注 |
|---|---|---|
| demo.js | 独立演示数据(666–731) | |
| sqlite-bytes.js | 持久化(732–793) | 含 initSqlite;**保留"后台异步 init、失败静默降级"时序** |
| accounts.js | 多账号体系(829–1017)+ 单日勋章(1018–1030) | **剔除** copyText/initShotInput/capturePlace/byId/gpsText/storeOf(已另行归属) |
| export.js | 导出(1031–1148) | |
| order-forms.js | 新建预约(1149–1210)+ 编辑订单(1211–1324)+ initShotInput(972) | 含 updateConflict(1164) |
| order-actions.js | 状态操作(1325–1393)+ 催收/平台到账(1394–1448)+ capturePlace(1003) | **剔除** rerenderDetail(1326,归 detail.js) |
| detail.js | 详情弹层(1449–1613)+ rerenderDetail(1326) | MILE_LABEL(1450)/openDetail(1509) |
| share-image.js | 今日行程分享图(1614–1664) | |
| sheets.js | 弹层 / Toast(1665–1741) | showSheet/closeSheets/toast/initSheetGestures |
| stats.js | 统计(1742–1747)+ 顶栏按钮(1748–1756) | |
| views/*.js | 渲染五段(1757–2204) | renderHome/renderTrip/renderOrders/renderPay/renderStats 一函数一文件 |
| actions.js | 事件委托(2221–2397) | 74 个 case(P0-3 改注册表) |
| main.js | 启动(2398–2449) | 启动序列,顺序逐行保持 |

### storage.js(src/app/storage.js)

- 内容 = 现 `www/storage.js`(644 行)全文,仅做三处机械改动:
  1. 顶部 `CAP/isNative` 两行删除,改为 `import {CAP,isNative} from './env.js'`;
  2. 给以下符号加 `export`(已与当前源码逐一核对):
     `db` `Store` `acquireWriter` `storageKey` `save` `persistFull`
     `loadState` `switchMode` `replaceData` `backupDocument` `accountCopyText`
     `previewImport` `confirmImport` `restoreCheckpoint` `exportCheckpoint`
     `nativeOpen` `setStorageStatus` `Notify` `cloneState`;
  3. 其余一律不动(包括 `let db` 整体重赋值的写法——ESM live binding 兼容,
     但**任何模块外对 db 的赋值都是红线**)。

## 4. 特许签名调整(全方案仅 3 处,其余改动走偏差协议)

- **A. `fmtMoney(n)` → `fmtMoney(n, masked)`**:切断 util→ui 依赖。
  调用点全部改为 `fmtMoney(x, ui.privacy)`(用 `grep -n 'fmtMoney('` 枚举,
  逐个替换,禁止批量正则误伤函数定义本身)。
- **B. 时钟拆分**:`now`/`TODAY` 留 util.js,新增 `tickClock()` 返回 `{changed, previous}`;
  `refreshClock()` 留 ui.js,负责 `ui.selDay/vMon` 同步。逻辑逐行等价。
- **C. storage.js 加 export**(见 §3 末表),不算行为变化。

## 5. 依赖方向(单向;架构测试强制)

```
util ← env ← ui ← derived ← views ← {demo, sqlite-bytes, export, accounts,
        order-forms, order-actions, detail, share-image, sheets, stats}
        ← actions ← main
storage.js 被 ui 及以上各层 import;storage.js 本身只允许 import env.js + globalThis 内核
```

已知循环与既定解法(执行人照做,不许另起方案):

1. `renderAll`(ui.js)内部调用五个 `render*`(views/)与 `setStorageStatus`(storage.js)
   → ui.js **不 import views**;改为 ui.js 暴露注册形式:
   `registerRenderers({home,trip,orders,pay,stats})`,由 main.js 在启动时注入。
2. `refreshVisible` 需要 `rerenderDetail`(detail.js)→ 同样由 main.js 注入:
   `registerDetailRerender(rerenderDetail)`。
3. `refreshClock` 在 views/actions 中被大量直接调用 → 它留在 ui.js,各层正常 import,
   不构成循环。
4. `syncDailyOnNewDay`(ui.js)调 `Notify.syncDaily()`(storage.js)→ ui.js 允许
   import storage.js;storage.js 不 import 任何 app 内模块,不构成循环。

## 6. 阶段执行卡

### P0-0 安全网(分支 `refactor/p0-0-safety-net`,从 `native-app` 切)

1. 扩充 `tests/wiring.test.cjs`:静态枚举 markup 中全部 `data-act` 值,
   断言每个值在事件委托 switch 中有对应 `case`(当前代码上先跑绿)。
2. `tests/browser-smoke.cjs` 补关键流程断言(新增订单 → 标记收款 → 导出 JSON)。
3. 验收:`npm test` 全绿、`npm run test:smoke` 通过。合回 `native-app`。

### P0-1 纯搬运(分支 `refactor/p0-1-split`,从 `native-app` 切)

1. 按 §3 建 `src/app/` 全部文件;函数体逐段复制,只补 import/export。
2. `package.json` 加 `build:app`;`www/index.html` 删除内联 script 与 storage.js 外链,
   按 §2 改 script 区;删除 `www/storage.js`。
3. 测试改造:`tests/native-reliability.test.cjs` / `web-reliability.test.cjs` 中
   `require(www/storage.js)` 改为 `await import('../src/app/storage.js')`,
   在 import 前预置所需 globalThis mock;`export-schema.test.cjs` 若引用
   `buildSqliteBytes` 的源码位置,同步改为 `src/app/sqlite-bytes.js`;其余测试不动。
4. 收敛方法:跑 `npm run build:app`,esbuild 报"未定义"即缺 import,逐个补,
   直至零报错;再跑全量测试。
5. 验收:`npm test` 全绿;smoke 通过;`grep -c 'function ' www/index.html` 为 0。

### P0-2 平台收口(同分支继续)

1. 确认 `CAP`/`isNative`/`TanjiCap` 只出现在 `env.js` 与 `src/cap-plugins.js`:
   `grep -rn 'TanjiCap' src/app/ | grep -v 'env.js'` 必须为空。
2. 确认 `indexedDB`、`localStorage`、`sqlite3InitModule` 只出现在
   `storage.js` / `sqlite-bytes.js` / `main.js`(启动探针):
   对 `views/ detail.js order-*.js accounts.js stats.js sheets.js share-image.js`
   执行同样 grep,必须为空。
3. 审查 sqlite-bytes.js 初始化时序:不 await、后台 init、失败降级——与原文逐行一致。

### P0-3 动作注册表(同分支继续)

1. actions.js 的 switch(74 个 case)改为:
   ```js
   const ACTIONS={};
   export function registerAction(name,fn){ACTIONS[name]=fn}
   ```
   各业务文件(`order-forms.js` 等)在文件内 `registerAction('save-order', ...)` 自注册;
   `actions.js` 只剩 `document.addEventListener('click', …)` 分发逻辑
   (含事件委托开头的 Store.ready/busy/blocked 守卫,逐行保留,
   blocked 白名单数组原样保留)。
2. wiring 测试升级:断言「markup 全部 data-act」⊆「已注册 action」——
   注册表来自对 src/app 源码的静态扫描(不执行代码)。
3. 验收:`npm test` 全绿;人为注释掉一个注册,测试必须变红(验证后恢复)。

### P0-4 同步与离线收口(**验收人执行**,执行人不做)

背景:`www/sw.js` 目前与 main 同字节、走自动拷贝,但其静态缓存清单写死
`./storage.js`——拆分后该文件不存在,`cache.addAll` 会整体失败,离线能力报废。
因此 sw.js 必须脱离"纯资产"。

1. `scripts/sync-web-assets.cjs`:
   - `MERGED_FILES` 中 storage.js 条目改为 `{ main:'storage.js', native:'src/app/storage.js' }`;
   - 把 sw.js 从 `PURE_ASSETS` 移到 `MERGED_FILES`。
2. `www/sw.js`:`ASSETS` 中 `'./storage.js'` 改为 `'./app.js'`,`VERSION` 升一位。
3. `scripts/web-sync.lock.json` 重登记:storage.js 条目 `nativePath` 改为
   `src/app/storage.js`;sw.js 转为 DIVERGED 登记;`www/app.js` 与 `src/app/**`
   **不登记**(native-only,同 cap-plugins.js 先例)。`npm run check:update`。
4. 验收:`npm run check` 通过、`npm test` 全绿、`npm run build:ios` 成功;
   模拟器人工过一遍:建单 → 收款 → 导出 .db → 断网刷新仍可用。

## 7. 偏差协议

遇到规格未覆盖/与现状冲突时:

1. **停手,不猜。** 在分支根建 `DEVIATIONS.md`,逐条记录:
   `位置 | 规格原文 | 实际冲突 | 建议处理`。
2. 单个偏差不得扩大处理范围;继续执行其余无冲突部分。
3. 验收人逐条裁决:批准 / 打回 / 修订规格。

## 8. 验收清单(验收人执行,逐条打勾)

- [ ] `grep -c 'function ' www/index.html` = 0;index.html 只剩 5 个 script 外链
- [ ] §3 总表每个符号存在于且仅存在于指定文件(抽查 20 个 + 全覆盖 grep)
- [ ] §4 之外无任何函数体 diff(`git diff native-app -- www/index.html src/app/` 逐 hunk 审)
- [ ] `grep -rn 'TanjiCap\|indexedDB\|localStorage' src/app/views/ src/app/detail.js src/app/order-*.js src/app/accounts.js src/app/stats.js src/app/sheets.js src/app/share-image.js` 为空
- [ ] `grep -rn "from '" src/app/ | grep -vE "util|env|ui|derived|storage"` 符合 §5 方向
- [ ] `npm test` 全绿(含升级后的 wiring)、`npm run test:smoke` 通过
- [ ] wiring 测试对"删除一个注册"确实变红
- [ ] `npm run check` 通过;人工合并关系恰为 3 条且锁与 sync 脚本一致:
      index.html、storage.js→src/app/storage.js、sw.js
- [ ] `npm run build:ios` 成功,模拟器人工过一遍:建单 → 收款 → 导出 .db → 断网刷新可用
- [ ] 演示/工作双模式切换、多 Tab 写入冲突提示,各验一次
- [ ] DEVIATIONS.md 为空或每条均有验收人裁决记录
