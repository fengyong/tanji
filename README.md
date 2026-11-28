# 探记 HG · iOS 本地 App

探店达人的行程、交付与收款工具。HG 是独立发展的 iOS 产品线：重做信息结构、视觉与交互，保留原 TanJi 的 SQLite 表、`settings` JSON 快照、`tanji_v3_*` 键和 JSON 备份格式。

## 两条并存的技术路线

本仓库同时保留两套实现，**各自独立发展、互不覆盖**：

| 路线 | 位置 | 技术 | 分支 |
|---|---|---|---|
| 混合版 | `www/` + `src/` + `ios/App/` | Capacitor 8 + 单一 WKWebView + UIKit 原生底栏 | `tanji-native-hg` |
| **纯原生版** | `ios/TanjiNative/` | SwiftUI，只用系统框架，无 WebView、无三方依赖 | `tanji-native-ios` |

纯原生版的说明见 [`ios/TanjiNative/README.md`](ios/TanjiNative/README.md)。两条路线的数据格式相同，备份可互相导入。

## 当前身份与状态

| 项 | 值 |
|---|---|
| 分支 | `tanji-native-hg`（混合版）/ `tanji-native-ios`（纯原生版） |
| 显示名 | 探记 HG |
| Bundle ID | 混合版 `com.tanji.hg`；纯原生版 `ord.tanji` |
| App 版本 | `1.0 (1)` |
| 技术路线 | 见上表 |
| 数据 | 纯本地；iOS 使用 App 沙盒内 SQLite，无服务器、无云同步 |
| 基线 | `native-app@534e88b`；HG 不反向修改原 TanJi App |

2026-11-27：Release `1.0 (1)` 已安装并启动到 iPhone 15 Pro，用户已确认原生底栏质感。真机权限、持久化、导入导出与日常业务验收仍待用户完成；当前未上架。

纯原生版（2026-11-28）：SwiftUI 全量重写完成，导出落到「文件」App 的「探记 HG」文件夹（带日期的 JSON / CSV / .db），导入改用系统文件选择器并保留导入前自动恢复点。真机 Face ID、通知、相册、文件选择器默认目录等仍待验证。

## 产品结构

- **首页**：今日拍摄、待发片、本月速览与逾期风险。
- **行程**：月历、未来 7 天、单日订单与行程分享。
- **订单**：搜索筛选、工作线状态、行内推进与详情工作台。
- **收款**：定金/尾款、逾期分桶、平台到账与流水。
- **统计**：业务指标与账号筛选；右上角齿轮进入独立设置页。
- **设置**：我的账号、数据与备份、提醒与隐私、数据模式、危险操作、关于与支持。

原生底栏在 iOS 26+ 使用系统 Liquid Glass，旧系统使用 blur 降级。单一 `AppBridgeViewController` / 单一 WKWebView 负责全部 Tab；原生层同步实际底栏高度、收款角标和 Tab 命令 ACK。弹层打开时隐藏底栏，关闭 360ms 后恢复；键盘只有实际覆盖底栏时才触发避让。

## 数据兼容与迁移

HG 使用独立 Bundle ID 与独立沙盒，**不会自动共享原 TanJi App 的数据**。旧数据通过「设置 → 数据与备份 → 从旧版探记导入」选择 JSON 备份迁移，导入前预览并自动保留恢复点。

- 保留 `orders`、`payments`、`accounts`、`settings` 表与既有备份格式。
- 工作/演示两套数据继续独立保存。
- JSON 用于跨 App、跨设备迁移；SQLite `.db` 用于完整数据库存档。
- 升级 App 时覆盖安装，不要卸载；卸载会删除沙盒数据。

## 目录结构

```text
www/                     Web 资源与构建产物
  app.js                  src/app/main.js 的 esbuild 产物
  cap-plugins.js          src/cap-plugins.js 的 esbuild 产物
src/app/                 页面、状态、存储、业务动作与原生 Tab 桥
src/cap-plugins.js        Capacitor 插件桥源码
ios/App/                  Xcode 工程、原生 Tab 容器与 UI Tests
scripts/                 构建、校验、装机与 watchdog 脚本
tests/                   node:test 回归与浏览器冒烟
docs/                    设计资料、装机指南、发布清单与历史研发笔记
watchdog/                 持久化进度；运行时文件已忽略
```

## 常用命令

```bash
npm test                   # 186 项回归
npm run test:smoke         # 320×568、390×844、1280×900 浏览器冒烟
npm run check              # 校验 www/app.js、www/cap-plugins.js 与源码一致
npm run build:app          # 只重建 www/app.js
npm run build:plugins      # 只重建 www/cap-plugins.js
npm run sync               # 重建产物 + cap sync ios
npm run build:ios          # 同步后构建 iPhone 模拟器版本
npm run install:ios:device # 真机签名、安装并启动
```

HG 已独立重做 UI 与交互，不再执行 `main → native` 漂移锁。在 `tanji-native-hg` 分支上，`npm run check` 只校验构建产物；CI detached HEAD 使用 `--artifact-only`。不要用 `npm run check:update` 把 HG 重新锁回原 TanJi App。

## 验证记录

2026-11-27 已通过：

- `npm test`：186/186。
- `npm run test:smoke`：320×568、390×844、1280×900，控制台零错误。
- `npm run check`：HG 独立副本构建产物与源码一致。
- `npm run build:ios`：模拟器构建成功。
- 原生 XCUITest：3/3，覆盖 Tab/设置路由、弹层避让、键盘避让。
- 模拟器 SQLite 重启后保留：orders 17、payments 18、accounts 0、settings 1。
- 真机 Release 构建、签名、安装、启动与设备元数据核验。

模拟器和自动化测试不能替代真机验收。待用户确认：相机、相册、定位、通知权限，SQLite 持久化与重启，JSON 导入导出，离线，安全区、Liquid Glass、键盘和弹层实际手感。

## 真机安装

完整步骤见 [docs/device-install.md](docs/device-install.md)。默认 Bundle ID 已是 `com.tanji.hg`：

```bash
DEVELOPMENT_TEAM=<TEAM_ID> DEVICE_UDID=<DEVICE_UDID> \
CONFIGURATION=Release npm run install:ios:device
```

Team ID、UDID、证书和私钥只放在本机环境变量中，不写入仓库。签名有效期取决于 Team 与 provisioning profile；付费开发者团队不统一按 7 天计算。

## 提交与推送

开始改动前先读 [AGENTS.md](AGENTS.md)，提交前再读 [docs/git-push-guide.md](docs/git-push-guide.md)。

- 提交标题格式：`<agent>/<model> <type>(<scope>): <摘要>`；当前会话使用 `qoder/undisclosed`，不披露底层模型。
- 使用显式路径暂存，禁止 `git add -A` / `git add .`。
- 推送使用 `git@github-fengyong:fengyong/tanji.git` 别名地址。
- 不 force push、不 merge、不修改 `main` / `native-app`、不删除旧 App 数据。

## 资料索引

- [docs/requirements.html](docs/requirements.html)：HG 设计反推与交互方向资料。
- [docs/product-design-v0.6.html](docs/product-design-v0.6.html)：继承的 v0.6 产品设计基线。
- [docs/native-app-notes.md](docs/native-app-notes.md)：原 TanJi Native 历史研发笔记；旧分支、旧 Bundle ID 与旧签名记录不代表 HG 当前状态。
- [docs/appstore-release-checklist.md](docs/appstore-release-checklist.md)：未来上架对账清单；当前尚未发布。
