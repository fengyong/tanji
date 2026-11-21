# 探记云端版 · 开发进度跟踪（看门狗恢复用）

> 本文件由主任务会话维护；看门狗自动化(automation-7e7f1021)据此判断停滞并恢复任务。
> **任务完成标记: 未完成**（交付后改为 DELIVERED）

## 任务基线
- 指令文档: docs/cloud-prd.md + docs/cloud-architecture.md（未提交设计输入，保留）
- 工作区: /Users/fengyong/drax-glm/tanji-cloud（worktree, 分支 feat/cloud-local-first）
- 工具链: Go=$HOME/tools/go/bin(1.27.4), Node22=$HOME/tools/node22/bin, MySQL8.4.11=$HOME/tools/mysql84(端口33306, socket /tmp/tanji-mysql.sock, datadir $HOME/tools/mysql84-data)
- Git 规范: feat/fix/docs/chore: 中文提交信息；只在本 worktree 提交，不 push、不合并 main

## 已完成
- [x] M0 工具链: 便携 Go 1.27.4 + MySQL 8.4.11（macos15 构建在本机 macOS13 可运行）+ Node 22（已有）
- [x] 后端骨架: backend/（Go+chi+goose+MySQL 迁移 0001_init.sql 全部 21 张表）
- [x] 认证: Argon2id、注册/验证/登录/登出/找回/重置、单会话原子替换、验证码持久化限次
- [x] 业务操作引擎: order.create/update/reschedule/cancel/archive/delete、payment.record/reverse、partner.assign、schedule.grant/revoke、settings.update
  - 幂等回执(mutation_receipts + payload hash)、already_applied 重放规范化、版本条件(expected_version/after_op_id)、requires_success(pending/failed 区分)、墓碑(entity_tombstones)、删除不可复活
- [x] 变更流: user_stream_heads 按 recipient 排序锁行 + user_changes；pull 游标(opaque base64, 绑定账号/epoch)；失效授权过滤为 purge
- [x] bootstrap 契约(单一致性快照+分页+回执同切点)
- [x] 冒烟: curl 走通 注册→验证→登录→push create→pull 事件
- [x] 提交 3bcbffb "feat: 云端版后端骨架……"

## 当前阶段
**M2/M3 服务端集成测试**（backend/tests/, 真实 MySQL）

已写: harness_test.go(独立测试库+goose 迁移+httptest)、auth_flow_test.go(单会话替换/不泄露注册/重置吊销/登出/密码策略)、sync_ops_test.go(幂等重试100次/版本链+冲突/收款规则/墓碑/独立事务/并发恰好一次/游标单调/跨账号403/协议409/settings/依赖pending+failed/DTO形状)

**下一步（按序）**:
1. 修 3 个测试自身的 bug:
   - TestVersionChainAndConflict: "after_op_id 跨聚合" 用例引用了订单ID(0009)而非操作ID(b4)，改成 after_op_id=aaaaaaaa-0000-4000-8000-0000000000b4
   - TestPaymentRules: 重复收款用例的 precondition 用了 after_op_id c1(版本1)，此时版本已是 2，会 conflict；改为 expected_version:"2"
   - TestPushAccountMismatch: account_mismatch 检查需先于 batch 数量校验（httpapi/sync_handlers.go handlePush 中调整顺序；此前 Edit 因文件过期未落盘）
   - TestPullCursorMonotonic: 单独 probe 已证明 pull 正常，重跑确认（疑似旧构建残留）
2. `go test ./...` 全绿后提交 "test: 服务端集成测试……"
3. 补 sharing 集成测试(邀请→接受→授权→白名单→撤销→purge→重新授权新代次→迟到purge不误删) + bootstrap 测试(快照分页/epoch 变化 cursor_expired/回执同切点)
4. 进入前端: packages/domain、packages/local-db(SQLite WASM+OPFS Worker)、packages/sync、packages/api-client、apps/web(Vue3+Vite)
5. M0 前端可行性: Chrome CDP 实测 OPFS 持久化(参考 tests/browser-smoke.cjs 的 CDP 写法)
6. 之后按架构文档 M1→M4 推进，最后 M6 验收(浏览器 E2E: 注册→离线→同步→搭档→撤销→踢出)

## 已知注意事项
- MySQL root 无密码(dev 实例, 仅本机 127.0.0.1:33306)；测试库 tanji_test_* 每次创建后清理
- 会话令牌是 base64url 文本(修复过原始字节破坏 cookie 的问题)
- mutation_receipts.result_payload 可能 NULL（已用 sql.NullString/[]byte 处理 error_code/payload 扫描）
- 测试 UUID 只能用 hex 字符（g-z 会 ParseID 失败）
- 服务端时间 UTC；appt 存 UTC+IANA 时区
- dev server: TANJI_DEV=1 /tmp/tanji-server -addr 127.0.0.1:8787 -db-host 127.0.0.1 -db-port 33306（dev_code 走响应）

## 看门狗日志
- 2026-11-22 06:03 首次检查: 进度文件由主会话创建；主任务正在推进测试修复，无需恢复。
