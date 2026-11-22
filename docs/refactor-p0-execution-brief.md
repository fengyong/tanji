# P0 重构执行指令(致 zcode/glm-5.3)

> 任务:把 `www/index.html` 的约 1830 行内联 script 拆成 `src/app/` ESM 模块,
> esbuild 打包为 `www/app.js`,**行为逐字节不变**。
> 本指令是入口;实施细节的唯一权威是规格书。

## 第一步:按顺序读三份文档

1. `AGENTS.md`(仓库根)——两条硬规则:提交标题以 `zcode/glm-5.3` 开头;
   推送一律 `git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/<分支>`。
2. **`docs/refactor-p0-split-spec.md`(v3)——实施合同。**
   目标结构(§2)、符号归属总表(§3)、特许调整(§4)、依赖规则(§5)、
   阶段卡(§6)全部以此为准。
3. `scripts/web-sync.lock.json` + `scripts/sync-web-assets.cjs`——了解即可,
   你不要改(P0-4 由验收人做)。

## 第二步:定位分支(不可跳过)

```bash
git fetch origin
git checkout native-app
git status --short      # 必须为空;有在制品先 stash
git pull --ff-only      # 与 origin/native-app 对齐
```

- 工作分支**从 `native-app` 切**:`refactor/p0-0-safety-net`、`refactor/p0-1-split`。
- **main 分支全程不碰**(v3 已裁决:main 是零构建静态站,不是本次基线)。
- 仓库里 `fix/deep-review-round5` 分支与本任务无关,不要基于它。

## 第三步:执行范围

严格按规格书 §6 的 **P0-0 → P0-1 → P0-2 → P0-3** 执行;
**P0-4(锁文件 / sw.js / sync 脚本收口)由验收人做,你不做。**

每阶段独立提交(commit 标题前缀 `zcode/glm-5.3`)、独立全绿
(`npm test` + `npm run test:smoke`)才进下一阶段。

## 三条最重要的纪律

1. **纯搬运**:除规格书 §4 的 3 处特许签名调整外,不改任何函数体、文案、
   CSS、markup。发现"顺手能优化"的地方 → 记入 `DEVIATIONS.md`,不改。
2. **符号归属按 §3 总表逐字执行**:行号漂移时以分节注释锚点
   `/* ================= XXX ================= */` 为准;
   表里没有的新符号,归其所在分节的目标文件,不许自创文件。
3. **卡住就停**(规格书 §7):在分支根写 `DEVIATIONS.md`,
   格式 `位置 | 规格原文 | 实际冲突 | 建议处理`,然后继续做无冲突部分。
   不许猜着绕过。

## 交付前自查(四条全过再汇报)

- `npm test` 全绿;`npm run test:smoke` 通过;`npm run build:app` 零报错
- `grep -c 'function ' www/index.html` = 0
- `grep -rn 'TanjiCap' src/app/ | grep -v 'env.js'` 为空
- wiring 测试对"删掉一个注册"确实变红(验证后恢复)

## 汇报格式

```
分支:<名>
提交:<hash 列表,每条一行>
测试:npm test <通过数/总数>;smoke <通过/失败>
构建:build:app <成功/失败>
DEVIATIONS:<无 / 有,逐条摘要>
自查:上述四条逐条 ✓/✗
```

验收人按规格书 §8 的清单复核,不合格项打回或由他修正。
