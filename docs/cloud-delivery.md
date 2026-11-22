# 探记 TanJi 云端版 · 交付说明

- 日期：2026-11-22
- 分支：`feat/cloud-local-first`（已推送 origin）
- 状态：M0–M4 交付并通过三轮 review；M5 原生与 M6 生产发布按下述边界执行

## 1. 实际 worktree 路径与分支

- 主仓库：`/Users/fengyong/drax-glm/tanji`（分支 `main`，未改动）
- **开发 worktree：`/Users/fengyong/drax-glm/tanji-cloud`，分支 `feat/cloud-local-first`**
- 其余 worktree（tanji-lab / tanji-native / tanji-reliability）未触碰

## 2. 已实现功能与未完成部分

### 已实现（均有自动化测试或浏览器实测证据）

**账号（M2）**
- 邮箱注册 + 验证码激活（Argon2id 密码哈希，PHC 格式）；登录/登出
- 验证码：SHA-256 落库、10 分钟有效、单次消费、5 次尝试上限（持久化，重启不清零）、60s 重发冷却
- **单有效会话**：新登录原子替换旧会话（写路径每操作锁 users 行重验），旧设备任意请求 401
- 密码找回/重置（重置推进 auth_epoch 并撤销全部会话）；账号停用（再次认证、撤销发出的全部共享）
- 登录/注册响应不泄露邮箱是否注册（统一文案 + 恒定耗时路径）

**同步（M3，Binlog 思想的业务级变更日志）**
- 操作信封：op_id 不可变、payload 哈希幂等（重试 100 次恰好一次业务效果）、同 ID 异内容拒绝
- 版本条件：expected_version 与 after_op_id 二选一；requires_success 依赖（区分 pending/failed）
- 结果：applied/already_applied/conflict/rejected/dependency_pending；冲突携带云端当前内容
- 删除墓碑：entity_tombstones 阻止同 ID 复活；旧设备迟到修改进入冲突处理不静默丢弃
- 用户流：user_stream_heads 按 recipient 排序锁行 + 逐操作分配 seq；pull 游标绑定 account/epoch，世代变化返回 410 触发全量重建
- bootstrap：单一致性快照物化（数据+流头+待核对回执同切点）、条目粒度分页、10 分钟过期、绑定账号/会话

**协作（M4）**
- 联系邀请（一次性凭据，72h，不可枚举）→ 接受建立带代次的关系；同名不自动绑定
- 按订单授权（partner/viewer）；**白名单投影**（店名/时间/时区/地址/坐标/取消状态/关系代次）——接口、事件、快照、本地表、通知全走同一 DTO，金额/流水/渠道/备注/联系人不存在于任何下发路径（E2E 实测断言）
- 撤销 → purge（仅 share_id/generation）；历史事件页拉取时实时复核授权，失效内容降级为 purge（AC12）
- 改期更新同一投影（revision+1，纯财务变更不发接收者事件）；重新授权 generation+1，迟到 purge 不误删新代次
- 删除联系使该代次授权全部失效并通知双方；重新接受是新代次
- SSE 仅提示 changes_available；存活期 20s 复核会话，失效即断开

**本地优先（M1）**
- Vue3 + TS + Vite，保留原五页布局与交互习惯（首页/行程/订单/统计/我的 + 共享页）
- SQLite WASM（官方 3.54.1）+ Dedicated Worker + opfs VFS；**持久化自检失败即拒绝写入**，绝不静默退化为内存/localStorage（AC16）
- 每账号/演示独立 OPFS 数据库；业务修改与 outbox 同一 SQLite 事务（AC01）
- 下行应用是 replication apply：不覆盖未同步修改，按链重放本地意图并重锚定版本条件（AC04）
- 同步引擎：本地事务成功即唤醒；重连流程核验会话→不确定回执→拉取→上传→再拉取；指数退避+抖动上限 60s；重新联网触发（PRD FR-04）
- 会话失效：停止上传、队列隔离（quarantined）、锁屏，重新登录后按回执对账恢复（AC06/AC07）
- 冲突页：展示本地意图与云端内容，可"采用云端"或"以云端版本重建更正"（新 op_id，不复用旧链）
- 旧数据迁移：JSON 备份解析/预览（金额分转换、时间按所选时区、搭档→外部、异常清单）→ 导入（migration_map 幂等，重复导入不重复入账，AC15）
- PWA：SW 白名单预缓存（绝不缓存 /v1/*/health/events），HTML network-first

**验收场景覆盖**：AC01✅(E2E+单元) AC02✅ AC03✅ AC04✅ AC05✅(事务原子) AC06✅ AC07✅(适配器层) AC08✅ AC09✅ AC10✅ AC11✅ AC12✅ AC13✅ AC14✅ AC15✅ AC16✅ AC17✅(手填地址不依赖地图) AC18 部分(epoch/会话/授权冻结已实现,备份演练未执行)

### 未完成部分

- **M5 原生（iOS）**：本机无 Xcode（仅有 CLT 且本会话中系统丢失了 CLT 注册）。未做 Capacitor 接入，未做任何"原生已验证"声明。业务/同步内核为 TS 包，接入面已预留（local-db 适配器接口）。
- **M6 生产发布**：域名/TLS、真实邮件服务、部署区域、MySQL 备份+Binlog PITR 演练（AC18 完整）、性能基准（PRD §7 的 10k 单基准）未执行——这些需要外部资源与授权。
- 指定日期分享图（旧版 canvas 功能）：未迁移到云端版（属保留项，非同步核心）。
- 邮件发送：生产 SMTP 未配置；开发用 Mailpit，且 DEV 模式验证码直接回显（仅 TANJI_DEV=1 时）。

## 3. 启动、构建与测试命令

```bash
# Docker 环境(推荐,任何机器)
./scripts/dev-up.sh --with-web          # mysql+mailpit+后端(自动迁移)+web
# 手工(非 Docker,本机实际使用的方式)
# 后端: 见下"数据库初始化"后运行
cd backend && go build -o /tmp/tanji-server ./cmd/server
TANJI_DEV=1 /tmp/tanji-server -addr 127.0.0.1:8080 -db-host 127.0.0.1 -db-port 33306

# 前端构建(生成 dist + sw.js 预缓存)
cd apps/web && npm run build
# 构建产物验收服务(COOP/COEP + /v1 代理)
node scripts/serve-dist.mjs 5273 http://127.0.0.1:8080
# 或开发服务器
npx vite --port 5173 --host 127.0.0.1

# 测试
./scripts/dev-test.sh                                  # 后端集成测试(真实 MySQL)
cd backend/tests && go test ./... -count=1             # 同上
cd packages/local-db && npx vitest run --no-cache      # 本地内核(真实 SQLite)
cd packages/domain && npx vitest run --no-cache        # 领域规则(含与 Go 的 UUIDv5 一致性)
# OPFS 冒烟(需 vite/dist 服务在 5173 或 5273)
cd apps/web && node tests/opfs-smoke.cjs
# E2E 全流程(需 MySQL+后端+dist 服务 5273)
cd apps/web && node tests/e2e-flow.cjs
```

工具链（本机无 Docker/CLT 时的实际路径）：`~/tools/go/bin`(1.27.4)、`~/tools/node22/bin`、`~/tools/mysql84`(8.4.11, 端口 33306)。CLT 缺失时用 `tools/gitlite`（go-git 实现）提交/推送。

## 4. 数据库初始化、迁移与开发账号验证

```bash
# MySQL 初始化(一次性)
~/tools/mysql84/bin/mysqld --initialize-insecure --datadir=$HOME/tools/mysql84-data/data --basedir=$HOME/tools/mysql84
~/tools/mysql84/bin/mysqld --datadir=$HOME/tools/mysql84-data/data --basedir=$HOME/tools/mysql84 \
  --port=33306 --socket=/tmp/tanji-mysql.sock --bind-address=127.0.0.1 --mysqlx=OFF
~/tools/mysql84/bin/mysql -h 127.0.0.1 -P 33306 -u root -e "CREATE DATABASE IF NOT EXISTS tanji CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; CREATE USER IF NOT EXISTS 'tanji_app'@'%' IDENTIFIED BY 'tanji_app_dev'; GRANT ALL PRIVILEGES ON tanji.* TO 'tanji_app'@'%'; FLUSH PRIVILEGES;"
```

- 迁移：goose，启动时自动执行 `backend/migrations/0001_init.sql`（20 张表）；失败不启动、不清库。独立迁移入口：`go run ./backend/cmd/migrate`。
- 开发账号验证方式：`TANJI_DEV=1` 时注册/找回响应直接携带 `dev_code`（生产模式绝不返回）；邮件走 Mailpit(1025/UI 8025)，未配置时降级日志输出并标注 DEV-ONLY。
- 测试数据库：集成测试自动创建 `tanji_test_*` 库并在结束后删除，不触碰 `tanji` 开发库。

## 5. 已执行测试、实际结果及未验证平台

| 套件 | 数量 | 结果 |
| --- | --- | --- |
| 后端集成（真实 MySQL：单会话/幂等/版本链/收款规则/墓碑/并发/游标/共享/白名单/撤销/代次/联系删除/停用/回执/世代过期/bootstrap 分页） | 24 | ✅ 全绿 |
| 本地内核（真实 SQLite：AC01/AC03/AC04/AC13/代次purge/AC14/AC15/收款规则） | 9 | ✅ 全绿 |
| 领域规则（金额/时区/UUIDv5 与 Go 一致/旧备份迁移） | 14 | ✅ 全绿 |
| OPFS 冒烟（Chrome 真机路径：写入读回/杀页持久化/失败保全） | 3 | ✅ 全绿 |
| E2E（构建版+SW：E1–E10 主流程） | 10 阶段 | ✅ 全绿 |
| `go vet` | — | ✅ 无告警 |

**未验证平台**：iOS/Capacitor 真机（无 Xcode）；Safari/iOS 的 OPFS 表现；Windows/Android。PRD §7 性能基准未测量（当前实测：opfs 经典 VFS 单命令 100–200ms，sahpool 30–50ms，已记录优化候选）。

## 6. 与原设计不同的决策及理由

1. **本机工具链**：无 Docker、brew 损坏 → 便携版 Go/MySQL + Compose 文件交付（`infra/`，Docker 机可用）。记为环境偏离，非架构偏离。
2. **opfs VFS 配套**：官方代理文件 `sqlite3-opfs-async-proxy.js` 必须与 sqlite3.mjs 同目录分发、worker URL 需带 `?sqlite3.dir`、打开必须用对象参数——实测后固化于代码与构建脚本。
3. **SW 缓存键**：实测发现按 pathname 归一化会丢失 opfs 代理 worker 的 `?vfs=opfs` 参数 → 缓存键改为完整 URL（比文档"路径精确白名单"更严格地保留了查询串）。
4. **CSRF 同源校验**：反向代理改写 Host → 校验采用 `X-Forwarded-Host` 兜底（生产 Caddy 同样适用）。
5. **冲突页"重试"语义**：按文档"以当前基线创建新的更正操作"实现；云端已删除的订单拒绝重试复活（引导新建/采用云端），比文档更保守。
6. **bootstrap 页复核**：文档要求"每页下载时复核授权"；实现为快照事务内即按当前有效授权物化（页与数据同切点），页下载时不重复查库。撤销后的增量 purge 通过正常拉取补发——效果等价（AC12 测试通过），记为等价实现偏差。
7. **收款金额**：沿用旧版"整笔定金/整笔尾款"规则（金额必须等于当前待收），与 PRD FR-05 第一版一致。
8. **gitlite**：本会话中 macOS 丢失 CLT 注册导致系统 git 失效 → 以 go-git 实现最小提交/推送工具（`tools/gitlite`），并如实记录 worktree 私有 refs 的迁移问题。

## 7. 外部阻塞项与上线前必须补齐的条件

1. **iOS 构建环境**：Xcode 16+ + 真机；按 `docs/native-app-notes.md` 第七节跑原生落盘验证（M5 全部）。
2. **生产邮件服务**（SMTP 或 API 凭据）+ **域名/TLS** + **部署区域**：PRD §15 发布前条件。
3. **MySQL 备份 + Binlog PITR 演练**（AC18 完整验证、RPO/RTO 实测）。
4. **性能基准**：PRD §7 的 10,000 单 / 30,000 流水 / 20 接收账号基准与真机测量。
5. **高德地图凭据**（二期原生 POI/导航）。
6. **SW 首次注册体验**：PWA 离线启动依赖 SW 缓存壳资源，首次安装需联网（已在产品内提示）。
7. **rate limit 加固**（审查建议 P2）：限流器加桶淘汰、可信代理头约定、deactivate 失败计数持久化。

## 8. 本地提交记录与工作区状态

- 分支提交链（本会话）：`3bcbffb 后端骨架` → `3064989 集成测试` → `0a78c9f 进度文档` → `dc15c9f Docker 化` → `8970cd5 共享测试` → `978e34f 共享授权测试` → `adb8090 前端内核` → `d57ae4a Vue 应用+OPFS 验收` → `739508b 端到端闭环` → `cda80a5 第一轮 review` → `bf18594 第二轮 review` → `e359cb54 gitlite 工具`（均已推送 origin）
- 工作区状态：`git status` 干净（两份设计文档已随首次提交入库，未改动）
- 未触碰：main 分支、其他 worktree、真实业务数据；未 push 其他分支
