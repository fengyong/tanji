# 探记 TanJi · iOS 原生版研发笔记(native-app 分支)

> 本文档记录本地 App 版的技术路线决策、搭建步骤、环境问题与实测清单。持续更新。

## 一、路线决策(阶段 1 结论)

两条候选路线:

- **路线 A:Capacitor 壳 + 复用现有 Web UI**(HTML 单文件,SQLite 插件持久化)
- **路线 B:SwiftUI + GRDB 纯原生重写**

### 1. 逐项对比

| 维度 | A. Capacitor 壳 | B. SwiftUI + GRDB |
|---|---|---|
| **数据层** | @capacitor-community/sqlite 插件,JS API 直接建表/查询;与现有 Web 版 `localStorage` 数据模型一一对应,补上 `settle_via` / `remind_at` 字段即可 | GRDB + 手写 Record 类型与 Migration;类型安全、可做强校验;但全部 CRUD 要用 Swift 重写一遍 |
| **状态机复用** | `workOf / payOf / owedOf / overdueDays` 等派生逻辑已在原型 JS 中,零改动复用 | 需要用 Swift 重写派生逻辑 + 全部 5 个页面 UI(约 900 行原型 → 预计 2000+ 行 Swift) |
| **本地通知** | @capacitor/local-notifications:JS 层调度,支持触发器(schedule.at),够用;后续精细控制(如"1/3/7 天后再次提醒"链)也可用同一插件循环排程 | UNUserNotificationCenter 原生 API,控制粒度最高(可做可重复的日历触发器) |
| **分享导出** | @capacitor/filesystem 写临时文件 + @capacitor/share 调起系统分享面板;CSV/JSON 生成逻辑已在 JS 中 | UIActivityViewController + FileManager;同样简单,但 CSV/JSON 生成要重写 |
| **构建链** | `npm` + `cap sync ios` + Xcode 工程(内嵌 `www/` 资源);CI 可用 `xcodebuild` | 纯 Xcode/SwiftPM;构建最快,但一切从零 |
| **迭代成本** | Web/PWA 版与 App 版同一份 UI 代码,双端同步只需拷 `index.html` + 存储适配器 | 双端两套代码,功能变更需两端各改一遍 |
| **体验天花板** | WebView 渲染,滚动/转场略逊原生;原型 UI 已按 iPhone 安全区设计,差距可接受 | 完全原生手感,SwiftUI 动画/手势天花板 |
| **风险** | WebView 性能上限;依赖第三方社区 SQLite 插件维护状态 | 工作量最大;单人+AI 协作场景下迭代速度显著变慢 |

### 2. 决策

**先走路线 A(Capacitor),理由:**

1. 探记是"单人研发 + 快速验证阶段"的工具型 App,当前目标是尽快在真机可用、与 Web 版同步迭代;Capacitor 让 UI/状态机 100% 复用,增量成本集中在存储适配器与原生桥接(通知/导出),预计 1-2 天内可出可安装包。
2. 数据层目标一致:两条路线最终都是本机 SQLite(orders/payments/settings),A 路线用插件建出的 `.db` 文件结构可与 B 路线完全对齐,后续若升级路线 B,数据文件可直接迁移,不留死路。
3. 路线 B 不废弃:记录为"体验升级预留项"。触发条件(任一):WebView 性能问题无法接受 / 需要深度系统集成(如 Widget、Live Activity)/ 社区 SQLite 插件停止维护。

**混合兜底**:App 内热路径(如催收阈值、隐私模式开关)用 Capacitor Preferences/Settings 均可,不做平台锁死。

## 二、环境盘点(搭建前实测,macOS 13.6 Intel)

| 项 | 现状 | 影响 | 处理 |
|---|---|---|---|
| Node | 仅 v12.6.0(brew 旧链) | Capacitor 7 要求 Node >= 20 | 下载 nodejs.org 官方 darwin-x64 tarball 到用户目录,不入仓库 |
| npm | 6.9.0 | 同上 | 同上 |
| CocoaPods | 未安装(`pod` not found) | `pod install` 需要 | 系统 ruby 2.6 + `gem install cocoapods --user-install`(免 sudo) |
| Xcode | **未安装**,`xcode-select` 指向 CommandLineTools | `xcodebuild` 无法跑 iOS 模拟器构建 | 先完成工程搭建与代码,模拟器构建列入"明日实测清单"(需装机 Xcode) |
| brew | 已损坏(`MacOSVersionError: dunno`) | 无法 brew install | 不依赖 brew,全部走官方 tarball / gem |
| 网络 | npm registry 可达 | OK | — |

(后续章节:搭建步骤 / 存储适配器 / 原生桥接 / 构建验证 / 已知问题 / 明日实测清单)
