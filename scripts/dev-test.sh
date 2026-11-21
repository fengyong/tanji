#!/usr/bin/env bash
# 对着 Docker 化的 MySQL 跑后端集成测试(真实数据库,非 mock)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${GO_BIN:-$HOME/tools/go/bin}:$PATH"
export GOPATH="${GOPATH:-$HOME/tools/gopath}"
export GOTOOLCHAIN=local
export TANJI_TEST_MYSQL_HOST="${TANJI_TEST_MYSQL_HOST:-127.0.0.1}"
export TANJI_TEST_MYSQL_PORT="${TANJI_TEST_MYSQL_PORT:-33306}"
export TANJI_TEST_MYSQL_USER="${TANJI_TEST_MYSQL_USER:-root}"
export TANJI_TEST_MYSQL_PASS="${TANJI_TEST_MYSQL_PASS:-tanji_root_dev}"
cd "$ROOT/backend/tests"
echo "==> go test(真实 MySQL $TANJI_TEST_MYSQL_HOST:$TANJI_TEST_MYSQL_PORT) ..."
go test ./... -count=1 "$@"
