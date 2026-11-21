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

**表结构(与 Web v0.2 完全同构,Web 导出的 .db 可直接打开原生库):**

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
| `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator build` | ❌ **未执行**:`xcode-select: error: tool 'xcodebuild' requires Xcode, but active developer directory '/Library/Developer/CommandLineTools' is a command line tools instance`;`xcrun --sdk iphonesimulator` 无 SDK。**本机未安装 Xcode,属环境缺失而非代码错误** |
| CLT 下的替代校验 | ✅ `plutil -lint` Info.plist / project.pbxproj 均 OK;capacitor.config.json JSON 校验 OK;pbxproj 含 9 处 CapApp-SPM 引用;deployment target iOS 15.0;bundle id com.tanji.app |
| Web 冒烟(浏览器模拟 WebView 行为) | ✅ 17 笔种子载入、隐私模式、snooze、save→localStorage、.db 字节构建(49KB)、通知模块静默降级 |

**结论**:代码层面就绪,卡在机器无 Xcode。装 Xcode 后按第七节清单执行,大概率一次通过;若报错预计集中在 SPM 网络解析或最低 iOS 版本,均已预留处理办法。

## 七、明日实测清单(装好 Xcode 后)

1. **装机**:App Store 安装 Xcode(16+);`sudo xcode-select -s /Applications/Xcode.app`;首次启动装 iOS Simulator runtime。
2. **首次构建**:
   ```bash
   npm run sync
   xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 16' build
   ```
   SPM 首次解析需联网拉 `github.com/ionic-team/capacitor-swift-pm`。若 SPM 超时,改用 CocoaPods 路线:`rm -rf ios && npx cap add ios --packagemanager CocoaPods`(需先 `sudo gem install cocoapods`,ruby 2.6 可用)。
3. **模拟器跑通**:Xcode 选 iPhone 模拟器 Cmd+R;核对:首页载入 17 笔示例数据 → 新建预约(试冲突提醒)→ 标记拍摄/提审/发片 → 收定金/尾款(选渠道)→ 统计页开关通知。
4. **SQLite 验证**:新增一笔订单 → 导出 .db → `sqlite3 探记-xxxx.db '.schema orders'` 与 `SELECT * FROM orders` 核对表结构与数据;同时验证 Web 端导出的 .db 结构一致。
5. **通知验证**(模拟器即可):首次触发 snooze 授权弹窗 → 允许 → 设置 1 天后提醒;另验证每日 09:00 汇总(可临时把系统时间调快或把 hour 改成 2 分钟后);关闭通知开关后确认 pending 清空。
6. **导出验证**:CSV/JSON/.db/分享图四种导出都调起系统分享面板(模拟器可分享到"存储到文件"或备忘录)。
7. **真机(可选)**:个人开发者证书或免费 Apple ID 签名,重点看 sqlite 库读写与通知到达率。
8. **回归 Web 双端**:native 端产生数据后导出 JSON,再在 Web 端导入比对(或反向),确认字段语义一致。

## 八、已知问题 / 风险

- **Xcode 未装**:唯一阻塞项;其余环境问题均已绕开(SPM 免 CocoaPods、npmmirror 免 nodejs.org 超时)。
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
