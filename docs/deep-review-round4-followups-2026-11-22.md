# 第四轮深度 review · 补充修复说明(供 review 核实)

> 2026-11-22 · zcode/glm-5.3 · 基于 `be7b611`,与 codebuddy 的五处 syncDaily 补排
> (`2cf5373`,见研发笔记上一节)同轮独立产出,rebase 合并后一并验证(124/124)。
> 本轮为独立评审:未参考第三轮结论,每条都回到代码阅读与本机实跑。

## 修复清单

### P2 演示数据排真通知,切回工作模式后永久驻留

- **根因**:`switchMode` 只重排新模式的通知;演示种子里有 41 天逾期的私收单(id13)
  与当日拍摄单(id2)。进过一次演示模式 → 排上每日 09:00 假催收(id 500001,
  repeats:true)与 24h 假出片提醒(id 800002);切回 work 后没有任何入口能撤掉
  (toggle/syncDaily/syncDeliver 都只认当前模式 base=0)。
- **修复**:`storage.js` 三个排程入口(`syncDaily/syncDeliver/scheduleSnooze`)在
  `Store.mode==='demo'` 时直接 return;`index.html` 启动序列补 `Notify.cancelMode('demo')`
  清理旧版本遗留的演示通知。work 的通知全程不受影响。
- **核实**:`tests/native-reliability.test.cjs`「演示数据不排系统通知…」——切 demo 断言
  无任何 ≥500000 的通知、demo 内直接调排程接口也不排、切回 work 通知仍在、
  `cancelMode('demo')` 清遗留不误伤 work 段。变异验证:去掉 syncDeliver 守卫该测试变红。

### P3 清空数据连账号与服务商预设一起清

- **根因**:clear-data 载荷只带 orders/payments/threshold,`validateState` 对缺失的
  accounts/providers 归一为空数组;确认文案只说"订单与流水会清空"。
- **修复**:清空时保留 `accounts/providers/notifyEnabled`(与既有 notifyEnabled 保留
  同口径),确认框与统计页菜单文案如实。
- **核实**:测试走真实点击路径,断言订单/流水清空、账号与两个预设保留、
  替换前备份(`Store.backup`)仍是完整旧数据。

### P3 里程碑"清除"无级联,残留"未拍摄已发布"时间线

- **根因**:`mark()` 的 `MILE_PRE` 守卫只挡正向标记;清除路径直接置 null,清掉上游
  节点后下游时间仍挂着。
- **修复**:新增 `MILE_ORDER` 全序,清除上游节点时其后的下游记录一并清掉(截断),
  确认框列出将被一并清除的节点。
- **核实**:测试覆盖"清拍摄→五节点全清"与"清提审→拍摄保留、其后清掉"两个方向。

### P3 只读(blocked)模式下随手拍假成功

- **根因**:`shot-pick` 在 blocked 白名单里能打开相册,但 `initShotInput` 的 change
  处理器不经过 data-act 守卫——改内存、报"已随手拍"成功提示,而 `save()` 已被拦。
- **修复**:处理器开头判 `Store.blocked` 提前退出并提示;`tests/wiring.test.cjs`
  静态钉住(守卫必须出现在 photoThumb 写入之前)。

### 死代码清理

- 删 `Notify.cancelAll` 与 `isOurNotifyId`:`replaceData` 改用 `cancelMode` 后已无调用方;
  "撤双模式全部通知"的语义留在代码里,迟早被误接回某个单模式动作(重演通知误杀)。

## 明确未修项

| 项 | 原因 | 归属 |
|---|---|---|
| 隐私政策/支持页线上 404 | `https://tanji-app-guvc.zai.site/privacy.html` 实测 Not Found;原生端这两处是唯一入口 | 站点部署事务(main),App Store 审核硬阻断 |
| sw.js 缓存策略 | VERSION 停在 `tanji-v0.4.1`;logic/geo/imaging/cap-plugins 不在 ASSETS 且命中缓存后永不重验,PWA 老用户可能长期跑旧 logic.js | main 分支(需与 native 同步改,bump VERSION) |
| `validateState` 拒 id≥100000 对存量数据的影响 | 读路径也走 validateState;现实达不到该量级,新建已有硬拦,记录在案 | 接受现状 |

## 验证

| 检查项 | 结果 |
|---|---|
| `npm test` | **124/124**(117 + codebuddy 4 + 本轮净增 3;demo 守卫变异验证过杀伤力) |
| `npm run test:smoke` | 20 项,`consoleErrors: []` |
| `npm run check` | 无漂移(锁按合并后 index.html/storage.js 重登记) |
