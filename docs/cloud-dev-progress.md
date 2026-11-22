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
**M6 E2E 调试中(2026-11-22 凌晨)**: 构建版应用(SW+OPFS)上 E1-E4 已通过(注册/登录/开账本/建单/CDP离线/离线重开FR-03/AC01)。E5 卡在断言时机: 后端已确认收到数据(离线新店 v1 + E2E奶茶店 v2 均入库),说明同步闭环实际工作,只是 E5 轮询窗口内 ops 还在 'sending'→确认中。已修复的关键 bug: SW 缓存键归一化丢 query(影响 opfs proxy)、serve-dist Set-Cookie 丢失、vite worker 打包(?worker&url)、sqlite3.dir 参数、唤醒风暴(requeueSending 在 WRITE_CMDS)、CSRF X-Forwarded-Host、settings aggregate_id、请求超时、VFS 安装等待。
**下一步**: 1) E5 轮询延长至 pending==0(≤150s)并跑通 E5-E10; 2) 提交全部前端代码; 3) 按用户指示执行三轮 review→修复循环; 4) 交付说明 + push。
**M2/M3 服务端集成测试 ✅ 全绿（16 个用例, 真实 MySQL）→ 已提交 3064989 并推送 origin**

已覆盖: 单会话替换(AC06服务端)/登录不泄露注册/重复注册同文案/重置密码吊销全部会话/登出/密码策略/幂等重试100次/同ID异内容拒绝/after_op_id链+跨聚合拒绝/版本冲突携带云端内容/收款恰好一次+金额校验+撤销保留历史+撤销后重记/墓碑拒绝复活/批次独立事务/并发收款恰好一次/游标单调前进/本人事件带origin_op_id/跨账号信封403/协议409/settings阈值校验/依赖pending与failed/DTO整数分+字符串版本

**下一步（按序）**:
1. 补 sharing 集成测试(邀请→接受→授权→白名单投影→改期→撤销purge→历史页过滤→重新授权新代次→迟到purge不误删AC12) + bootstrap 测试(快照分页/epoch 变化 cursor_expired/回执同切点/越权页拒绝)
2. 进入前端: packages/domain、packages/local-db(SQLite WASM+OPFS Worker+事务仓储+outbox+server_base 重放)、packages/sync(引擎+退避)、packages/api-client、apps/web(Vue3+Vite, 保留现有五页布局)
3. M0 前端可行性: Chrome CDP 实测 OPFS 持久化(参考 tests/browser-smoke.cjs 的 CDP 写法)
4. M1→M4 推进，最后 M6 验收(浏览器 E2E: 注册→离线→同步→搭档→撤销→踢出)
5. 全部开发完成后: 三轮 review→修复→再 review→再修复→提交(用户 2026-11-22 指示)

## Docker 化(2026-11-22 用户要求)
- infra/docker-compose.yml(mysql:8.4 + mailpit + backend 自动迁移 + web profile)+ backend/Dockerfile(多阶段,非 root,healthcheck)+ scripts/dev-up.sh / dev-down.sh / dev-test.sh
- 任何机器: git clone → git switch feat/cloud-local-first → ./scripts/dev-up.sh --with-web
- **偏离记录**: 本机无 Docker(brew 损坏),compose 配置未在本机运行验证(见 docs/cloud-dev.md);本机开发用便携版 MySQL 8.4.11(~/tools/mysql84,端口 33306),测试仍为真实 MySQL
- 集成测试兼容两种环境: 环境变量 TANJI_TEST_MYSQL_* 指向 compose MySQL 或便携 MySQL

## 已知注意事项
- MySQL root 无密码(dev 实例, 仅本机 127.0.0.1:33306)；测试库 tanji_test_* 每次创建后清理
- 会话令牌是 base64url 文本(修复过原始字节破坏 cookie 的问题)
- mutation_receipts.result_payload 可能 NULL（已用 sql.NullString/[]byte 处理 error_code/payload 扫描）
- 测试 UUID 只能用 hex 字符（g-z 会 ParseID 失败）
- 服务端时间 UTC；appt 存 UTC+IANA 时区
- dev server: TANJI_DEV=1 /tmp/tanji-server -addr 127.0.0.1:8787 -db-host 127.0.0.1 -db-port 33306（dev_code 走响应）

## 看门狗日志
- 2026-11-22 06:03 首次检查: 进度文件由主会话创建；主任务正在推进测试修复，无需恢复。
