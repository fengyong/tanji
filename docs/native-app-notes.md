# 探记 TanJi · iOS 原生版研发笔记(native-app 分支)

> 本文档记录本地 App 版的技术路线决策、搭建步骤、环境问题与实测清单。持续更新。
> 分支:`native-app`(独立 git worktree:`/Users/fengyong/drax-glm/tanji-native`)。Base:Web v0.2。

## 一、路线决策(阶段 1 结论)

两条候选路线:

- **路线 A:Capacitor 壳 + 复用现有 Web UI**(HTML 单文件,SQLite 插件持久化)
- **路线 B:SwiftUI + GRDB 纯原生重写**

### 1. 逐项对比

| 维度 | A. Capacitor 壳 | B. SwiftUI + GRDB |
|---|---|---|
| **数据层** | @capacitor-community/sqlite 插件,JS API 建表/查询;与 Web 版数据模型一一对应 | GRDB + 手写 Record 类型与 Migration;类型安全,但全部 CRUD 用 Swift 重写 |
| **状态机复用** | `workOf / payOf / owedOf / overdueDays / snoozed` 等派生逻辑零改动复用 | 需要用 Swift 重写派生逻辑 + 5 个页面 UI(v0.2 约 1300 行 → 预计 2500+ 行 Swift) |
| **本地通知** | @capacitor/local-notifications:JS 层调度,支持 calendar/at 触发器,够用 | UNUserNotificationCenter 原生 API,粒度最高 |
| **分享导出** | @capacitor/filesystem 写 Cache + @capacitor/share 调系统分享;支持文本与二进制(PNG/.db) | UIActivityViewController + FileManager;同样简单,但导出生成逻辑要重写 |
| **构建链** | npm + `cap sync ios` + Xcode 工程;**Capacitor 8 默认 SPM,无需 CocoaPods** | 纯 Xcode/SwiftPM;构建最快,但一切从零 |
| **迭代成本** | Web 与 App 同一份 UI,双端同步 = 拷 `index.html` + 保留原生适配层 | 双端两套代码,功能变更各改一遍 |
| **体验天花板** | WebView 渲染,略逊原生;原型 UI 已按 iPhone 设计,可接受 | 完全原生手感 |
| **风险** | WebView 性能上限;依赖社区 SQLite 插件维护 | 工作量最大,迭代慢 |

### 2. 决策

**先走路线 A(Capacitor)。** 理由:

1. 单人研发 + 快速验证阶段,目标是尽快真机可用、与 Web 版同步迭代;Capacitor 让 UI/状态机 100% 复用,增量成本只有存储适配器与原生桥接。
2. 数据层目标一致:两条路线最终都是本机 SQLite(orders/payments/settings),A 路线建出的 `.db` 与 v0.2 Web 导出的 `.db` 表结构同构,后续若升级路线 B,数据文件可直接迁移,不留死路。
3. 路线 B 不废弃,作为"体验升级预留项"。触发条件(任一):WebView 性能不可接受 / 需要深度系统集成(Widget、Live Activity)/ 社区 SQLite 插件停止维护。

**实际执行补充(阶段 4.5)**:main 分支完成 v0.2(隐私模式、预约冲突提醒、今日行程分享图、1/3/7 天催收备忘、收款渠道)后,已同步进 worktree 并把原生适配层移植到 v0.2 底座——Web 与 App 现在是同一份 UI 代码。

## 二、环境盘点(搭建时实测,macOS 13.6 Intel)

| 项 | 现状 | 影响 | 处理 |
|---|---|---|---|
| Node | 系统仅 v12.6.0(brew 旧链损坏:`MacOSVersionError`) | Capacitor 8 要求 Node ≥ 22 | nodejs.org 官方 tarball 直连超时;改用 npmmirror 镜像下载 **v22.14.0** 到 `~/tools/node22/`(不入仓库),每次命令前置 `PATH=$HOME/tools/node22/bin:$PATH` |
| npm | 10.9.2(Node 22 自带) | OK | — |
| CocoaPods | 未安装(`pod` not found) | — | **无需安装**:Capacitor 8 默认 Swift Package Manager(`cap add ios` 生成 `ios/App/CapApp-SPM/Package.swift`,无 Podfile)。回退选项:`cap add ios --packagemanager CocoaPods` |
| Xcode | **未安装**(`xcode-select` 指向 CommandLineTools,无 iPhoneSimulator SDK) | `xcodebuild` 无法执行(见阶段 5) | 明日装机后按第五节清单构建 |
| GitHub 连通 | OK(SPM 解析 capacitor-swift-pm 8.6.2 可用) | OK | — |
| npm registry | OK | OK | — |

### 版本注意

- `npm install -D @capacitor/cli` 默认解析到 7.6.10(与 core@8 大版本错位),**必须显式 `npm i -D @capacitor/cli@8.6.2`**,否则 CLI 与 runtime 行为可能不一致。
- Capacitor CLI 8 要求 Node ≥ 22(启动时硬校验)。

## 三、工程结构与搭建步骤(已完成)

```
tanji-native/
├── capacitor.config.json      # appId com.tanji.app / appName 探记 / webDir www
├── package.json               # scripts: build:plugins / sync / open:ios / serve
├── src/cap-plugins.js         # esbuild 入口:@capacitor/core + 4 插件 → window.TanjiCap
├── www/                       # Web 资源(与 main v0.2 同步)
│   ├── index.html             # UI/状态机(与 main 同源)+ 平台自适应持久化 + 原生桥接
│   ├── cap-plugins.js         # esbuild 产物(45KB,IIFE)
│   ├── vendor/sqlite3.mjs+was # sql.js WASM(生成真 .db 字节;Web 与原生 WKWebView 都可用)
│   ├── sw.js / manifest / icons  # PWA 资产(原生端 sw.js 注册被跳过)
├── ios/App/                   # cap add ios 生成的 Xcode 工程(SPM)
│   ├── App.xcodeproj
│   ├── CapApp-SPM/Package.swift   # capacitor-swift-pm 8.6.2 + 4 个本地插件包
│   └── App/App/public/        # cap sync 拷贝产物(已 .gitignore)
└── docs/
```

操作序列:

```bash
npm init && npm i @capacitor/core @capacitor/ios && npm i -D @capacitor/cli@8.6.2
npm i @capacitor-community/sqlite @capacitor/local-notifications @capacitor/share @capacitor/filesystem
npx cap init 探记 com.tanji.app --web-dir www
npx cap add ios          # SPM 模式,无 CocoaPods 依赖
npm run sync             # esbuild 打包插件桥 + cap sync ios(拷 www → ios/App/App/public)
```

## 四、存储适配器(同一套 UI,持久化按平台切换)

判定:`CAP = window.TanjiCap`(esbuild 打包的插件桥);`isNative = Capacitor.isNativePlatform()`。

| 环境 | 读(loadState) | 写(save) | 额外 |
|---|---|---|---|
| Web/PWA | IndexedDB `json` → localStorage `tanji_v2`(含 tanstore_v1 v0.1 迁移)→ seed | localStorage 即时 + IndexedDB(json + 真 .db 字节)防抖 400ms | sql.js 生成 `.db` 导出 |
| iOS 原生 | CapacitorSQLite `tanji` 库三表读出;空库时写入 seed(首装体验与 Web 一致) | `executeSet` 事务内 DELETE + 全量重插,防抖 300ms | settings 键:collect_threshold_days / notify_enabled / app_version |

**表结构(v0.4 后原生库按 `mode` 分双数据集,与 Web 导出的 .db 已不同构 —— 跨端搬运请走 JSON 备份):**

- `orders`:id, store, category, contact, price, deposit, appt_at, shot_at, submitted_at, short_sent_at, long_sent_at, deposit_paid_at, final_paid_at, **settle_via**(TEXT DEFAULT 'private'——private 私收 / douyin 抖音商单平台结算不催收), **remind_at**(催收备忘 1/3/7 天), note, created_at, updated_at
- `payments`:id(AUTOINCREMENT), order_id, kind(定金/尾款/extra), amount, paid_at, method(微信/支付宝/银行卡/抖音商单/其他,仅记录标签), note
- `settings`:key/value

JS 模型(camelCase)↔ 行(snake_case)映射:`rowToOrder / rowToPayment / nativePersist`。注意 `settle_via` 读取时 `r.settle_via || 'private'`(旧行可能为 NULL)。

## 五、原生桥接(已实现)

### 1. 本地通知(@capacitor/local-notifications,仅原生生效)

- **每日催收汇总**:每日 09:00 一条本地通知(`schedule.on={hour:9,minute:0},repeats:true`),内容只报"逾期笔数 + 最长天数",不含金额(隐私友好);`notify_enabled` 设置可关(统计页开关行,仅原生显示);阈值(`th` stepper)变更后自动重排;收款/删单后重排。
- **1/3/7 天催收备忘 → 真·提醒**:Web v0.2 的 snooze 备忘(打开 App 查看)在原生升级为一次性本地通知,时刻与 `remind_at`(dOff(d,'09:00'))一致;重复 snooze 先取消该订单旧提醒。
- **通知 id 约定**:每日汇总 = `1`;单订单 = `100000 + orderId*100 + 天数`。
- 权限:`checkPermissions` → 不通过则 `requestPermissions`;未授权时 toast 引导。
- Web 环境全部静默降级(snooze 仍为应用内备忘)。

### 2. 导出分享(@capacitor/filesystem + @capacitor/share)

- `download()` 原生分支:Filesystem 写 **Cache** 目录 → Share.share 调系统分享面板。
- 文本(CSV/JSON)走 UTF8 编码;二进制(**.db / 分享图 PNG**)先 `blobToBase64` 再写(不带 encoding,插件按 base64 处理)。
- 覆盖:导出 CSV / 导出 JSON / **导出 SQLite .db**(sql.js 在 WKWebView 内同样可运行,构建真 .db 字节)/ 今日行程分享图 PNG(WebView 无 Web Share API,`share-confirm` 分支改走 Share 插件)。

### 3. 平台差异处理

- Service Worker:原生端跳过注册(capacitor:// 无意义)。
- sql.js WASM:原生端仍加载,仅用于导出 .db;运行数据走 CapacitorSQLite。
- iOS 上 `values` 查询结果由插件 JS 层 `reorderRows` 统一为行对象(已确认插件内部处理 iOS 列名首行特性)。

## 六、构建验证结果(如实)

| 步骤 | 结果 |
|---|---|
| `npm run build:plugins`(esbuild 打包) | ✅ 45.5KB IIFE |
| `npm run sync`(`cap sync ios`) | ✅ www → ios/App/App/public;4 插件 SPM 引用生成 |
| `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator build` | ❌→✅ **2026-11-22 已通过**(见下方「模拟器实测记录」) |
| CLT 下的替代校验 | ✅ `plutil -lint` Info.plist / project.pbxproj 均 OK;capacitor.config.json JSON 校验 OK;pbxproj 含 9 处 CapApp-SPM 引用;deployment target iOS 15.0;bundle id com.tanji.app |
| Web 冒烟(浏览器模拟 WebView 行为) | ✅ 17 笔种子载入、隐私模式、snooze、save→localStorage、.db 字节构建(49KB)、通知模块静默降级 |

## 六·五、模拟器实测记录(2026-11-22,本机 macOS + Xcode 27.2)

本机环境:`/Users/ola`,Apple Silicon,Xcode 27.2 (27B52),`xcode-select -p` → /Applications/Xcode.app;Node 26.8.1(homebrew,≥22 满足 Capacitor 8);模拟器 iPhone 17 / iOS 27.2。**注意:Xcode 27 不再自带 Simulator.app,模拟器 GUI 由 `Xcode.app/Contents/Applications/DeviceHub.app` 承载。**

| 验证项 | 结果 | 证据 |
|---|---|---|
| xcodebuild 模拟器构建 | ✅ BUILD SUCCEEDED | 首次构建自动完成 SPM 解析(capacitor-swift-pm 8.6.2 / ion-ios-filesystem 2.0.1 / SQLCipher.swift 4.20.0);`PrivacyInfo.xcprivacy` 进包 |
| 安装 + 启动 + 渲染 | ✅ | `simctl install/launch com.tanji.app`;首屏 17 笔种子、逾期横幅、五页签正常(截图) |
| SQLite 落盘 | ✅ | 沙盒 `Documents/tanjiSQLite.db`:orders(mode,id 主键)17 行、payments 18 行、settings `demo/json` 7046 字节——修复后的 INSERT 模板真实写入 |
| SQLite 读取回环(强验证) | ✅ | 抹掉 WKWebView localStorage 镜像 + 直接 `UPDATE settings` 改店名 → 重启 App 后 UI 显示改后店名,证明 UI 读的是 SQLite 文件而非种子/镜像 |
| 通知权限弹窗 | ✅ | 启动即弹「“探记”想给你发送通知」——原生通知桥接生效(Web 端此处静默降级) |
| 运行日志 | ✅ 无 Capacitor/SQLite/JS 错误 | `log show` 过滤 App 进程,仅系统框架噪声 |
| target=_blank → 系统浏览器 | ✅ 源码已核实 | Capacitor 8 `WebViewDelegationHandler.swift:324`:`createWebViewWith` 调 `UIApplication.shared.open`,「关于」页外链机制成立 |

**模拟器实测后仍待人工验证(需 UI 交互,DeviceHub 里点即可)**:

- [ ] 允许通知授权后:snooze 一次性提醒实际到达;每日 09:00 催收汇总(临时把 hour 改到 2 分钟后验证);关闭开关后 pending 清空
- [ ] 四种导出(CSV/JSON/.db/分享图)调起系统分享面板
- [ ] 「统计 → 关于」两个外链在真机/模拟器实际跳系统浏览器
- [ ] 真机签名 + SQLite 读写与通知到达率(上架清单第五节第 1 步的收尾)

**已发现的外部依赖问题(2026-11-22 实测)**:「统计 → 关于」链接的线上隐私政策/支持页 **404**(`tanji-app-guvc.zai.site/privacy.html`、`/support.html`;站点根路径是旧版 Web App)——`privacy.html`/`support.html` 现已在 main 分支提交(commit `1d1c28f`),**但尚未重新部署站点**,线上仍是 404。上架前必须先部署站点让这两个 URL 可访问,属 main 分支事务。

## 六·六、main/native 漂移防护机制(2026-11-22 建立)

main 是唯一真源,native 的 `www/` 是同源副本,两者靠 `scripts/` 下的两个脚本 + GitHub Actions 锁死:

| 机制 | 文件 | 作用 |
|---|---|---|
| 同步 | `scripts/sync-web-assets.cjs` | 纯资产(sw.js / manifest / privacy.html / support.html / icons / vendor)自动拷贝;index.html 与 storage.js 含原生适配层,**只检测漂移不自动覆盖**,有改动就中止并给出差异范围,人工合并后重跑 |
| 校验 | `scripts/check-web-sync.cjs` | 记录并比对两侧内容指纹(git blob sha);main 改了没同步 / native 私自改了 / 锁文件没更新,三种情况一律失败退出 |
| 基线 | `scripts/web-sync.lock.json` | 记录上次同步时 main 的 commit 与每个共享文件的指纹,入库 |
| 构建产物 | 同上(内置检查) | `www/cap-plugins.js` 必须等于 `src/cap-plugins.js` 的 esbuild 产物,防止改了 src 忘打包 |
| CI | `.github/workflows/ci.yml` | main 分支跑单元回归 + 浏览器端到端冒烟;native 分支额外跑原生回归 + 漂移校验 + 隐私清单合规检查 |

日常用法:

```sh
npm run check              # 校验有无漂移(CI 同款),绿=可提交
npm run sync:web           # 从 main 同步;合并文件有漂移时会中止并给差异
# 人工合并完 index.html / storage.js 后:
npm run check:update       # 重新登记基线
npm run check              # 再确认一遍
```

**登记基线 = 承认"native 已经吸收了 main 的最新改动"**,所以它必须是人写代码之后的动作,不能拿来掩盖漏同步。

## 七、实测清单(Xcode 已装,2026-11-22 执行情况)

1. ~~**装机**~~ ✅ Xcode 27.2 已装(`xcode-select` 已指向 Xcode.app,iOS 27.2 runtime 就绪)。
2. ~~**首次构建**~~ ✅ BUILD SUCCEEDED(见六·五;未走 CocoaPods 回退路线)。
3. **模拟器跑通**:首页载入 17 笔 ✅(截图);新建预约/冲突提醒/标记环节/收款渠道/通知开关——**待人工点验**(DeviceHub)。
4. **SQLite 验证**:沙盒库直查 ✅(六·五);「新增一笔订单 → 导出 .db → sqlite3 核对」待人工。
5. **通知验证**:授权弹窗已验证弹出;允许后的 snooze 到达/每日汇总/pending 清空——待人工。
6. **导出验证**:CSV/JSON/.db/分享图四导出调分享面板——待人工。
7. **真机(可选)**:个人开发者证书或免费 Apple ID 签名,重点看 sqlite 库读写与通知到达率。
8. **回归 Web 双端**:native 端产生数据后导出 JSON,再在 Web 端导入比对(或反向),确认字段语义一致——待人工。

## 八、已知问题 / 风险

- ~~**Xcode 未装**~~ 已解除(2026-11-22 装机 Xcode 27.2):模拟器构建/安装/启动/SQLite 读写回环实测通过,见六·五。
- **全量重写持久化**:nativePersist 采用"DELETE + 全量重插"事务,百单量级无感;千单以上可改增量 UPSERT(v0.3)。
- **sw.js/vendor 随包**:原生包体内含 PWA 资产(sw.js、manifest、icons)约 1.7MB;不碍事,后续可用 `capacitor.config.json` 的排除或拆分目录精简。
- **每日通知文案**:固定 09:00 时刻,如需"仅在工作日提醒"或随人习惯漂移,后续用 `schedule.on.weekday` 扩展。
- **privacy 状态未持久化**:与 Web v0.2 行为一致(会话级),如需记忆可写入 settings(两侧都留好了 key-value 通道)。
- **@capacitor-community/sqlite 维护**:路线决策里已把"插件停维护"列为切换路线 B 的触发条件之一。

## 九、提交记录(native-app 分支)

- `docs:` 路线决策(Capacitor 优先,SwiftUI+GRDB 预留)
- `feat:` Capacitor 8 iOS 工程搭建(cap add ios + 4 插件,SPM 无 Podfile)
- `feat:` Web 资源接入 + 存储适配器 v0.1(localStorage ↔ CapacitorSQLite)
- `feat:` 原生桥接 v0.1(通知 + Filesystem/Share 导出)
- `feat:` 同步 Web v0.2 底座并移植原生适配(settle_via/remind_at、snooze→通知、分享图/.db→Share)
- `docs:` 本笔记 + README

## v0.4 同步记录(2026-11-21)

- Web 层同步至 main aaf57d9(v0.4:双数据集 work/demo、金额分制、防覆盖/备份链、JSON 导入恢复、月历勋章、全环节可改、渠道/出镜字段、大王档期初始化已由 work/demo 架构替代)。
- **storage.js 成为唯一持久化入口**:原生分支注入其中 —— `persistSnapshot`/`readSnapshot` 在 isNative 时走 CapacitorSQLite;双数据集用 `mode` 列(orders/payments 主键 (mode,id)),settings 以 `mode:suffix` 为键;Web 语义(revision/previous 备份链/validateState)完整保留。
- 原生通知:`Notify`(syncDaily/scheduleSnooze/cancelAll/toggle)挂 storage.js;统计页通知开关仅原生显示。
- 导出:CSV/JSON/.db/分享图原生端全部走 Filesystem+Share 面板。
- `npx cap copy ios` ✅;`xcodebuild` 仍被 Xcode 缺失阻塞(同前)。
- 烟雾测试(浏览器回退路径):17 笔演示单、月历/编辑/收款/隐私全功能 ✅,isNative=false 时通知开关隐藏 ✅。
- 已知注意:acquireWriter(Web Locks)原生端跳过;validateState 依赖 index.html 的 validDateTime(加载顺序已保证)。

## 工作流 v0.5(2026-11-22,仅 native 版,html/main 版以后再做)

> 达人真实工作流补充。决策(用户拍板):不改现有时间线顺序,只**加状态**;改动只落 native www/,main 的 html 版不动 → 漂移锁已按「native 侧有意变更」重登记。

### 新字段(orders)

| 字段 | DB 列 | 语义 | 旧数据默认 |
|---|---|---|---|
| location | location TEXT | 地点(门店地址/楼层) | '' |
| deliverMain | deliver_main INTEGER DEFAULT 1 | 出片要求:需要正片(=长片 longAt) | true |
| deliverSub | deliver_sub INTEGER DEFAULT 0 | 出片要求:需要副片(=短片 shortAt) | true(保持 v0.4"都要"语义;新单表单默认副片不勾) |
| reviewResult | review_result TEXT DEFAULT '' | 送审结果:''待审/pass 合格/fail 不合格 | '' |
| publishedAt | published_at TEXT | 发布时间(里程碑,可标记/清除) | null |

- 标签改版:商家名称→品名/商家、渠道→服务商(蜂向/小爱/金城/食物本就是服务商)、出镜搭档→组队。
- **正片=长片(longAt)、副片=短片(shortAt)**——此映射是我的判断(正片为主交付物),已按实况渲染验证。
- 出齐(deliveredAll)按配置判断:勾了正片须 longAt、勾了副片须 shortAt;workOf 已交付=出齐(顺序不变)。
- validateState 白名单已收编全部新字段;publishedAt 进时间戳校验;reviewResult 非法值拒绝。

### 24 小时未出片提醒

- 触发:拍摄完成(shotAt)+24h 时仍未出齐(按该单配置)→ 一次性本地通知「『店名』拍摄已超 24 小时,还有片子没出齐」。
- id 约定追加:**出片提醒 = 300000+orderId**;cancelOrder/cancelAll 已覆盖。
- 重排时机:mark(含拍摄/发片/发布里程碑)、saveEdit、saveOrder、删单、switchMode、启动;已超期的不排程(列表红标「超24h」兜底)。
- Web 回退路径无通知,首页「待发片」列表有红色「超24h」角标。

### UI/导出

- 新建表单:地点输入 + 出片要求正/副片两个多选(默认正片✓副片✗,都勾=都要,全不勾拒绝保存);编辑弹层同步可改(含送审结果下拉)。
- 详情页:里程碑五节点(不要求的片不显示)、送审结果合格/不合格快操(再点撤销)、发片中且未发布时「标记已发布」按钮。
- 首页待发片芯片:待提审/待正片/待副片/待发布 + 超24h;CSV 与导出 .db、App 内数据结构文档页同步补列。

### 迁移与验证

- 旧库升级走 ALTER TABLE ADD COLUMN 逐条吞重复(新库建表已含,同样走一遍):**已在模拟器真实旧库上验证**——重装保数据的库从 20 列升到 25 列,17 单完好。
- 回归测试 +6(旧库迁移/默认配置/仅正片出齐/24h 排程与撤销/删单撤提醒/送审发布往返与非法值拒),`npm test` 63/63。
- 模拟器实测:详情页新芯片/五里程碑/送审按钮/新信息栏渲染正确(截图),发布里程碑标记/清除已人工点验。

## 深度 review 记录(2026-11-22)

> 起因:研发笔记里的「烟雾测试」跑的是**浏览器回退路径(isNative=false)**,原生持久化与通知桥接从未被真正执行过。
> 本次用 `node:sqlite`(真实 SQLite)给 @capacitor-community/sqlite 做高保真 mock,把原生路径拉进回归,并逐条核对三个插件的 iOS 一手源码。

### 已修复(6 项,均已复现并加测试)

| # | 问题 | 影响 | 修复 |
|---|---|---|---|
| 1 | `nativePersistSnapshot` 的 INSERT 拼出 `VALUES (??,?,?…)` —— 模板多了一个 `?` | **原生端任何一笔数据都存不进去**,每次写入都是 SQLite 语法错误 | 补回逗号:`VALUES (?,${cols.map(()=>'?').join(',')})` |
| 2 | `validateState` 只返回 `{orders,payments,threshold}`,把 `notifyEnabled` 丢了 | 用户关掉每日催收提醒后**重启 App 又被静默打开** | validateState 保留 notifyEnabled;backupDocument 一并导出;导入无此字段时沿用本机设置 |
| 3 | 清除催收备忘 / 删除订单时不撤销已排程的一次性通知 | 提醒已清,通知照响;删掉的订单仍弹「尾款该跟进了」 | 新增 `Notify.cancelOrder(id)`,两处调用点接上 |
| 4 | 收款后不重排每日催收汇总 | 已结清的订单第二天仍被通知「N 笔已逾期」 | `pay()` 与 `switchMode()` 补 `Notify.syncDaily()` |
| 5 | 原生端 SQLite 写入失败被静默吞掉 | **用户以为账目存上了,实际只在内存里,一关 App 就没了** | 原生 persistSnapshot 失败时给出「保存失败…先导出 JSON 备份」提示;成功时清掉「正在保存…」 |
| 6 | 原生文本导出没有 UTF-8 BOM(Web 版有) | 导出的 CSV 在 Excel 里中文乱码 | 文本导出补 BOM,与 Web 版一致 |
| 7 | 原生端只写 SQLite,localStorage 镜像只写不读 | SQLite 写失败时数据只在内存里,**重启即丢**(Web 版有双副本兜底) | 镜像改为每次保存都写;读取时 SQLite 与镜像都读,按修订号取较新的一份;SQLite 整个不可读时退回镜像并暂停写入 |

### 一并纠正的两个「差点改错」

- **二进制导出不用加 `encoding`**:@capacitor/filesystem v8 的 `Encoding` 枚举已无 `Base64`,且 iOS 端 `getEncoding` 缺省值是 `.byteBuffer`(自动 base64 解码)。一旦传了 `encoding`,反而会把 base64 当**文本**落盘,.db 彻底损坏。现状写法正确,未改动。
- **建表改用 executeSet 必须补 `values: []`**:iOS 端 `CapacitorSQLitePlugin.swift:932` 要求 executeSet 每项同时含 `statement` 与 `values` 两个键,缺 `values` 整批 reject(Android 与浏览器端不会暴露)。原 `execute(多语句)` 走 `sqlite3_exec` 本来是对的;若改写成 executeSet,**必须**给 DDL 补空数组占位。

### 仍未解决 / 待决策

- **原生库与导出 .db 表结构不同构**:原生库 `orders`/`payments` 带 `mode` 列(双数据集),而导出 .db 用的是 Web 版表结构(无 mode)。README 与本笔记第四节的「同构/可互换打开」表述已按实情更正 —— **跨端搬运请用 JSON 备份**。
- **`orders`/`payments` 两张表只写不读**:真实数据源是 `settings` 里的 JSON 文档,`rowToOrder()` 是死代码。两张表每次保存都要 DELETE+全量重插,属冗余写放大。`payments.order_id` 不含 mode,跨数据集有歧义——当前无触发点。
- ~~**原生端没有 Web 那样的双副本兜底**~~ —— 已修复:localStorage 镜像改为**每次保存都写**(不再只在 SQLite 成功时写),`nativeReadSnapshot` 同时读 SQLite 与镜像并按修订号取较新的一份;SQLite 整个不可读时退回镜像并暂停写入(uncertain),避免用旧镜像盖掉新数据。
- ~~**Xcode 仍未安装**~~ 已解除(2026-11-22):以上原生路径修复已在模拟器上编译通过并实测(见六·五)。

### 新增测试

- `tests/native-reliability.test.cjs` —— 原生路径回归(18 项),mock 里复刻了 iOS 的 `values` 键强校验契约,并用 `node:sqlite` 跑真实 SQL。
- `tests/web-reliability.test.cjs` —— 移植自 main 的 39 项 Web 回归,指向 `www/`。
- `tests/browser-smoke.cjs` —— 移植自 main 的浏览器端到端冒烟(13 项)。

```sh
node --test tests/native-reliability.test.cjs
node --test tests/web-reliability.test.cjs
node tests/browser-smoke.cjs
```
