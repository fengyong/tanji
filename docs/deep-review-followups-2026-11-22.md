# 第三轮深度 review 修复说明(供 review 核实)

> 生成时间:2026-11-22 · 对应提交:`6ef8485`(分支 `native-app`,父提交 `f83afd1`)
> 改动规模:8 个文件,+183 / -38 · 本文每条结论都附文件路径、行号或测试名,可独立复核。
> 前置背景:本轮是对 v0.6 的独立复审(非复核前两轮结论),复审方法为 vm 沙箱加载真实页面脚本
> + `node:sqlite` 高保真 mock,先复现问题再改代码;全部问题均有实证,非静态猜测。

---

## 0. 一句话总览

复审发现 **2 个 P2 + 7 个 P3**,本提交全部修复并新增 4 条回归测试(111 → 115 项)。
两个 P2 都在本地通知链路:一个会让用户清除催收备忘时静默丢失出片提醒,
一个会让 work/demo 两套数据的同订单号通知互相覆盖。其余 P3 为权限时机、数据脏写、
工程配置与文档漂移。**未修两项**(站点部署、main 侧 sw.js)及原因见第 4 节。

---

## 1. P2 级问题(为何要修 + 修了什么 + 如何核实)

### P2-1 清除催收备忘会连带撤销同单的 24h 出片提醒

**为何要修(根因)**

`index.html` 的 `clear-remind` 处理器原本调用 `Notify.cancelOrder(oid)`,而 `cancelOrder`
的语义是「删单」——同时取消该订单的全部通知(备忘段 `100000+id` 与出片段 `300000+id`)。
但「清除备忘」与「删单」是两个不同意图:用户只是不想要催收闹钟,出片提醒仍应保留。
沙箱实证:某单 pending 为 `[100005, 300005]`,执行清除备忘后 pending 变为 `[]`,
出片提醒被一起撤掉,且只有后续发生 mark/编辑/切模式等无关操作时才会重排,否则到点不响。
这与上一轮已修的「通知开关连带取消」是同一类缺陷(一个动作静默撤销另一条独立通知)。

**修了什么**

| 文件 | 位置 | 改动 |
|---|---|---|
| `www/storage.js` | [cancelSnooze L595-L602](file:///Users/ola/drax-toolbox/tanji-native/www/storage.js#L595-L602) | 新增方法,只取消 `base+100000+id` 备忘段 |
| `www/storage.js` | [cancelOrder L604-L611](file:///Users/ola/drax-toolbox/tanji-native/www/storage.js#L604-L611) | 语义不变,删单仍两段同撤(备忘+出片) |
| `www/index.html` | [clear-remind L2294](file:///Users/ola/drax-toolbox/tanji-native/www/index.html#L2294) | 处理器由 `cancelOrder` 改接 `cancelSnooze` |

**如何核实**

- 回归测试:`tests/native-reliability.test.cjs` L373
  「清除单笔催收备忘只撤备忘段,同单的 24h 出片提醒必须保留」——先排两条通知,
  调 `cancelSnooze(5)` 后断言 100005 消失、300005 仍在;再调 `cancelOrder(5)` 断言 300005 也被撤。
- 人工路径:详情页对一笔待收尾款且已拍摄的单设 1/3/7 天备忘 → 点「清除」→
  系统通知队列里出片提醒应保留(真机设置→通知或后续 mark 时观察 pending)。

### P2-2 work/demo 双模式通知 id 同号互相覆盖

**为何要修(根因)**

通知 id 只由订单号派生、不含数据模式,而演示种子固定占用 id 1–17,与工作单 id 必然重叠。
沙箱实证:work 订单 2 排出 `300002` 出片提醒 → `switchMode('demo')` 后,
demo 种子里 id=2 的「澄川咖啡」用同一个 `300002` 把 work 的通知**顶掉**(同 id 后排覆盖前排);
切回 work 时 demo 的通知又被全撤。两套数据「互不干扰」的产品承诺在通知层不成立。

**修了什么**

| 文件 | 位置 | 改动 |
|---|---|---|
| `www/storage.js` | [NOTIFY_OFFSET L493-L495](file:///Users/ola/drax-toolbox/tanji-native/www/storage.js#L493-L495) | 新增模式偏移表:work base=0,demo base=500000;work 段保持 1/100000+/300000+ 不变(老用户无迁移),demo 段为 500001/600000+/800000+ |
| `www/storage.js` | syncDaily L515、syncDeliver L536、scheduleSnooze L562、toggle L623 | 全部 id 计算改为 `base+原值` |
| `www/storage.js` | [cancelMode L585-L592](file:///Users/ola/drax-toolbox/tanji-native/www/storage.js#L585-L592) | 新增方法,只撤指定模式的通知段 |
| `www/storage.js` | [replaceData L300](file:///Users/ola/drax-toolbox/tanji-native/www/storage.js#L300) | 由 `cancelAll()`(撤全模式)改为 `cancelMode()`(只撤当前模式),导入/恢复/清空不再殃及另一套数据 |
| `www/storage.js` | [isOurNotifyId L495](file:///Users/ola/drax-toolbox/tanji-native/www/storage.js#L495) | `cancelAll` 保留为全模式重置原语,识别两段 id 区间 |

**如何核实**

- 回归测试:`tests/native-reliability.test.cjs` L394
  「双模式通知分段:work/demo 同订单号互不覆盖,切换模式不撤另一模式的通知」——
  断言 work 的 300002 在切 demo 后仍在、demo 通知落在 800002/500001、切回 work 后 demo 段原样保留。
- 设计约束:分段成立的前提是 orderId < 100000,已在新建订单处加硬拦截(见 P3-4)。

---

## 2. P3 级问题清单

| # | 为何要修 | 改动位置(可点击核实) | 核实方式 |
|---|---|---|---|
| P3-1 权限弹窗时机 | 旧 `syncDeliver` 先 `ensurePermission()` 再判断有无可排提醒,保存一笔无拍摄时间的普通订单也弹通知授权,用户尚未感知通知场景 | [storage.js L539-L546](file:///Users/ola/drax-toolbox/tanji-native/www/storage.js#L539-L546):先算列表、`if(!list.length)return` 后才请求权限;`scheduleSnooze` 同样先校验 remindAt 再请求权限 | 测试 L421:无拍摄单调 syncDeliver 时 requestPermissions 调用 0 次,有提醒时 1 次 |
| P3-2 启动不重排出片提醒 | 启动只调 `syncDaily`,pending 被系统清理后出片提醒无法自愈,与研发笔记「重排时机含启动」描述不符 | [index.html L2383](file:///Users/ola/drax-toolbox/tanji-native/www/index.html#L2383) 启动序列补 `Notify.syncDeliver()` | 代码走查:启动 IIFE 内 syncDaily 与 syncDeliver 并列 |
| P3-3 里程碑可乱序标记 | 旧 `mark()` 无顺序守卫,实证可在未拍摄时直接标记「发布」,产生发布时间早于拍摄的脏数据;`workOf` 虽不崩但时间线可信度受损 | [index.html MILE_PRE + mark L1298-L1307](file:///Users/ola/drax-toolbox/tanji-native/www/index.html#L1298-L1307):前置依赖守卫(拍摄→提审→发片;发布须 deliveredAll);[mileStep L1435](file:///Users/ola/drax-toolbox/tanji-native/www/index.html#L1435) 非当前下一步圆点 `disabled`+降透明度 | 测试 L435:乱序标记返回 false 且字段保持 null,按顺序走完才允许发布 |
| P3-4 通知分段缺硬约束 | id 分段要求 orderId<100000 但此前仅靠 safeInteger 隐式约束,高单号会让分段设计失效 | [index.html L1176-L1177](file:///Users/ola/drax-toolbox/tanji-native/www/index.html#L1176-L1177):id≥100000 显式 fail 并提示 | 代码走查 saveOrder 分支 |
| P3-5 收款角标不跟筛选 | 拆账号查看时,tab 角标仍全局统计逾期数,与当前视图对不上 | [index.html L2180](file:///Users/ola/drax-toolbox/tanji-native/www/index.html#L2180):计数前加 `.filter(accMatch)` | 代码走查 renderAll;冒烟 20 项无回归 |
| P3-6 允许横屏但无适配 | Info.plist 声明支持左右横屏,整套 UI 按竖屏手机壳设计,旋转即布局错位 | [Info.plist L60-L69](file:///Users/ola/drax-toolbox/tanji-native/ios/App/App/Info.plist#L60-L69):iPhone 仅保留竖屏,iPad 保留竖屏+倒置 | `plutil -lint` 通过;真机旋转验证(待人工) |
| P3-8 裸跑 build:ios 打进旧资源 | `ios/App/App/public` 是 cap sync 生成物(gitignore),纯 checkout 缺它会构建失败或打进滞后资源;实测当前 public 与 www 哈希不一致 | [package.json L14](file:///Users/ola/drax-toolbox/tanji-native/package.json#L14):`build:ios` 前置 `npm run sync` | 读 package.json scripts;`build-device.sh` 本就先 sync,行为对齐 |
| P3-10a 类型选项缺「露营」 | demo 种子订单 13 的 cat 是「露营」,但新建/编辑表单的 15 个选项里没有,编辑该单时选项不自洽 | [index.html L549 与 L1221](file:///Users/ola/drax-toolbox/tanji-native/www/index.html#L549):两处类型表均补「露营」 | 代码走查两处 cats 数组一致 |
| P3-9 文档漂移 | README 写「共 92/111」、研发笔记写「防抖 300ms」(实际无防抖定时器)、settings 键名与旧通知 id 公式过时 | README L71/L74;native-app-notes §四表格、§5.1、文末新增本轮章节 | 与代码现状逐条比对 |

---

## 3. 验证证据(均可复跑)

| 检查项 | 命令 | 本提交实测结果 |
|---|---|---|
| 单元回归 | `npm test` | **115/115 通过**(原 111 + 新增 4:L358 改写、L373、L394、L421、L435) |
| 浏览器冒烟 | `npm run test:smoke` | 20 项检查通过,`consoleErrors: []` |
| main/native 漂移 | `npm run check` | 无漂移;锁已按 main @ `d74ffd4` 重登记 |
| plist 语法 | `plutil -lint ios/App/App/Info.plist` | OK |
| 工作树 | `git status` | 提交后干净 |
| 改动范围 | `git show --stat 6ef8485` | 8 文件 +183/-38,无夹带(README、docs/native-app-notes、Info.plist、package.json、web-sync.lock.json、native-reliability.test.cjs、index.html、storage.js) |

新增 4 条回归的文件名与测试名:

1. `tests/native-reliability.test.cjs` L373 清除单笔催收备忘只撤备忘段
2. 同文件 L394 双模式通知分段隔离
3. 同文件 L421 通知权限按需请求
4. 同文件 L435 里程碑乱序守卫
(另 L358 为适配新接线 `cancelSnooze` 的改写,断言口径收紧)

---

## 4. 明确未修项(防止 review 时误以为遗漏)

| 项 | 原因 | 归属 |
|---|---|---|
| 隐私政策/支持页线上 404(B1) | 代码与页面均已就绪,缺的是站点部署这一外部操作;2026-11-22 实测两 URL 仍 Not Found,是 App Store 审核硬阻断 | main 分支部署事务 |
| sw.js precache 缺 logic/geo/imaging/cap-plugins(P3-7) | sw.js 是 main/native 同源资产,按分支纪律 native 侧不擅改;原生端不注册 SW 不受影响,仅影响 Web/PWA 首次离线 | main 分支,需同步 bump VERSION |
| 联系邮箱占位符(B2) | **已由并行会话在父提交 `f83afd1` 修复**(fengyong@ustc.edu),本提交未重复处理 | 已闭环 |
| 真机点验(竖屏锁定、通知到达) | 模拟器/测试无法替代真机人工验收 | 待真机 |

---

## 5. Reviewer 核实清单(建议逐项打勾)

- [ ] `git show 6ef8485 --stat` 确认只有上述 8 个文件,无无关夹带
- [ ] `npm test` 本地复跑为 115/115;故意把 `cancelSnooze` 改回 `cancelOrder` 可观察 L373 测试变红(验证测试有效而非空断言)
- [ ] 读 `www/storage.js` L493-L495 分段表,手工推演 work id=2 → 300002、demo id=2 → 800002 不重叠
- [ ] 读 `www/index.html` L1298-L1307 守卫,确认 publishedAt 还额外要求 `deliveredAll(o)`(双片单只出一片不能发布)
- [ ] `npm run check` 通过;`scripts/web-sync.lock.json` 的 mainCommit 为 d74ffd4
- [ ] 确认本提交**不含**推送动作(本地提交,远端 native-app 尚未更新)
- [ ] 第 4 节三项未修项的归属判断是否认可

## 6. 提交与推送合规性(对照 docs/git-push-guide.md)

- 提交标题:`trae/solo-agent fix(native): ……`,符合「agent/模型 前缀在标题行开头」硬规则
  (指南允许写当次实际使用的 agent;项目历史提交的 mimocode 前缀同理)
- 暂存使用显式 8 个文件路径,未使用 `git add -A`
- 合回 native-app 采用 `git merge --ff-only`,无跨分支 merge、无 force
- **截至本文生成时未推送**;推送须执行
  `git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/native-app`,
  且按约定需人工确认后执行
