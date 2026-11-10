#!/usr/bin/env bash
# OAW 測試版:啟動手機網頁,並印出 Web Preview 網址
set -euo pipefail
OAW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OAW_PORT="${OAW_PORT:-8080}"
export OAW_PORT

if (echo >"/dev/tcp/127.0.0.1/${OAW_PORT}") 2>/dev/null; then
  echo "[oaw] port ${OAW_PORT} 已被占用,先結束舊的再跑:pkill -f oaw_server.py"
  exit 1
fi

python3 "${OAW_DIR}/oaw_server.py" &
OAW_PID=$!
trap 'kill ${OAW_PID} 2>/dev/null || true' EXIT
sleep 1

echo ""
echo "======================================"
if command -v cloudshell >/dev/null 2>&1; then
  OAW_URL="$(cloudshell get-web-preview-url -p "${OAW_PORT}" 2>/dev/null || true)"
  if [ -n "${OAW_URL}" ]; then
    echo " 點這個網址開啟:"
    echo " ${OAW_URL}"
  else
    echo " 點右上角「網頁預覽」→「在通訊埠 ${OAW_PORT} 上預覽」"
  fi
else
  echo " 本機測試:http://127.0.0.1:${OAW_PORT}/"
fi
echo "======================================"
wait "${OAW_PID}"
