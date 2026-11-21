# 云端版开发者指南

## 快速开始(有 Docker 的电脑,一条命令)

```bash
git clone git@github.com:fengyong/tanji.git
cd tanji
git switch feat/cloud-local-first
./scripts/dev-up.sh --with-web     # 或不加参数只起后端
```

启动内容:

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| Go 后端 | http://127.0.0.1:8080 | 启动时自动执行 goose 迁移,失败不启动 |
| MySQL 8.4 | 127.0.0.1:33306 | 库 `tanji`,账号 `tanji_app/tanji_app_dev`,root 密码 `tanji_root_dev`(仅本地开发) |
| Mailpit | http://127.0.0.1:8025 | 开发验证码邮件,SMTP `1025`;DEV 模式(`TANJI_DEV=1`)验证码也直接在注册响应里返回 |
| Web(Vite) | http://127.0.0.1:5173 | `--with-web` 启用;开发服务器带 COOP/COEP 头(OPFS 必需) |

运行后端集成测试(真实 MySQL,非 mock):

```bash
./scripts/dev-test.sh
```

停止:`./scripts/dev-down.sh`(保留数据);`./scripts/dev-down.sh --purge-data`(连数据一起删)。

## 手工构建/运行(不用 compose)

```bash
cd backend
go build -o tanji-server ./cmd/server
./tanji-server -addr 127.0.0.1:8080 -db-host 127.0.0.1 -db-port 33306 -db-name tanji \
  -db-user tanji_app -db-pass tanji_app_dev -mailpit 127.0.0.1:1025
# 独立迁移(生产约定:迁移账号与应用账号分离)
go run ./cmd/migrate -db-host ... -db-user root -db-pass ...
```

## 非 Docker 降级路径(当前开发机:macOS 13,无 Docker)

本机 brew 损坏且无 Docker,采用**便携版工具链**(均在用户目录,不属于系统级安装):

- Go: `~/tools/go/bin`(1.27.4),`export PATH=$HOME/tools/go/bin:$PATH GOPATH=$HOME/tools/gopath GOTOOLCHAIN=local`
- MySQL 8.4.11: `~/tools/mysql84`,数据目录 `~/tools/mysql84-data`,端口 33306:
  ```bash
  ~/tools/mysql84/bin/mysqld --datadir=$HOME/tools/mysql84-data/data --basedir=$HOME/tools/mysql84 \
    --port=33306 --socket=/tmp/tanji-mysql.sock --bind-address=127.0.0.1 --mysqlx=OFF
  # 首次初始化: ~/tools/mysql84/bin/mysqld --initialize-insecure --datadir=... --basedir=...
  ```
- Node 22: `~/tools/node22/bin`
- 集成测试: `cd backend/tests && TANJI_TEST_MYSQL_PORT=33306 go test ./... -count=1`

## 验证状态说明

- `infra/docker-compose.yml` 与 `backend/Dockerfile` 在**无 Docker 的开发机上未运行验证**;首次在 Docker 环境使用时如镜像 tag(`golang:1.27-alpine`、`alpine:3.20`)或卷权限有问题,按报错微调即可——组合本身遵循 compose v2 语法。
- 集成测试已在便携版真实 MySQL 8.4.11 上全绿(16 用例)。
