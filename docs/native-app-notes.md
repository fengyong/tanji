# 探记 TanJi · iOS 原生版研发笔记(native-app 分支)

> 本文档记录本地 App 版的技术路线决策、搭建步骤、环境问题与实测清单。持续更新。
> 分支:`native-app`(当前开发分支 `fix/native-persistence-review`,独立 git worktree:`/Users/ola/drax-toolbox/tanji-native`)。Base:Web v0.2,现已同步到 v0.4 并叠加 v0.5/v0.6。

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
   (**此结论已被后续演进推翻**:v0.4 起原生库按 `mode` 分双数据集、v0.6 再加 `accounts` 表,与单数据集导出 `.db` 已不同构 —— 见第四节与「仍未解决」;跨端搬运请走 JSON 备份。)
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
├── www/                       # Web 资源(main 同源:v0.4 已同步,v0.5/v0.6 为 native 专属改动)
│   ├── index.html             # UI/页面状态(与 main 同源)+ 平台自适应持久化 + 原生桥接
│   ├── logic.js               # 业务规则纯函数层(工作线/资金线/逾期/出片/统计/排期),不碰 DOM,可单测
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
| Web/PWA | IndexedDB + localStorage `tanji_v3_work_json` / `tanji_v3_demo_json`(含旧键 `tanji_v2` / `tanstore_v1` 迁移)→ seed | localStorage 即时 + IndexedDB(json + 真 .db 字节)防抖 400ms | sql.js 生成 `.db` 导出 |
| iOS 原生 | CapacitorSQLite `tanji` 库三表读出;空库时写入 seed(首装体验与 Web 一致) | `executeSet` 事务内 DELETE + 全量重插,防抖 300ms | settings 键:collect_threshold_days / notify_enabled / app_version |

**表结构(v0.4 后原生库按 `mode` 分双数据集,与 Web 导出的 .db 已不同构 —— 跨端搬运请走 JSON 备份):**

- `orders`(27 列,主键 `(mode,id)`):mode, id, store, category, contact, price, deposit, appt_at, shot_at, submitted_at, short_sent_at, long_sent_at, deposit_paid_at, final_paid_at, **settle_via**(TEXT DEFAULT 'private'——private 私收 / douyin 抖音商单平台结算不催收), **remind_at**(催收备忘 1/3/7 天), channel(服务商), partner(组队), location / deliver_main / deliver_sub / review_result / published_at(v0.5 工作流), **account_id**(v0.6 所属账号), **gps_place**(v0.6 到店定位,`lat,lng`), note, created_at, updated_at
- `payments`:mode, id(AUTOINCREMENT), order_id, kind(**实际存中文「定金」/「尾款」**), amount, paid_at, method(微信/支付宝/银行卡/抖音商单/其他,仅记录标签), note
- `accounts`(v0.6,主键 `(mode,id)`):mode, id, name, phone, douyin, color(0-7 色板序号), avatar(dataURL), created_at
- `settings`:`(scope,key) → value`;scope=mode,key=`json`(完整状态快照,**恢复数据只认它**) / `backup`(替换前备份)

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
- **全量重写持久化**:nativePersist 采用"DELETE + 全量重插"事务,百单量级无感;千单以上可改增量 UPSERT(v0.6 之后仍未做)。
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
- `fix:` 修复原生持久化 7 个严重缺陷并补齐原生路径回归(`5dfe92b`)
- `feat:` 工作流 v0.5 + 多账号 v0.6(`4f7651a`);原型与研发记录(`e0612ca`);漂移锁重登记(`02a8d27`)

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

## 多账号体系 v0.6(2026-11-22,仅 native,main/html 版不动)

> 达人可能同时运营多个账号(如「饿了才要吃饱饱」+「吃饱饱才不饿」),订单要挂账号方便记后续动作;数据默认合为一体看,一键按账号拆开。原型(docs/proto/)确认后实现,口径全部按用户拍板。

### 数据模型

- 新增 `accounts` 数组:{id, name(昵称*必填), phone, douyin, color(标识色序号), avatar(dataURL,可选), createdAt};SQLite 同名新表(mode,id,name,phone,douyin,color,avatar,created_at)。
- orders 新增 `account_id`(JS:accountId);指向已删账号的订单自动归一为 null「未指定」(validateState 归一,不报错)。
- 新增 `providers`(自定义服务商预设,自动学习):表单输入过的非预设名,保存时自动记入,下次点选。
- validateState:账号昵称必填、头像必须是 dataURL 且 ≤200KB、color 收敛 0-7;**accounts 块在 orders 之前解析**(orders 的 accountId 归一依赖 accountIds 集合——曾因顺序放反踩过 TDZ,已有测试钉住)。
- 备份 JSON(backupDocument)包含 accounts/providers;头像随备份迁移。头像存 account 记录内(选图后 canvas 裁圆压到 128px JPEG ≈ 几 KB),不拖慢保存。

### UI(仅 ≥2 账号时出现;单账号全程零噪音)

- 统计页「我的账号」区:账号卡(头像/昵称/抖音/手机/单数)+每卡「拷贝」「编辑」;0 账号时显示一条「添加账号」引导。
- 建单/编辑表单:**账号单选卡**(radio,点整行选中,非下拉;带头像+历史单数,选中卡描边/底色用该账号专属色);只有 1 个账号时区块不出现、自动归属。
- 账号筛选条(首页/订单/收款/统计四页,行程月历不做):默认「全部」=合并;点账号=拆分,列表/逾期/流水/金额全跟随;筛选条选中态用账号专属色。
- 订单/流水行:**账号浅底色 + 小标(迷你头像+昵称)**,「全部」视图一眼扫出归属。
- 账号编辑弹层:头像(从相册选图/移除)、昵称/手机/抖音、**8 色轻柔色板**(蜜橙/雾蓝/抹茶/香芋/杏黄/玫瑰/黛青/卵石灰,新账号自动轮换分配,可点色板自定义;避开语义色——红=逾期、绿=已结清)。
- 一键拷贝:`accountCopyText()` 三行纯文本(昵称/抖音/手机,空字段自动跳过);原生走 @capacitor/clipboard(新插件桥接进 cap-plugins.js),Web 回退 navigator.clipboard/execCommand。
- 删除账号:confirm 明示名下订单数,订单变「未指定」;「批量改挂」sheet 可把未指定单一次性挂到某账号。
- 详情页账号行(多账号时)带迷你头像+拷贝按钮;CSV/导出 .db/schema 文档页同步 accounts 表与 account_id 列。

### 已知取舍(有意为之)

- 头像 dataURL 放在账号记录里随主文档保存(而非独立键):每笔保存多写几 KB,SQLite 本地写无感,换来实现简单、备份恢复自动带上。
- 单账号时统计页仍显示「我的账号」区(卡片+添加入口)——这是唯一的账号管理入口,S7 原型说的「不出现」收敛为「紧凑出现」。
- 服务商自动学习只增不减;预设(蜂向/小爱/金城/食物/直客)硬编码在前端。

### 验证

- 回归测试 +5(往返落库含头像 dataURL、悬空 accountId 归一/非法资料拒、旧库迁移出 accounts 表+account_id 列、拷贝文本跳空字段、备份文档含 accounts/providers),`npm test` 73/73。
- export-schema 一致性测试同步收紧:orders 列数按已上线字段逐级校验(当前 27 列,含 account_id / gps_place)、.db 导出必须含 accounts 表、accounts INSERT 7 列 7 占位符(曾靠它抓住 .db 导出块漏改——替换锚点未命中静默跳过,测试拦下)。
- 模拟器实测:见七节人工清单;重点:旧库启动自动建 accounts 表、建两张账号后建单出选号卡、筛选条四页生效、拷贝进系统剪贴板。

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
- **`orders`/`payments`/`accounts` 三张表只写不读**:真实数据源是 `settings` 里的 JSON 文档,`rowToOrder()` 是死代码。三张表每次保存都要 DELETE+全量重插,属冗余写放大;`settings.json` 若损坏,表数据不参与恢复(与「表级兜底」的注释承诺有落差)。`payments.order_id` 不含 mode,跨数据集有歧义——当前无触发点。
- ~~**原生端没有 Web 那样的双副本兜底**~~ —— 已修复:localStorage 镜像改为**每次保存都写**(不再只在 SQLite 成功时写),`nativeReadSnapshot` 同时读 SQLite 与镜像并按修订号取较新的一份;SQLite 整个不可读时退回镜像并暂停写入(uncertain),避免用旧镜像盖掉新数据。
- ~~**Xcode 仍未安装**~~ 已解除(2026-11-22):以上原生路径修复已在模拟器上编译通过并实测(见六·五)。

### 新增测试

- `tests/native-reliability.test.cjs` —— 原生路径回归(**32 项**),mock 里复刻了 iOS 的 `values` 键强校验契约,并用 `node:sqlite` 跑真实 SQL。
- `tests/web-reliability.test.cjs` —— 移植自 main 的 39 项 Web 回归,指向 `www/`。
- `tests/export-schema.test.cjs` —— 导出表结构护栏 5 项(列数/占位符/accounts 表一致性)。
- `tests/logic.test.cjs` —— 业务规则规格 **8 项**(正副片四种配置、四态推进、资金线、逾期起算、24h 边界、排期 ±120、统计窗口、分制金额)。
- `tests/geo.test.cjs` —— 到店定位规格 **5 项**(坐标串解析边界、超长串拒绝、展示格式、地图链接优先文本、无地点才用坐标)。
- `tests/wiring.test.cjs` —— 接线一致性 **3 项**(插件桥全局名与消费端读的名字一致、www 脚本加载顺序、保存按钮不在滚动区)。
- `tests/browser-smoke.cjs` —— 移植自 main 的浏览器端到端冒烟(13 步 + 保存条常驻 + geo 加载 + 触摸手感 + 下拉关闭,共 17 项检查,需本机 Chrome)。

合计 `npm test` **92 项**(32 + 39 + 5 + 8 + 5 + 3)。

### 业务规则层(www/logic.js)

v0.6 之后把「产品口径」从 `index.html` 里抽成独立纯函数文件,目的是给将来可能的
SwiftUI 迁移留一份**唯一可翻译的规格**,同时让规则可以脱离 DOM 单测。

- 命名空间 `window.TanJiLogic`,无构建步骤,`<script src="logic.js">` 在 `storage.js` 之前加载
- 不引用 `db` / `now` / `ui` / `document`;`orders` / `payments` / `threshold` / `today` 全部由调用方传入
- `index.html` 与 `storage.js` 保留同名薄包装(`workOf` / `payOf` / `deliveredAll` …),既有调用点与签名不变
- 改口径只改 `logic.js` + `tests/logic.test.cjs`;若要换 SwiftUI,Swift 实现对不上这 8 条规格即为实现错误
- 注意:`sw.js` 的 precache 清单**未**包含 `logic.js`(该文件是 main/native 共享资产,而 main 没有它);
  native 端不注册 Service Worker,不影响运行

### 随手拍与图像模块(www/imaging.js)

- 入口:详情页「随手拍 · 到店门口来一张」,用 `<input type="file" capture="environment">` 直接调起相机;
  真机需要 `Info.plist` 的 `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription`,否则一点就崩
- 拍完立即处理(不落原图):2:1 居中裁切 → 256×128 → `saturate(.72) contrast(.9) blur(.6px)` → 叠白 53% → JPEG q0.65,
  **成品约 3KB / 每张**,体积上限 12KB 字符写死在模块里
- 淡化是**烘焙进图片**的,渲染端不再叠 opacity(两层淡化会发灰);金额格只补一层很轻的白色渐变保数字对比
- 存 `order.photoThumb`(dataURL),`validateState` 校验格式与体积;原图不进 DB
- 拍完自动写 `shotAt`(到店拍照 = 开始拍摄),不需要再点一次「标记已拍摄」
- 展示位置:订单列表 / 首页今日拍摄的**金额格底图**;详情页里程碑的「拍摄」节点直接显示这张小图
- 导出差异:CSV 与 `.db` **不含**照片(列固定);JSON 备份**会带**(每张约 3KB),换机可恢复

```sh
node --test tests/native-reliability.test.cjs
node --test tests/web-reliability.test.cjs
node tests/browser-smoke.cjs
```

## 到店定位 · 地图跳转 · 常驻保存条(2026-11-22 v0.6 增量)

> 起因:三件具体的事 —— ① 地点要能直接跳地图;② 到店拍摄时自动记下当时的 GPS,单独一列,**与手填地点不冲突**;
> ③ 新建/编辑的保存按钮不能"滚到最下面才看见"。
> 顺带把《达人工作流与交互评估》(`docs/creator-workflow-review.md`)里的 P0 项做掉。

### 数据与链路

- 新增列 `orders.gps_place`(TEXT,JS 字段 `gpsPlace`),存 `纬度,经度`(6 位小数)。`location` 不动,两列各管一件事:
  `location` 是人写的"万象城 3 层"(导航按它查最准),`gpsPlace` 是机器记的"当时在哪"。
- 写入时机:**打卡/标记已拍摄**、**随手拍成功**后各触发一次 `capturePlace()`,取 `@capacitor/geolocation`(原生)/`navigator.geolocation`(Web)。
  定位失败、拒绝授权、超时一律**静默**:位置是附加信息,不能挡"这单拍过了"。
- 重拍会覆盖为最新一次(重拍意味着"我又到店了");详情页「记录当前位置」可手动补,「看位置」跳地图看精确点位。
- 迁移:`ALTER TABLE orders ADD COLUMN gps_place TEXT` 并入既有的逐条吞重复流程;旧库启动自动补列。
- 导出:CSV 增「到店定位」列(26 列,人在 Excel 里也读得懂);`.db` 27 列;JSON 备份自动带(读回时 `geo.isValid` 归一,
  脏坐标**丢弃不抛错**——一条坏坐标不能让整份快照读不出来)。

### 地图跳转

- `www/geo.js` 的 `mapUrl()`:优先 `location` 文本(`https://maps.apple.com/?q=地址`),没填地点才用 `gpsPlace`(`ll=lat,lng&q=店名`)。
- 用 `https://maps.apple.com` 而不是 `maps://`:没装/被拦时会自然退回网页,不会"点了没反应";原生用 `window.open(url,'_system')` 交棒系统。
- 为什么不直接拿 GPS 导航:GPS 是 WGS84,国内地图用 GCJ02,直接按坐标导航会有几百米偏移;手填的中文地址反而最准。

### 常驻保存条

- `.sheet-foot` 固定在弹层底部(flex 子项、不在滚动区),`.sheet-body.flush` 收窄底部留白;新建「预约」与「编辑订单」两处都改。
- 冒烟里加了硬断言:打开弹层后按钮必须在视口内,且 `closest('.sheet-body') === null`(放回滚动区就会失败)。

### 顺带落地的交互优化(P0)

| 项 | 改法 |
|---|---|
| 待发片只能进详情 | 首页/订单页行内按 `nextStep()` 直接给「提审 / 发副片 / 发正片 / 发布」,顺序与详情页一致 |
| 首页今日数量越拍越少 | 「今日拍摄」改为今日**全部**单(已拍置灰),标题给 `已拍/总数`,行内加「打卡」按钮(顺手记 GPS) |
| 搜索只搜商家名 | 覆盖 store / location / contact / channel / partner / note / cat |
| 待发片只显示 4 条 | 超过 4 条补一行「还有 N 单,查看全部」 |
| 行程页只有成交额 | 月头补「成交 ¥X · 已收 ¥Y」 |

> 勘误:评估文档原先写"`renderTrip` 算了 `mSum` 却未渲染",实际月头早已渲染成交额(`.msum`),属我读代码时只看前 26 行导致的误判,
> 已在 `docs/creator-workflow-review.md` 更正;这次只补了"已收"。

### 顺带修掉的接线 bug(本轮准确性检查的最大收获)

`src/cap-plugins.js` 把插件桥挂成 `window.TanJiCap`,而 `www/storage.js` 第 1 行读的是 `window.TanjiCap` —— 只差一个字母的大小写。
JS 不会报错,但后果是 **`CAP = null` → `isNative = false`:整条原生路径(SQLite 持久化、本地通知、分享面板)被静默跳过**,
数据退回 WKWebView 的 IndexedDB 照样能存,所以"看起来一切正常"。源码注释、研发笔记、测试 mock 用的都是 `TanjiCap`,
只有打包入口写错了 —— 这类错只能靠静态比对发现,跑起来永远是"通过"的。

- 修复:统一为 `TanjiCap`(消费端、mock、文档都已经是这个名字),重新 `build:plugins`。
- 防回归:`tests/wiring.test.cjs` 直接比对「桥定义的名字」与「消费端读的名字」,并检查构建产物里也有这个名字。

### 验证

- `npm test` **92 项**全通过(新增 `tests/geo.test.cjs` 5 项 + `tests/wiring.test.cjs` 3 项 + 原生 gps_place 落库/读回/脏值 1 项)。
- `npm run test:smoke` 15 项检查通过,`consoleErrors` 为空(新增「save button always visible」「geo module loaded」)。
- `npm run check` 无漂移;`npm run build:ios` **BUILD SUCCEEDED**(`cap sync` 后 Package.swift 含 6 个插件,新增 `@capacitor/geolocation@8.2.5`)。
- `Info.plist` 补 `NSLocationWhenInUseUsageDescription`(文案说明只存本机、不上传)。

### 已知边界

- 没做逆地理(坐标 → 文字地址):国内可用的免费服务不稳定,拉一个随时挂的外部依赖不值得;点「看位置」在地图里就能看到地址。
- 模拟器/真机的定位授权弹窗、弱信号超时、前后台切换没有实测(需真机点验),失败路径已按"静默不阻塞"设计。

## 真机安装(免费 Apple ID · 7 天有效,2026-11-22)

> 目标:还没申请付费开发者账号之前,先把包装到 iPhone 上做真机点验(GPS/相机/地图/安全区这些模拟器验不了)。

### 为什么免费账号就够

- 本工程**没有 entitlements 文件**,也没有声明 Push / App Groups / Associated Domains —— 这些正是免费签名不给的;
- 通知走 `LocalNotifications`(本地),不依赖 APNs;
- 付费账号才有的能力(TestFlight、Ad Hoc 分发)现在用不上。

免费签名只有两条硬限制:**证书 7 天有效**、**不能上架/TestFlight**。

### 一次性准备

1. **Xcode → Settings → Accounts → 加普通 Apple ID**(不需要付费),会自动生成 `Personal Team`;
2. iPhone:设置 → 隐私与安全性 → **开发者模式** → 打开(要求重启并确认);
3. USB 连接 Mac,手机上点「信任此电脑」;
4. 记下 **Team ID**:Xcode → Settings → Accounts → 选中账号 → 右侧 Team 列表里的 10 位串。

### 一条命令

```bash
# 手机连上后先拿 UDID
xcrun devicectl list devices

DEVELOPMENT_TEAM=你的TeamID DEVICE_UDID=手机UDID npm run install:ios:device
```

脚本(`scripts/build-device.sh`)按顺序做:`npm run sync` → `xcodebuild -allowProvisioningUpdates`(首次会自动注册设备与 App ID)
→ `devicectl device install` → 启动。bundle id 默认在构建时覆盖为 `com.olatanji.app`,**不写进工程文件**,避免占用正式 id 的配额
(可用 `BUNDLE_ID=` 改)。

### 两个坑

- 首次启动若提示「不受信任的开发者」:设置 → 通用 → VPN与设备管理 → 信任你的证书;
- **7 天后** App 打不开是正常过期:重跑同一条命令覆盖安装即可,**沙盒数据保留**;千万别卸载再装(卸载=删沙盒=丢数据)。

## 真机点验与体验修正(2026-11-22 晚)

真机环境:iPhone 15 Pro / iOS 27.2.1 / `com.olatanji.app` / 免费个人团队签名(`DEVELOPMENT_TEAM=YC9UFHH73D`)。
主链路跑通后按实际手感改了三处,**都是"模拟器验不出来、一上手就露馅"的类型**。

### 1. 网页手感 → 原生手感

- **现象**:双击放大、按住文字横向拖动把整片刷蓝、长按弹「拷贝/查询」、整页橡皮筋回弹。
- **根因**:`viewport` 允许缩放且没声明 `touch-action`;`*` 上没有禁 `-webkit-touch-callout`。
- **改法**:`viewport` 加 `maximum-scale=1,user-scalable=no`;`html{touch-action:manipulation}`;`*`/`body` 禁 callout 与 user-select;`html,body{overscroll-behavior:none}`;`img,svg` 禁拖拽。
- **保留可复制**:`pre / textarea / input / .schema-pre / .selectable` 单独放开。
- **护栏**:冒烟 `touch feel locked` 三项断言(`touch-action` / `user-select` / viewport)。

### 2. 弹层没有退出方式 → 下拉关闭 + ✕

- **现象**:点开订单后没有任何手势能退出,只能精确点上方的空白处。
- **根因**:`#sheet-detail` 只有 `grabber`,没有 `sheet-head` 与关闭按钮;所有弹层都没有手势。
- **改法**:`initSheetGestures()` —— 弹层跟手位移,松手 >110px 关闭、否则弹回;只在「头部/把手起手」或「列表已滚到顶」时接管,横向/向上手势放行给滚动,结束时清掉行内 `transform`(否则下次打开错位)。详情弹层补 `sheet-head`(标题+✕)。表单弹层(新建/编辑/账号/导入)只允许从头部拖,起手落在输入框内直接放弃。
- **护栏**:冒烟 `sheet drag to dismiss`(合成 touch 拖 200px,断言弹层关闭且 `ui.detail` 清空)。

### 3. 多账号整行底色 → 3px 账号色条

- **现象**:多账号时每行铺一块账号底色,被卡片 `padding:14px` 与 `.row` 的 0.5px 分隔线切出"白框套色块",账号越多越脏。
- **改法**:`accTint()` 只输出自定义属性 `--acc:<ink>`,`accBar()` 给行加 `.acc-bar`,CSS 用 `::before` 在行首画 3px 竖条;覆盖首页今日拍摄 / 待发片 / 订单列表 / 行程当日 / 收款流水五处。账号 chip 与迷你头像保留,识别性不受影响。

### 4. 真机已确认 / 待确认

- ✅ 随手拍:相机权限、烘焙淡底图、金额格铺图、自动写拍摄时间 + GPS
- ✅ 打卡:首页行内一次点击完成,并顺手记定位
- ✅ 待发片行内按钮、保存条常驻、下拉关闭
- ⏳ GPS 坐标在国内的偏移(Apple 地图会纠偏,但高德/百度不认 WGS84)、导航跳转、底部安全区
- ⏳ 免费签名到期日 **2026-11-29** 前后需重装(同一命令,数据保留)

## P1 收尾:催收跟进 · 平台到账 · 冲突定位 · 收款撤销 · 未来 7 天(2026-11-22 深夜)

上一轮把 P0 清空了,这一轮按 `docs/creator-workflow-review.md` §7 的顺序把 **P1 剩余 5 项一次做完**。
五项都围绕同一个原则:**钱要可逆、信息要能带走、排期要能一眼看清**。

### 1. 催收跟进痕迹(P1-6)——`orders.remind_log`

- **问题**:`remindAt` 只能回答"下次什么时候提醒",回答不了"我催过几次、对方怎么答"。
  真实动作是「问一次 → 对方说 X 号给 → 再问一次」,单点备忘必然丢中间过程。
- **数据**:新增 `remind_log TEXT`(JSON 数组 `[{at,note}]`,按时间追加,最多保留最近 50 条)。
  属于附加信息:**坏条目只丢该条,不抛错**(与到店定位同样的容错口径),
  `validateState` 里过滤 `at` 非法的条目、`note` 非文本归一为空串;订单没有该键时不凭空造键(旧备份原样往返)。
- **交互**:详情页「催收跟进」一行显示 `已催 N 次 · 最近 时间` + 最近 4 条时间线(时间 + 对方答复),
  右上「再催一次 ›」打开记录弹层:6 个常用答复 chips + 一句备注,记录时间自动取现在。
  提醒与跟进分开:跟进记事实,1/3/7 天按钮定下次闹钟,不在一条记录里混两种语义。
- **导出**:CSV 增「催收次数 / 最近催收」两列;`.db` 增 `remind_log` 列。

### 2. 抖音商单预计到账(P1-7)——`orders.expect_pay_at`

- **问题**:平台结算的钱什么时候到,只能自己记在别处;「平台会结」很容易变成无限期等待。
- **数据**:新增 `expect_pay_at TEXT`(完整本地时间串,弹层只选日期、时间固定 `10:00`,便于排序与比较);
  无值时不造键,导入时非法日期直接拒绝。
- **判定**:`TanJiLogic.expectOverdue(o,payments,today)` —— 尾款未收 + 已过约定日才算超期,返回超期天数。
  已收 / 没填日期 / 未到期一律 0,不制造焦虑。
- **交互**:详情页「平台到账」卡片(可设/改/清)+ chip「预计 M-D 到账 · 超期 N 天」;
  收款页平台单行显示「预计 M-D 到账(已超 N 天)」,超期的 chip 转红。
- **为什么不进催收**:平台单的钱不由达人催,催收口径仍是"私收尾款",两套语义不能混(逾期天数也不该起算)。

### 3. 冲突提示带时间与地点(P1-9)

- 原来只报门店名 + 时间,判断不了"要不要跨区、要不要接"。
- `conflictFor()` 改为逐条列出 `HH:mm 「店名」 · 地点`(手填地点优先,没填退回 GPS 坐标),
  并标明是「前后 2 小时内」还是「当天已有 N 个排期」;仍然只提示不拦截。

### 4. 收款撤销(P1-10)

- `pay()` 成功后 toast 改为带「撤销」按钮(5 秒窗口),点击回滚:删掉那条流水 + 清掉 `depositPaidAt/finalPaidAt`。
- **回滚是保守的**:用 `(oid, kind, at)` 三段定位流水,并要求订单标记字段仍是当初写入的时间,
  对不上就只提示"已被改动,无法撤销",绝不动别人的账。
- 两个坑记一下:
  1. `.toast` 原本 `pointer-events:none`(纯提示),带动作时才加 `.act` 放开,否则会挡住顶部按钮;
  2. `toastAction` 是 `{label,run}` **对象**,处理器里必须 `action.run()` —— 一开始写成
     `typeof run==='function'` 判断,按钮点了没反应还不报错。已补单测直接模拟 `toast-undo` 点击防回归。

### 5. 未来 7 天视图(P1-8)

- 行程页月历下方加横滑条:7 格「今天/明天/周X · M-D · N 单」,点格直接落到那天(跨月时同步翻月)。
- 汇总用纯函数 `TanJiLogic.upcomingByDay(orders,fromISO,days)`(含起点当天),UI 只渲染。

### 验证

- `npm test` **106 项**全通过(新增:催收痕迹校验/追加、预计到账超期判定与弹层、未来 7 天窗口、
  冲突文案带地点、撤销执行与保守回滚、原生旧库补两列 + JSON 落库 + 重启读回)。
- `npm run test:smoke` **20 项**检查通过,`consoleErrors` 空(新增 `future 7 days bar` / `collection follow-up log` / `payment undo`)。
- `npm run check` 无漂移(`scripts/web-sync.lock.json` 已重新登记)。
- 存量数据:老库打开时 `ALTER TABLE` 自动补 `remind_log` / `expect_pay_at` 两列(单测覆盖 v0.5 旧表迁移)。

### 已知边界

- 催收痕迹只记「时间 + 一句答复」,不做多轮结构化跟进(谁答应、答应什么日子由答复文本承载);
- 预计到账日只服务抖音商单,平台实际打款仍需去后台确认;
- 未来 7 天按自然日、不按"档期冲突"聚合,跨天连拍仍需点进单日看。

## 通知开关语义修复(2026-11-22)

**bug**:统计页开关文案是「逾期催收每日提醒」,但 `Notify.toggle()` 关闭时调 `cancelAll()`,
把用户自设的 1/3/7 天催收备忘(id≥100000)和 24h 出片提醒(id≥300000)一并取消;
重新开启时只重排每日汇总,被连带取消的提醒不会恢复——用户明确设置的提醒静默消失。

**口径裁定**:开关只管每日 09:00 催收汇总。依据:UI 文案「逾期催收每日提醒」、
`validateState` 注释「每日催收通知开关」、README「每日催收汇总(可关)」均指向每日汇总;
出片提醒与 snooze 是独立功能,从未文档化受此开关控制。

**修复**:`toggle()` 关闭分支只取消 id=1 的每日汇总,不再调 `cancelAll()`。
`syncDeliver`/`scheduleSnooze` 本就不看 `notifyEnabled`,与「只管每日」语义自洽,未动。

**验证**:新增回归「通知开关:只管每日催收——关闭不撤用户自设的备忘与出片提醒」,
修复前红(备忘被连带取消)、修复后绿;`npm test` 107/107、冒烟 20 项通过。
测试编排注意:设了备忘的单会被每日汇总排除(snoozed 口径),且逾期(≥15 天)与
出片提醒(<24h)不可能同单,复现需三笔单各司其职。

## 深度 review 后续修复(2026-11-22)

对 `native-app` 做了一轮代码/流程/操作三维 review,在通知开关修复之外又落地四项:

1. **数据替换后通知不重排**(导入/恢复/清空共用 `replaceData`):旧数据已不存在,
   但已排的备忘、出片提醒还指着它,已删订单的通知会在半夜凭空响。
   修复:成功路径先 `Notify.cancelAll()` 撤干净,再按新数据 `syncDaily()+syncDeliver()`;
   备忘是"设当时的时点快照",撤掉不凭空重排(与 `switchMode` 同口径——模式切换时
   两套数据都还在设备上,旧模式的备忘指向的仍是真实数据,故只重排不撤销)。
2. **通知 id 分段撞车**:备忘原为 `100000+orderId*100+天数`,订单号≥2000 时会落进
   出片提醒的 `300000+orderId` 段(高单号备忘顶掉低单号出片提醒,取消过滤也会误伤)。
   修复:备忘改用 `100000+orderId`(一单同时只有一条备忘,无需 ×100+天数扩位),
   两段按订单号各占一段、构造上互不重叠(要求订单号<100000,个人记账远达不到)。
3. **`deliver_sub` 列缺省语义翻转**:建表/补列原为 `DEFAULT 0`,而 JSON 层的 v0.4 语义
   是"旧单正副片都要"。当前行表只写不读(读取走 settings JSON)所以未爆发,
   但谁真用行数据,老单的副片要求就会被静默关掉。修复:三处 DDL(原生建表/ALTER/
   导出建表/结构说明页)统一 `DEFAULT 1`,并补旧库迁移断言。
4. **催收计数封顶误报**:`remindLog` 保留最近 50 条,追加后读 `length` 会把"第 51 次"
   报成"第 50 次"。修复:追加前先取序号;封顶后 toast 明说"最早一条已被挤出",
   弹层/详情计数显示"50+"。

**验证**:`npm test` 111/111(新增 4 项回归:通知 id 分段、数据替换重排、
deliver_sub 迁移缺省、计数封顶显示),冒烟 20 项 `consoleErrors` 空,
`npm run check` 无漂移(锁文件已重新登记),`build:ios` BUILD SUCCEEDED。
