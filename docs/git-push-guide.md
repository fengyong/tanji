# 探记 HG 提交与推送指南

> 适用分支：`tanji-native-hg`。最后核对：2026-11-27。
> 目标：让每次提交可追踪、可验证，推送不串账号、不改写历史。

## 0. 两条硬规则

完整约束见 [`AGENTS.md`](../AGENTS.md)。

### 规则一 · 提交标题必须以 agent / 模型前缀开头

```text
<agent名称>/<模型名称> <类型>(<作用域>): <一句话摘要>
```

- 前缀在标题行**开头**，不能放到类型后面。
- 当前 Qoder 会话使用 `qoder/undisclosed`，不披露底层模型。
- 正文讲为什么、验收结果与未实测项，不受前缀约束。

```text
qoder/undisclosed feat(hg): 完成独立 UI 与原生 Liquid Glass 底栏
```

### 规则二 · 推送一律用 `fengyong` 账号

```bash
git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/<分支>
```

- `origin` 的 SSH 身份是 `drax-ola`，对 `fengyong/tanji` 无写权限。
- 本机 `insteadOf` 会把 HTTPS 改写成 SSH；不要靠改 remote 或换 HTTPS 解决。
- `~/.ssh/config` 已配置 `Host github-fengyong`；用 `ssh -T git@github-fengyong` 校验，应回 `Hi fengyong!`。
- 不要修改该别名，不要 force push。

## 1. 分支模型

| 分支 | 作用 | HG 会话能否修改 |
|---|---|---|
| `main` | 原 TanJi Web / PWA 版 | 否 |
| `native-app` | 原 TanJi iOS 版，HG 历史基线 | 否 |
| `tanji-native-hg` | 探记 HG 独立发展线 | 是 |
| `fix/*` `feat/*` | 从 HG 切出的短分支 | 是 |

- HG 不反向修改原 TanJi App，不把 HG 改动合回 `main` / `native-app`。
- 不要跨分支 merge；需要别人的 HG 改动用 `rebase`。
- 不要修改工作区中并行的 `../tanji-native` 目录，该目录有并行会话在制品。
- force push、merge、上架、删除旧 App 数据都需要用户单独明确授权。

## 2. 首次配置

```bash
ssh -T git@github-fengyong     # 必须回 Hi fengyong!
git remote -v                  # 确认仓库是 fengyong/tanji
git status --short --branch
```

换机器时，由维护者配置专属 SSH key 与 `Host github-fengyong` 别名；不要修改全局 Git 配置来绕过身份问题。

## 3. 标准提交流程

```bash
# 1. 从 HG 最新基线切短分支
git fetch git@github-fengyong:fengyong/tanji.git tanji-native-hg:refs/remotes/origin/tanji-native-hg
git switch -c feat/my-change origin/tanji-native-hg

# 2. 改代码 → 验证 → 显式路径暂存
git status --short
git add <明确的文件路径>
git diff --cached --check
git diff --cached --stat

# 3. 新提交，不 amend 已发布历史
git commit -m "qoder/undisclosed feat(hg): 一句话说清做了什么" \
  -m "为什么改；验收结果；真机未测项"

# 4. 普通推送
git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/feat/my-change
```

需要接收别人的 HG 提交时：

```bash
git fetch git@github-fengyong:fengyong/tanji.git tanji-native-hg:refs/remotes/origin/tanji-native-hg
git rebase origin/tanji-native-hg
# 解决冲突后 git add + git rebase --continue，再普通 push
```

不要用 `--force` 处理分叉；先核实远端分支、待推 commit 和是否存在内容损失风险，再把非破坏选项交给用户决定。

## 4. 提交前验证

```bash
npm test          # 186 项回归
npm run test:smoke # 320×568、390×844、1280×900
npm run check     # www/app.js、www/cap-plugins.js 与源码一致
npm run build:ios # 改到原生/Web 构建链时跑
```

| 改了什么 | 额外动作 |
|---|---|
| `src/app/` | `npm run build:app` |
| `src/cap-plugins.js` | `npm run build:plugins` |
| `www/` | `npm run sync` 后再做真机/模拟器验证 |
| 原生功能 | `npm run build:ios` + 模拟器实跑；真机项明确标注未测 |
| `docs/`、`README.md`、`AGENTS.md` | 核对状态、链接、版本与未实测项 |
| `watchdog/PROGRESS.json` | 可提交；heartbeat/log/review 等运行时文件不提交 |

HG 已独立重做 UI 与交互，不再执行 main/native 漂移锁。不要用 `npm run check:update` 把 HG 锁回原 TanJi App。

## 5. 暂存与敏感信息

- 禁止 `git add -A` / `git add .`；使用显式路径。
- 提交前检查 `git status --short`、`git diff --check`、`git diff --stat`。
- 不提交 Team ID、UDID、私钥、真实账目数据、本机绝对路径、`.env` 或凭据。
- 不提交 `ios/App/App/public/`、`build/`、`node_modules/`、`watchdog/review/`。
- `project.pbxproj` 如被 Xcode 写入本机 `DEVELOPMENT_TEAM`，先清理再提交。

## 6. CI 触发条件

| 事件 | Web 回归 | Native 回归 | 隐私清单 | main/native 漂移锁 |
|---|---|---|---|---|
| push `main` | ✅ | — | — | — |
| push `native-app` | ✅ | ✅ | ✅ | ✅ |
| push `tanji-native-hg` | ✅ | ✅ | ✅ | — |
| PR 目标 `tanji-native-hg` | ✅ | ✅ | ✅ | — |

HG 只校验 JS 构建产物与源码一致，不把有意独立演进误判成漏同步。

## 7. 常见推送问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `Permission to fengyong/tanji.git denied` | SSH 身份不对 | 用 `github-fengyong` 别名地址，不换 HTTPS |
| HTTPS 超时 | 当前网络 HTTPS 不通 | 使用 SSH 别名 |
| `non-fast-forward` | 远端有新提交 | fetch + rebase 后普通 push；不 force |
| CI 红在构建产物 | 改了源码忘重建 | 跑对应 build 脚本并提交产物 |
| CI 红在隐私清单 | 文件缺失/未登记/声明收集 | 核对 `PrivacyInfo.xcprivacy` 与 Xcode 工程 |

## 8. 禁止事项

- ❌ 标题不带 agent / 模型前缀。
- ❌ 用 `drax-ola` 或其他身份推送。
- ❌ `git push --force` / `--force-with-lease` 未经单独授权。
- ❌ amend 已推送提交、跨分支 merge、修改 `main` / `native-app`。
- ❌ `git add -A` 一把梭、提交本机标识或真实业务数据。
- ❌ 把自动化测试通过写成真机验收通过。

## 9. 快速对照

| 我想…… | 命令 |
|---|---|
| 看当前改动 | `git status --short --branch` |
| 提交前自检 | `npm test && npm run test:smoke && npm run check` |
| 重建 App 产物 | `npm run build:app` |
| 同步到 iOS | `npm run sync` |
| 推 HG 短分支 | `git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/<分支>` |
| 确认身份 | `ssh -T git@github-fengyong` |
| 恢复 watchdog | `./scripts/watchdog.sh resume` |
