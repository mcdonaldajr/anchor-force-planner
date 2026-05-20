#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-4184}"
APP_URL="http://127.0.0.1:${PORT}"
LOG_FILE="${XDG_STATE_HOME:-${HOME}/.local/state}/anchor-force-planner/server.log"
DESKTOP_MODE=0

if [[ "${1:-}" == "--desktop" ]]; then
  DESKTOP_MODE=1
fi

server_is_running() {
  node -e "const http=require('http');const req=http.get('${APP_URL}',res=>{res.resume();process.exit(res.statusCode<500?0:1)});req.on('error',()=>process.exit(1));req.setTimeout(1000,()=>{req.destroy();process.exit(1)});" >/dev/null 2>&1
}

open_browser() {
  if command -v firefox >/dev/null 2>&1; then
    firefox "${APP_URL}" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${APP_URL}" >/dev/null 2>&1 &
  else
    echo "Open ${APP_URL} in Firefox."
  fi
}

if [[ "$DESKTOP_MODE" -eq 1 ]]; then
  mkdir -p "$(dirname "$LOG_FILE")"
  if ! server_is_running; then
    npm start >>"$LOG_FILE" 2>&1 &
  fi

  for _ in {1..40}; do
    if server_is_running; then
      open_browser
      exit 0
    fi
    sleep 0.25
  done

  open_browser
  exit 0
fi

echo "Starting Anchor Force Planner on port ${PORT}"
echo "Local URL: ${APP_URL}"

if command -v hostname >/dev/null 2>&1; then
  for ip in $(hostname -I 2>/dev/null || true); do
    case "$ip" in
      127.*|"") ;;
      *) echo "iPad/LAN URL: http://${ip}:${PORT}" ;;
    esac
  done
fi

npm start
