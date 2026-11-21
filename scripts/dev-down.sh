#!/usr/bin/env bash
# 停止开发环境(数据卷保留;加 --purge-data 才删除数据库数据)
set -euo pipefail
cd "$(dirname "$0")/../infra"
if [ "${1:-}" = "--purge-data" ]; then
  echo "==> 停止并删除数据卷(开发数据将被清空) ..."
  docker compose --profile dev down -v
else
  echo "==> 停止服务(数据卷保留) ..."
  docker compose --profile dev down
fi
echo "完成"
