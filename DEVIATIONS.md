# DEVIATIONS — P0 拆层偏差记录

> 按规格书 §7 记录。裁决人:架构验收(kimi/k2)。状态:全部批准。

## #1 toast-undo 提取 dismissToast(glm)

| 项 | 内容 |
|---|---|
| 位置 | src/app/sheets.js、actions.js 的 `case 'toast-undo'` |
| 规格原文 | 纯搬运,不改函数体 |
| 实际冲突 | 原 case 体前四行操作 sheets.js 的模块内 `toastAction/toastTimer`;ESM 的 import 绑定只读,case 体无法直接改另一个模块的 let |
| 处理 | sheets.js 导出 `dismissToast()`(逐行等价于原 case 体前四行),case 改为调用它。**批准** |

## #2 启动序列 lastDailySyncDay 赋值 → markDailySynced(glm)

| 项 | 内容 |
|---|---|
| 位置 | src/app/ui.js、main.js 启动序列 |
| 实际冲突 | 启动段原句 `lastDailySyncDay=TODAY` 是对另一个模块 let 的赋值,ESM 禁止 |
| 处理 | ui.js 导出 `markDailySynced(day=TODAY)`,语义等价。**批准**(参数化为后续测试留口) |

## #3 跨层晚绑定符号在组合根挂回 globalThis(glm + kimi 扩充)

| 项 | 内容 |
|---|---|
| 位置 | src/app/main.js |
| 实际冲突 | storage.js / ui.js / derived.js / views 的函数体逐字节搬运,按经典脚本时代的全局晚绑定调用 `buildSqliteBytes` `demoSeed` `accMatch` `workOf` 等符号;§3/§5 禁止这些模块互相 import(成环) |
| 处理 | 组合根统一 `Object.assign(globalThis,{…})` 挂回,恢复原语义。glm 初版 16 个;kimi 验收时经全模块静态扫描补齐 5 个漏项(`mark/nowStr/workOf/storeOf/accChipbarHTML`)+ 冒烟依赖 4 个(`renderTrip/statsFor/backupDocument/previewImport`)+ `Store` 与 `db`(db 为活 getter)。**这是过渡性设计**:后续 P1+ 应逐个改显式 import 并从此表删除,每删一个都是依赖关系的真实修复。**批准** |

## #4 main.js 副作用引入 actions.js(kimi)

| 项 | 内容 |
|---|---|
| 位置 | src/app/main.js |
| 实际冲突 | actions.js 无导出,main.js 不 import 时 esbuild 将其 tree-shake,全局 click 委托整个消失(页面能渲染、点什么都不响应;测试绿是因为线束自己 import 了它) |
| 处理 | main.js 增加 `import './actions.js'` 副作用引入。**批准(必修)** |

## #5 测试支持导出(kimi)

| 项 | 内容 |
|---|---|
| 位置 | src/app/storage.js / sheets.js / order-actions.js / order-forms.js / share-image.js / views/trip.js |
| 实际冲突 | reliability 测试直接调用 `idb` `validateState` `readSnapshot` `parseRemindLog` `toastAction` `undoPay` `conflictFor` `buildTodayImage` `orderRowTrip`,拆分前它们是全局,拆分后不可见 |
| 处理 | 以上符号加 `export`(仅导出,不改实现)。**批准** |

## #6 sw.js 缓存清单 storage.js → app.js(kimi,P0-4 前置)

| 项 | 内容 |
|---|---|
| 位置 | www/sw.js、scripts/sync-web-assets.cjs、scripts/check-web-sync.cjs、scripts/web-sync.lock.json |
| 实际冲突 | ASSETS 写死 `./storage.js`,拆分后 404 导致 `cache.addAll` 整体失败、SW 永不激活、离线能力报废(冒烟的离线重载用例抓到) |
| 处理 | 清单改 `./app.js`、VERSION 升 v0.5.0;sw.js 与 storage.js 在 sync 脚本中转为 MERGED_FILES;锁基线重登记。**批准(必修)** |

## #7 测试基础设施(kimi)

- 新增 `tests/harness-entry.mjs` + `npm run build:test-harness`:把 ESM 模块打包成 IIFE 线束,在 vm 里拼回全局面,`export let` 挂活 getter(db/now/TODAY/lastDailySyncDay/toastAction);
- `npm test` 改为 `node --test "tests/**/*.test.cjs"`(本机 Node 24 不认目录参数);
- 测试中 `db=…` 整体重赋值改为 `__replaceDb(…)`(清空+变异,ESM 不允许外部重绑定);
- `.p0-tooling/` 为 glm 的搬运 codemod 与校验脚本,拆分完成后不再适用(其基准是含内联脚本的旧 index.html),不纳入版本库。
