# 探记 TanJi · Web / PWA —— 必读

> **任何 AI agent 或新同学在改这个仓库之前，先读完这一页。**
> 两条硬规则违反其一，这次提交/推送就不算数。

仓库：`fengyong/tanji` ｜ 当前分支：`main`（Web / PWA 版，线上部署即此分支）
配套详情：[`docs/git-push-guide.md`](docs/git-push-guide.md)（提交与推送）
iOS 原生版见 `native-app` 分支，那边有一份同规则的完整版。

---

## 硬规则 1 · 提交标题必须以 agent 名称 / 模型名称开头

```
<agent名称>/<模型名称> <类型>(<作用域>): <一句话摘要>
```

- 前缀取值：`mimocode/M31.1-flash`（MiniMax Code / MiniMax-M3.1-Flash，本项目当前在用）；
  换 agent 或换模型就写你**当次实际用的**那个。
- 前缀必须在**标题行开头**，不能写成 `feat(web): mimocode/M31.1-flash ...`。
- 目的：出问题时按前缀筛出「同一 agent / 同一模型引入的一批提交」，快速定位。
- 正文（`-m "正文"`）不受前缀约束，正文讲**为什么**。

```
mimocode/M31.1-flash feat(web): 加「免费 PWA → 付费 iOS App」转化入口
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

探店达人的行程与收款本机记账工具。**纯前端 PWA，无后端依赖**；订单与流水保存在本机，
并生成可导出的 SQLite 数据库。线上正式版免费，对应 iOS 买断付费版（`native-app` 分支）。

**纯本地优先**：数据不上传任何服务器；localStorage 与 IndexedDB 双副本按修订号取新；
`.db` / CSV / JSON 导出与 JSON 导入恢复是核心能力，不可牺牲。

## 目录结构

```
index.html            主应用（UI + 业务状态 + SQLite 生成）
storage.js            双副本存储、迁移、导入恢复与写入锁
logic.js              业务规则纯函数层（不碰 DOM，可单测）
imaging.js            图像处理（裁切/压缩/烘焙淡化 + 体积上限）
geo.js                到店定位与地图跳转
sw.js                 Service Worker（离线缓存，发版必须 bump VERSION）
manifest.webmanifest  PWA 清单
vendor/               sql.js WASM（导出真 .db 字节）
icons/                App 图标（512/192/apple-touch 180）
privacy.html          隐私政策（App Store 审核必填 URL）
support.html          支持与常见问题（App Store 审核必填 URL）
tests/                node:test 回归 + 浏览器冒烟
docs/                 文档
```

## 常用命令

本分支没有 `package.json`，用 `node` 直接跑：

```bash
node --test tests/          # 44 项回归（43 通过 + 1 项按条件跳过），全绿才算能提交
node tests/browser-smoke.cjs   # 浏览器端到端冒烟（需本机 Chrome，可用 CHROME_BIN 指定）

python3 -m http.server 48762 --bind 127.0.0.1   # 本机预览，端口要和 README 一致
```

## 分支与同步方向

| 分支 | 作用 |
|---|---|
| `main` | Web / PWA 版（**本分支**），线上部署即此分支 |
| `native-app` | iOS 原生版独立主线（Capacitor 壳 + 原生 SQLite/本地通知） |
| `lab` | 点子实验室（8 个点子 demo + 自测试机制），独立部署 |
| `fix/*` `feat/*` | 短分支，从 `main` 或 `native-app` 切出 |

- **同步方向永远是 main → native**，不要反向。native 侧改完 Web 资源要用 `npm run sync:web` 回灌。
- **不要跨分支 merge**，需要别人的改动用 `rebase`。
- 不要直接在 `main` 上做需求开发，先切短分支。

## 动手前必须知道的坑

- **`git add -A` 会吞掉别人的在制品。** 多人 / 多 agent 共享 worktree 时一律用显式路径。
- **改 `sw.js` 必须同步 bump `VERSION`**，否则老用户拿不到更新；
  预缓存清单里的文件若 404，`cache.addAll` 整批失败 → `navigator.serviceWorker.ready` 永不就绪。
- 预缓存清单加文件时，测试服务器的白名单也要一起加，否则冒烟测试超时。
- `buildSqliteBytes()` 把 SQL 异常 catch 成 `null`，**SQL 错误不会进日志** ——
  靠 `tests/export-schema.test.cjs` 静态比对列数/列序防回归。
- 隐私政策页与支持页在 `main` 根目录，**联系邮箱是占位符，发布前必须替换**。
- 回归测试跑的是浏览器行为，**不能替代真机验收**（iOS 安装、系统分享、系统清理仍需人工确认）。

## 双渠道策略

免费 PWA 承担宣传与试用，付费 iOS App 承担变现与功能迭代。
漏斗入口是 `index.html` 顶部的 `APP_STORE_URL` 常量：留空显示「即将上架」，填上 App ID 自动变可点链接。
两端代码保持同源，不要在 main 侧写 native 专属逻辑。

## 上架相关

App Store 走**买断付费**（付费下载），App 内零购买代码、零服务端、零 IAP。
提审前逐条对账 `native-app` 分支的 [`docs/appstore-release-checklist.md`](https://github.com/fengyong/tanji/blob/native-app/docs/appstore-release-checklist.md)。
