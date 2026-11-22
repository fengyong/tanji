# 探记 TanJi · iOS 原生 App —— 必读

> **任何 AI agent 或新同学在改这个仓库之前，先读完这一页。**
> 两条硬规则违反其一，这次提交/推送就不算数。

仓库：`fengyong/tanji` ｜ 主线分支：`native-app`（iOS 原生版独立主线；需求从它切 `fix/*`，别在主线上直接开发）
配套详情：[`docs/git-push-guide.md`](docs/git-push-guide.md)（提交与推送）
装机指南：[`docs/device-install.md`](docs/device-install.md)（真机安装 · 免费 Apple ID · 故障对照表 · 模拟器）

---

## 硬规则 1 · 提交标题必须以 agent 名称 / 模型名称开头

```
<agent名称>/<模型名称> <类型>(<作用域>): <一句话摘要>
```

- 前缀取值：`mimocode/M31.1-flash`（MiniMax Code / MiniMax-M3.1-Flash，本项目当前在用）；
  换 agent 或换模型就写你**当次实际用的**那个。
- 前缀必须在**标题行开头**，不能写成 `fix(native): mimocode/M31.1-flash ...`。
- 目的：出问题时按前缀筛出「同一 agent / 同一模型引入的一批提交」，快速定位。
- 正文（`-m "正文"`）不受前缀约束，正文讲**为什么**。

```
mimocode/M31.1-flash fix(native): 修正 orders 导出 INSERT 多一个占位符
```

## 硬规则 2 · 推送一律用 `fengyong` 账号

```bash
git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/<分支>
```

- `origin` 的 SSH 身份是 `drax-ola`，对 `fengyong/tanji` **无写权限**。
- `~/.gitconfig` 有 `url.git@github.com:.insteadOf = https://github.com/` 全局改写
  → **改 remote、换 HTTPS、加 `-u` 全部无效**；HTTPS 到 github.com 在这条网络不通，SSH 通。
- `~/.ssh/config` 已配好 `Host github-fengyong` → `~/.ssh/id_ed25519_fengyong`（`IdentitiesOnly yes`）。
- 校验：`ssh -T git@github-fengyong` 必须回 `Hi fengyong!`。
- **不要**改 `github-fengyong` 这条别名，它是规范账号 `fengyong` 的身份。

---

## 这个仓库是什么

探店达人的行程 + 记账工具。Capacitor 壳复用 Web UI，持久化按平台切换：
Web 走 IndexedDB + localStorage，iOS 原生走 App 沙盒内 SQLite（`@capacitor-community/sqlite`）。

**纯本地**：数据不上传任何服务器；SQLite + localStorage 双副本 + revision 取新；`.db` 导出是核心能力，不可牺牲。

## 目录结构

```
www/                Web 资源（与 main 分支 Web 版同源；index.html/storage.js 含原生适配层）
  index.html        UI + 页面状态 + 平台自适应持久化 + 原生桥接
  logic.js          业务规则纯函数层（工作线/资金线/逾期/出片/统计/排期），不碰 DOM
  imaging.js        图像处理（裁切/压缩/烘焙淡化 + 体积上限）
  geo.js            到店定位与地图跳转
  cap-plugins.js    esbuild 打包的 Capacitor 插件桥（window.TanjiCap）—— 是构建产物，别手改
  vendor/           sql.js WASM（导出真 .db 字节）
src/cap-plugins.js  插件桥源文件（改它 → npm run build:plugins）
ios/App/            Capacitor 8 生成的 Xcode 工程（SPM，无需 CocoaPods）
scripts/            漂移防护三件套 + 构建脚本
tests/              node:test 回归 + 浏览器冒烟
docs/               研发笔记 + 交互评估 + 上架清单 + 原型
```

## 常用命令

```bash
npm test                # 135 项回归（node --test），全绿才算能提交
npm run test:smoke      # 浏览器端到端冒烟（需本机 Chrome）
npm run check           # main/native 漂移校验（指纹锁 scripts/web-sync.lock.json）
npm run check:update    # 有意改了共享文件后重登记锁基线
npm run sync:web        # 从 main 同步 Web 资产（纯资产自动拷，index.html/storage.js 需人工合并）
npm run build:plugins   # esbuild：src/cap-plugins.js → www/cap-plugins.js
npm run sync            # 打包插件桥 + cap sync ios（www → ios/App/App/public）
npm run build:ios       # xcodebuild 模拟器构建（不签名）
```

## 分支与同步方向

| 分支 | 作用 |
|---|---|
| `main` | Web / PWA 版（线上部署即此分支），免费体验入口 |
| `native-app` | **iOS 原生版独立主线**（本分支） |
| `fix/*` `feat/*` | 短分支，从 `native-app` 或 `main` 切出，完成后快进合回 `native-app` |

- **同步方向永远是 main → native**（`npm run sync:web`），不要反向。
- **不要跨分支 merge**，需要别人的改动用 `rebase`。
- 不要直接在 `main` / `native-app` 上做需求开发，先切短分支。

## 动手前必须知道的坑

- **`git add -A` 会吞掉别人的在制品。** 多人 / 多 agent 共享 worktree 时一律用显式路径。
- `www/cap-plugins.js` 是构建产物，CI 会比对；改 `src/cap-plugins.js` 后必须 `npm run build:plugins`。
- `www/index.html` / `www/storage.js` 是 main/native 共享文件，改完必须 `npm run check:update` 重登记指纹锁。
- `buildSqliteBytes()` 把 SQL 异常 catch 成 `null`，**SQL 错误不会进日志** —— 靠 `tests/export-schema.test.cjs` 静态比对列数/列序防回归。
- 建表用 `executeSet` 且每项必须带 `values: []`（iOS 侧强校验）；`execute` 走 `sqlite3_exec` 支持多语句。
- 回归测试跑的是 mock，**不能替代模拟器/真机实跑**；原生功能改完要 `npm run build:ios` + 模拟器验证。
- 模拟器 GUI 在 `Xcode.app/Contents/Applications/DeviceHub.app`，没有可见窗口、无法自动化点击，UI 验收需人工过。

## 上架相关

App Store 走**买断付费**（付费下载），App 内零购买代码、零服务端、零 IAP。
提交审核前逐条对账 [`docs/appstore-release-checklist.md`](docs/appstore-release-checklist.md)。
