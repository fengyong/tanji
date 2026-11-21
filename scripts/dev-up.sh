#!/usr/bin/env bash
# 探记云端版 · 开发环境一键启动(Docker)
# 用法: scripts/dev-up.sh [--with-web]
set -euo pipefail
cd "$(dirname "$0")/../infra"

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ 未安装 Docker。请先安装 Docker Desktop / Engine,再运行本脚本。"
  echo "   (无 Docker 的机器可用便携版 MySQL:见 docs/cloud-dev.md 的 '非 Docker 降级路径')"
  exit 1
fi

echo "==> 启动 mysql + mailpit ..."
docker compose up -d --build mysql mailpit

echo "==> 等待 MySQL 就绪 ..."
for i in $(seq 1 60); do
  if docker compose exec -T mysql mysqladmin ping -h 127.0.0.1 -utanji_app -p"${TANJI_MYSQL_APP_PASSWORD:-tanji_app_dev}" --silent >/dev/null 2>&1; then
    break
  fi
  sleep 1
  [ "$i" = 60 ] && { echo "❌ MySQL 60 秒未就绪"; exit 1; }
done

echo "==> 启动 backend(启动时自动执行 goose 迁移) ..."
docker compose up -d --build backend

echo "==> 等待 backend /health/ready ..."
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:${TANJI_BACKEND_PORT:-8080}/health/ready >/dev/null 2>&1; then
    break
  fi
  sleep 1
  [ "$i" = 60 ] && { echo "❌ backend 60 秒未就绪,查看日志: docker compose logs backend"; exit 1; }
done

if [ "${1:-}" = "--with-web" ]; then
  echo "==> 启动 web(Vite 开发服务器,含 COOP/COEP) ..."
  docker compose --profile dev up -d web
fi

cat <<EOF

✅ 开发环境就绪:
   后端 API   http://127.0.0.1:${TANJI_BACKEND_PORT:-8080}   (/health/ready)
   Mailpit    http://127.0.0.1:8025   (验证码邮件,SMTP 1025)
   MySQL      127.0.0.1:${TANJI_MYSQL_PORT:-33306}  (tanji_app / ${TANJI_MYSQL_APP_PASSWORD:-tanji_app_dev},库 tanji)
   $( [ "${1:-}" = "--with-web" ] && echo "Web        http://127.0.0.1:5173" || echo "Web        未启动(加 --with-web 或前端完成后使用)" )

集成测试: TANJI_TEST_MYSQL_HOST=127.0.0.1 TANJI_TEST_MYSQL_PORT=${TANJI_MYSQL_PORT:-33306} TANJI_TEST_MYSQL_USER=root TANJI_TEST_MYSQL_PASS=${TANJI_MYSQL_ROOT_PASSWORD:-tanji_root_dev} go test ./backend/tests/...
日志:    docker compose -f infra/docker-compose.yml logs -f backend
停止:    scripts/dev-down.sh
EOF
