# 提交与推送指南

> 面向所有参与探记 TanJi 的同学。目标是：**看完能自己把改动安全地送上 GitHub**，
> 不再出现「push 被拒 / 超时 / 分不清该推哪个分支 / 推完 CI 红」这类来回折腾。
>
> 最后核对：2026-11-22（`native-app` 转为独立开发主线；短分支快进合入后直接推送；
> **新增两条硬规则**：提交标题必须带 agent/模型前缀、推送必须用 `fengyong` 账号）。

---

## 0. 必读：两条硬规则

> 这两条没有例外。**违反其中任何一条，这次提交/推送就不算数。**
> 同样的两条也写在仓库根目录的 [`AGENTS.md`](../AGENTS.md)（任何 AI agent 或新同学动手前先读它）。

### 规则一 · 提交标题必须以 agent 名称 / 模型名称开头

格式：

```
<agent名称>/<模型名称> <类型>(<作用域>): <一句话摘要>
```

前缀取值表：

| 前缀 | 对应的 agent / 模型 |
|---|---|
| `mimocode/M31.1-flash` | MiniMax Code / MiniMax-M3.1-Flash —— 本项目当前在用 |
| `<你的 agent>/<你这次的模型>` | 换 agent 或换模型时，写你**当次实际用的**那个 |

真实例子：

```
mimocode/M31.1-flash feat(native): v0.5 工作流增强 + v0.6 多账号体系
mimocode/M31.1-flash fix(native): 修正 orders 导出 INSERT 多一个占位符
mimocode/M31.1-flash docs(native): 多账号体系原型图(7屏) + v0.5/v0.6 研发记录
```

要点：

- 前缀必须在**标题行开头**。不能写成 `fix(native): mimocode/M31.1-flash ...`（前缀跑到类型后面就失去意义了）。
- **换了模型就换前缀。** 出问题时按前缀一筛，就能把「同一个 agent / 同一个模型引入的一批提交」全捞出来定位。
- 只有标题行受约束。正文（`git commit -m "标题" -m "正文"`）正常写。

### 规则二 · 推送一律用 `fengyong` 账号

```bash
git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/<分支>
```

为什么是它（2026-11-22 实测）：

- `origin` 的 SSH 身份在这台机器上是 `drax-ola`，对 `fengyong/tanji` **没有写权限**；
- 本机 `~/.gitconfig` 有一条 `url.git@github.com:.insteadOf = https://github.com/`，
  会把所有 HTTPS 地址改写成 SSH —— 所以**改 remote、换 HTTPS、加 `-u` 都解决不了问题**；
- HTTPS 到 `github.com` 在这条网络下不通（`curl -I https://github.com` 超时），SSH 通；
- `~/.ssh/config` 里已经配好专属别名，指向 `fengyong` 账号的 key。

实测记录：

| 检查 | 命令 | 期望输出 |
|---|---|---|
| 默认身份是谁 | `ssh -T git@github.com` | `Hi drax-ola!` ← **别用它推** |
| 规范身份是谁 | `ssh -T git@github-fengyong` | `Hi fengyong!` |
| 写权限 | `git push --dry-run git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/native-app` | `Everything up-to-date`（GitHub 只对有写权限的人开放 receive-pack，能出这个结果就说明有写权限） |

**不要改 `github-fengyong` 这条别名**，它是规范账号 `fengyong` 的身份，不是你个人的。
你自己的 key 另配一条 `Host github-<你的用户名>`，但项目推送到远端时仍以 `fengyong` 身份为准。

### 两条规则合起来的完整命令

```bash
git add <显式文件路径>                       # 别用 git add -A，会误吞别人在制品
git commit -m "mimocode/M31.1-flash feat(native): 一句话说清做了什么"
git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/<分支>
```

---

## 1. 分支模型：先搞清楚你的改动属于哪条线

| 分支 | 作用 | 谁能推 |
|---|---|---|
| `main` | Web / PWA 版（线上部署即此分支），免费体验入口 | 维护者；改动走 PR 或直接提交 |
| `native-app` | **iOS 原生版的独立开发主线**（Capacitor 壳 + 原生 SQLite/通知）；短分支完成后快进合入此分支并推送，不再绕道 `main` 走 PR | 维护者 |
| `fix/*` `feat/*` | 具体需求/修复的短分支，从 `native-app`（或 `main`）切出 | 各自负责人 |
| `lab` | 点子实验室，独立部署 | 维护者 |

两条硬规则：

1. **不要直接在 `main` / `native-app` 上做需求开发**，从基线切短分支。
2. **不要跨分支 merge**。需要别人的改动时用 `rebase`，不要 `git merge <别的分支>`——
   历史上出过把 `dev` merge 进 feature 分支、导致 PR 里混进上百个无关提交的事故。

同步方向永远是 **main → native**（`npm run sync:web`），不要反向。

---

## 2. 首次配置

### 2.1 确认你有仓库读权限

让维护者把你加成 `fengyong/tanji` 的 collaborator。没有这一步，下面全都白搭。

> 注意区分两件事：**collaborator 权限**决定你「能不能推」；
> **规则二**决定你「该用谁的身份推」。项目规范是后者 —— 统一用 `fengyong`。

### 2.2 `fengyong` 账号的 SSH key

这台机器上已经配好了（2026-11-22 已验证）：

| 东西 | 位置 |
|---|---|
| 私钥 | `~/.ssh/id_ed25519_fengyong` |
| 公钥 | `~/.ssh/id_ed25519_fengyong.pub`（已加到 `fengyong` 账号） |
| 别名 | `~/.ssh/config` 里的 `Host github-fengyong` |

换一台新机器时，从零配置：

```bash
ssh-keygen -t ed25519 -C "you@example.com" -f ~/.ssh/id_ed25519_fengyong
# 把公钥贴到 GitHub → fengyong 账号 → Settings → SSH and GPG keys → New SSH key
cat ~/.ssh/id_ed25519_fengyong.pub
```

### 2.3 配一个专属 Host 别名

编辑 `~/.ssh/config`：

```
Host github-fengyong
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_fengyong
    IdentitiesOnly yes
```

`IdentitiesOnly yes` 是关键：不加的话 SSH 可能先拿默认 key 去试，身份就串回 `drax-ola` 了。

### 2.4 验证身份（关键一步）

```bash
ssh -T git@github-fengyong     # 必须回 Hi fengyong!
ssh -T git@github.com          # 这台机器上会回 Hi drax-ola!（默认身份，别用它推）
```

如果第二条显示的账号不是你、而你又用 `git push` 直接推，就会得到
`ERROR: Permission to fengyong/tanji.git denied to <那个人>`。

---

## 3. 标准提交流程

```bash
# 1. 从最新基线切分支（示例：native 侧）
git fetch git@github-fengyong:fengyong/tanji.git native-app:refs/remotes/origin/native-app
git switch -c feat/my-change origin/native-app

# 2. 改代码 → 本地验证（见第 4 节）→ 提交
#    前缀规则见第 0 节；用显式路径 add，别用 git add -A
git add www/index.html www/storage.js
git commit -m "mimocode/M31.1-flash feat(native): 一句话说清做了什么"

# 3. 推送（首次推新分支）
git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/feat/my-change

# 4. 后续提交继续推同一个分支
git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/feat/my-change
```

需要把别人的新提交接进来时：

```bash
git fetch git@github-fengyong:fengyong/tanji.git native-app:refs/remotes/origin/native-app
git rebase origin/native-app        # 不要 merge
# 有冲突就解决后 git add + git rebase --continue
git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/feat/my-change
```

> **为什么不加 `-u`**：`git push -u <URL>` 会把 `branch.<名字>.remote` 写成那个 URL。
> 会让 `git status` 看起来有 upstream，但配置里多出一条指向别名地址的 remote，
> 后续 `git pull` / 换身份时容易互相打架。统一走显式命令更可控。

---

## 4. 提交前必须跑的检查

### 4.1 通用（两条都跑）

```bash
npm test          # 111 项：原生 32 + Web 39 + 导出表结构 5 + 规则 8 + 定位 5 + 接线 3 + …
npm run check     # main/native 漂移校验 + cap-plugins 构建产物比对
```

### 4.2 改到这些文件时的额外动作

| 你改了什么 | 必须额外执行 | 为什么 |
|---|---|---|
| `src/cap-plugins.js` | `npm run build:plugins` | `www/cap-plugins.js` 是它的构建产物，CI 会比对，不一致直接失败 |
| `www/index.html` / `www/storage.js` | `npm run check:update` | 这两个是 **main/native 共享文件**，改动必须重登记指纹锁，否则 `npm run check` 报「native 侧被改动了但未登记」 |
| `www/` 下任何文件 | `npm run sync` | 把 web 资源同步进 iOS 工程，才能在模拟器上验证 |
| 任何原生功能 | `npm run build:ios` + 模拟器实跑 | 回归测试跑的是 mock，不能替代真机/模拟器验证 |
| `docs/`、`README.md`、`AGENTS.md` | 无需额外动作 | 纯文档，不参与漂移指纹锁 |

> `npm run sync:web` 是**从 main 拉资产**，成功后会自动刷新锁基线；
> 它和「我改了自己的代码要登记」是两件事，后者用 `npm run check:update`。

### 4.3 改了共享文件却没重登记锁会怎样

`npm run check` 直接失败，CI 也会红，提示类似：

```
✗ main / native 存在未登记的漂移：
  • index.html（主应用 UI + 业务状态）
      native 侧被改动了但未登记。
```

按提示跑 `npm run check:update`，确认 diff 里只有你预期的文件，再一起提交。

---

## 5. 提交信息规范

格式（**前缀不可省**，见第 0 节规则一）：

```
<agent名称>/<模型名称> <类型>(<作用域>): <一句话摘要>
```

- **前缀**：agent 名称 / 模型名称，必填，`agent/model` 斜杠分隔。
  - `mimocode/M31.1-flash` —— 本项目当前在用（MiniMax Code / MiniMax-M3.1-Flash）
  - 别的 agent 或换了模型 → 写你当次实际用的那个
- **类型**：`feat` / `fix` / `docs` / `chore` / `refactor` / `test`
- **作用域**：`native`（iOS 侧）、`web`（PWA 侧），不明显时可省

真实示例（仓库历史风格 + 新前缀）：

```
mimocode/M31.1-flash feat(native): v0.5 工作流增强 + v0.6 多账号体系
mimocode/M31.1-flash fix(native): 修正 orders 导出 INSERT 多一个占位符
mimocode/M31.1-flash docs(native): 多账号体系原型图(7屏) + v0.5/v0.6 研发记录
mimocode/M31.1-flash chore(native): 重登记漂移锁——main@93cfa31,native 侧有意变更
```

写不下的细节放正文（`git commit -m "标题" -m "正文"`），正文讲**为什么**，别复述 diff。
正文不受前缀约束。

---

## 6. PR 与 CI

### 6.1 开 PR

推完分支后 GitHub 会打印链接，直接点；或手动：

```
https://github.com/fengyong/tanji/pull/new/<你的分支>
```

**base 必须选对**：native 改动 → `native-app`；Web/PWA 改动 → `main`。

### 6.2 CI 什么时候跑（`github/workflows/ci.yml`）

| 事件 | web job | native job | privacy job |
|---|---|---|---|
| push 到 `main` | ✅ | — | — |
| push 到 `native-app` | ✅ | ✅ | ✅ |
| PR 目标为 `main` | ✅ | — | — |
| PR 目标为 `native-app` | ✅ | ✅ | ✅ |
| push 到其他分支（如 `fix/*`） | — | — | — |

也就是说：**光推 `fix/*` 分支不会有任何 CI 反馈**，必须开 PR（或 push 到 `native-app`）才会跑原生回归、漂移校验和隐私清单检查。

### 6.3 常见 CI 红灯

| 报错 | 原因 | 处置 |
|---|---|---|
| `www/cap-plugins.js 与 src/cap-plugins.js 的构建产物不一致` | 改了 src 忘了打包 | `npm run build:plugins` 后提交产物 |
| `main 已更新但 native 未同步` | main 有新提交，native 侧没跟上 | `npm run sync:web` 同步；共享文件人工合并后 `npm run check:update` |
| `native 侧被改动了但未登记` | 改了共享文件没重登记 | `npm run check:update` |
| 隐私清单 job 失败 | `PrivacyInfo.xcprivacy` 丢了/没进 Xcode 工程/声明了收集数据 | 检查 `ios/App/App/PrivacyInfo.xcprivacy` 与 `project.pbxproj` |

---

## 7. 故障排查：push 失败的四种典型情况

### 7.1 `Permission to fengyong/tanji.git denied to <某人>`

说明你用的是**那个人的 SSH 身份**（这台机器默认 `git@github.com` 是 `drax-ola`）。

```bash
ssh -T git@github-fengyong              # 看它回显的是谁，应该是 fengyong
git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/<分支>
```

不要去改 remote、不要换 HTTPS、不要动 `~/.gitconfig` —— 用别名地址即可。

### 7.2 `Recv failure: Operation timed out` / `Failed to connect to github.com port 443`

HTTPS 到 `github.com` 在这类网络下不通（`curl -I https://github.com` 会超时，
但 `ssh -T git@github.com` 是通的）。

```bash
# 判断：SSH 通、HTTPS 不通 → 一律走 SSH，别折腾 HTTP/1.1 或代理
ssh -T git@github-fengyong
```

换成 SSH 别名地址即可，不需要设置代理。

### 7.3 `HTTP2 framing layer` 之类

同 7.2，本质是 HTTPS 链路问题。改为 SSH 别名地址。不要靠
`-c http.version=HTTP/1.1` 硬顶，那只是偶尔能绕过，不稳定。

### 7.4 `! [rejected] ... (non-fast-forward)`

远程有你没有的提交。

```bash
git fetch git@github-fengyong:fengyong/tanji.git <分支>:refs/remotes/origin/<分支>
git rebase origin/<分支>
git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/<分支>
```

**永远不要用 `--force` 去碾压**（见第 8 节）。

---

## 8. 禁止事项

- ❌ **提交标题不带 agent/模型前缀**（第 0 节规则一）。这是硬要求，不是建议。
- ❌ **用 `drax-ola` 或其他身份推送**（第 0 节规则二）。规范身份只有 `fengyong`。
- ❌ `git push --force` / `--force-with-lease` 到任何共享分支（`main`、`native-app`）。
  force push 会改写别人已拉取的历史，还会让依赖提交事件触发的 CI 彻底失效。
- ❌ `git commit --amend` 一个**已经推送过**的提交（等于改写历史）。
  要修正就新开一个提交。
- ❌ `git merge <其他分支>` 合入别人的代码，用 `rebase`。
- ❌ 修改 `~/.gitconfig`（尤其是 `insteadOf` 那类全局改写）来解决单人 push 问题。
  别名地址是标准解法。
- ❌ `git add -A` 在多人/多 agent 共享的 worktree 里一把梭 —— 会把别人的在制品文件吞进提交。
  用显式路径。
- ❌ 把本机绝对路径、私有备份、真实账目数据提交进仓库。

---

## 9. 快速对照表

| 我想…… | 命令 |
|---|---|
| 提交（带 agent 前缀） | `git commit -m "mimocode/M31.1-flash feat(native): 一句话说清做了什么"` |
| 推当前分支 | `git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/<分支>` |
| 拉最新基线 | `git fetch git@github-fengyong:fengyong/tanji.git native-app:refs/remotes/origin/native-app` |
| 把基线接进来 | `git rebase origin/native-app` |
| 提交前自检 | `npm test && npm run check` |
| 改了共享文件 | `npm run check:update` |
| 改了插件桥源码 | `npm run build:plugins` |
| 改完要跑模拟器 | `npm run sync && npm run build:ios` |
| 开 PR | `https://github.com/fengyong/tanji/pull/new/<分支>`（base 选对） |
| 确认推送身份 | `ssh -T git@github-fengyong` → 期望 `Hi fengyong!` |

---

## 10. 项目必读文档

| 文档 | 什么时候读 |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | **任何改动开始前**。两条硬规则、仓库结构、常用命令、同步方向 |
| [`docs/git-push-guide.md`](git-push-guide.md)（本文） | 准备提交与推送时 |
| [`docs/native-app-notes.md`](native-app-notes.md) | 动原生持久化 / 通知 / 导出之前，看技术决策与踩坑记录 |
| [`docs/creator-workflow-review.md`](creator-workflow-review.md) | 做产品取舍前，达人真实工作流与缺口优先级 |
| [`docs/appstore-release-checklist.md`](appstore-release-checklist.md) | 上架前逐条对账 |
| `main` 分支的 [`AGENTS.md`](https://github.com/fengyong/tanji/blob/main/AGENTS.md) / [`docs/git-push-guide.md`](https://github.com/fengyong/tanji/blob/main/docs/git-push-guide.md) | 改 Web / PWA 侧时看，那边是同一套硬规则的精简版 |
