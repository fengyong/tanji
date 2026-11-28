# 探记 HG · iOS 原生 App —— 必读

> **任何 AI agent 或新同学在改这个仓库之前，先读完这一页。**
> 两条 Git 硬规则违反其一，这次提交/推送就不算数。

仓库：`fengyong/tanji` ｜ 当前分支：`tanji-native-hg`（探记 HG 独立发展线）
配套详情：[`docs/git-push-guide.md`](docs/git-push-guide.md) ｜ 装机指南：[`docs/device-install.md`](docs/device-install.md)

---

## 硬规则 1 · 提交标题必须以 agent 名称 / 模型名称开头

```text
<agent名称>/<模型名称> <类型>(<作用域>): <一句话摘要>
```

- 前缀必须在**标题行开头**，不能写成 `fix(native): qoder/undisclosed ...`。
- 换 agent 或换模型就写当次实际使用的前缀；当前 Qoder 会话使用 `qoder/undisclosed`，不披露底层模型。
- 正文不受前缀约束，正文讲**为什么**、验收结果与未实测项。

```text
qoder/undisclosed feat(hg): 完成独立 UI 与原生 Liquid Glass 底栏
```

## 硬规则 2 · 推送一律用 `fengyong` 账号

```bash
git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/<分支>
```

- `origin` 的 SSH 身份是 `drax-ola`，对 `fengyong/tanji` **无写权限**。
- `~/.gitconfig` 的 `insteadOf` 会让 HTTPS 改写失效；统一使用 SSH 别名地址。
- `~/.ssh/config` 已配置 `Host github-fengyong`；校验命令 `ssh -T git@github-fengyong` 应回 `Hi fengyong!`。
- **不要修改 `github-fengyong` 别名，不要 force push。**

---

## 这个仓库是什么

探店达人的行程 + 记账工具。仓库里并存两条技术路线，**各自独立发展、互不覆盖**：

- **混合版**（`www/` + `src/` + `ios/App/`）：HG 在 Capacitor 8 壳中重做产品结构、UI 与交互。
- **纯原生版**（`ios/TanjiNative/`）：SwiftUI 全量重写，只用系统框架，无 WebView、无三方依赖。

两条路线的共同约定：

- Web 预览使用 IndexedDB + localStorage；iOS 使用 App 沙盒内 SQLite。
- **纯本地**：数据不上传任何服务器，无云同步、无广告、无分析 SDK。
- 保留原 TanJi 的 SQLite 表、`settings` JSON 快照、`tanji_v3_*` 键和 JSON 备份格式。
- 工作/演示两套数据空间独立保存。
- 混合版 Bundle ID 为 `com.tanji.hg`；纯原生版为 `ord.tanji`；两者沙盒隔离，旧数据通过 JSON 导入互迁。

纯原生版细节见 [`ios/TanjiNative/README.md`](ios/TanjiNative/README.md)，接口约定见 `ios/TanjiNative/CONTRACT.md`。

## 目录结构

```text
www/                     Web 资源与构建产物
  index.html             UI、样式与模块入口
  app.js                 src/app/main.js 的 esbuild 产物，别手改
  cap-plugins.js         src/cap-plugins.js 的 esbuild 产物，别手改
  vendor/                sql.js WASM，用于导出真 .db 字节
src/app/                 页面、状态、存储、业务动作与原生 Tab 桥
  native-tabs.js         Web → Native Tab 状态桥
  views/settings.js      独立设置页
src/cap-plugins.js       插件桥源文件
ios/App/                 混合版 Xcode 工程、原生 Tab 容器与 UI Tests
ios/TanjiNative/         纯原生版 SwiftUI 工程（xcodegen 生成，project.yml 是正本）
scripts/                 构建、校验、装机与 watchdog 脚本
tests/                   node:test 回归 + 浏览器冒烟
docs/                    设计资料、装机指南、发布清单与历史笔记
watchdog/                持久化进度；heartbeat/log/review 等运行时文件忽略
```

## 常用命令

```bash
npm test                   # 186 项回归，全绿才算能提交
npm run test:smoke         # 320×568、390×844、1280×900 浏览器冒烟
npm run check              # www/app.js、www/cap-plugins.js 与源码一致性
npm run build:app          # 重建 www/app.js
npm run build:plugins      # 重建 www/cap-plugins.js
npm run sync               # 重建产物 + cap sync ios
npm run build:ios          # 同步后构建 iPhone 模拟器版本（混合版）
npm run install:ios:device # 真机签名、安装并启动（混合版）
npm run ios:generate       # 重新生成纯原生版的 Xcode 工程
npm run ios:build          # 纯原生版模拟器构建
npm run ios:test           # 纯原生版单元 + UI 测试
./scripts/watchdog.sh resume
```

HG 已独立重做 UI 与交互，不再执行 `main → native` 漂移锁。在 `tanji-native-hg` 分支上，`npm run check` 只校验构建产物；CI detached HEAD 使用 `--artifact-only`。不要用 `npm run check:update` 把 HG 重新锁回原 TanJi App。

## 分支与边界

| 分支 | 作用 |
|---|---|
| `main` | 原 TanJi Web / PWA 版，HG 不修改 |
| `native-app` | 原 TanJi iOS 版，HG 的历史基线，不修改 |
| `tanji-native-hg` | **探记 HG 混合版**（Capacitor）分支 |
| `tanji-native-ios` | **探记 HG 纯原生版**（SwiftUI）分支 |
| `fix/*` `feat/*` | 短分支，从对应主线切出 |

- 不要跨分支 merge；需要别人的改动用 `rebase`。
- 不要修改工作区中并行的 `../tanji-native` 目录，该目录有并行会话的在制品。
- 不要 force push、merge、上架或删除旧 App 数据，除非用户单独明确授权。
- 纯原生版只动 `ios/TanjiNative/`；不要顺手改 `www/`、`src/`、`ios/App/`。
- 当前没有已知未修复代码缺陷；真机权限与日常业务验收由用户完成。

## 动手前必须知道的坑

- **`git add -A` 会吞掉别人的在制品。** 一律用显式路径，并先检查 `git status --short`。
- 改了 `src/app/` 必须 `npm run build:app`；改了 `src/cap-plugins.js` 必须 `npm run build:plugins`。
- 改了 `www/` 后，真机构建前必须 `npm run sync`，否则装进去的还是旧前端。
- `buildSqliteBytes()` 把 SQL 异常 catch 成 `null`，SQL 错误不会进日志；靠导出表结构测试防回归。
- 建表用 `executeSet`，每项带 `values: []`；`execute` 才支持多语句。
- 回归测试跑 mock，**不能替代模拟器/真机实跑**；原生功能改完要 `npm run build:ios` + 模拟器验证。
- 弹层打开时隐藏原生底栏；关闭后延迟 360ms 恢复，重开要取消旧定时器。
- 键盘避让由原生帧通知判断，只有实际覆盖底栏时才隐藏；不要整棵隐藏 WebView 无障碍节点。
- Team ID、UDID、私钥、真实账目数据不得写入仓库；`watchdog/review/` 截图证据不提交。

### 纯原生版特有

- **`.xcodeproj` 不入库**：`ios/TanjiNative/project.yml` 是正本，改完跑 `npm run ios:generate`。
- **本机 `sandbox-exec` 不可用**（macOS 27 报 `sandbox_apply: Operation not permitted`），SwiftUI 宏展开会失败。编译/测试都要带 `OTHER_SWIFT_FLAGS='$(inherited) -Xfrontend -disable-sandbox'`。
- **提示条会被 sheet 遮住**：设置页、订单详情等都是 `.sheet`，提示条要由该层自己挂宿主（`toastHost()`），不能只挂在 `RootView`。同一时刻只显示最上层宿主的提示条（`AppModel.toastHostStack` 仲裁）。
- **提示条要避开顶栏**：顶栏加 `toastTopAnchor()` 上报高度，提示条据此下沉；不要写死像素值。
- **UI 测试会改数据**（推进订单、打卡），启动参数带 `-tanji-reset` 重置成 Demo 种子，保证可重复。
- **定位元素优先用 `accessibilityIdentifier`**（如 `order.row.<id>`、`export.json`）；`.plain` 按钮的可访问性标签是「标题 + 副标题」的拼接串，只能用 CONTAINS 匹配，不能等值匹配。

## 真机与发布

- 默认 Bundle ID：`com.tanji.hg`；版本 `1.0 (1)`。
- 签名有效期取决于 Team 与 provisioning profile；付费开发者团队不统一按 7 天计算。
- 覆盖安装保留沙盒数据；卸载会删沙盒数据，升级时不要卸载。
- App Store 未来走**买断付费**，App 内零购买代码、零服务端、零 IAP；当前尚未上架。
- 提审前逐条对账 [`docs/appstore-release-checklist.md`](docs/appstore-release-checklist.md)。
