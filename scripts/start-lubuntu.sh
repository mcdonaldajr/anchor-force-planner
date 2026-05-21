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

server_is_current() {
  node -e "const http=require('http');const req=http.get('${APP_URL}/api/version',res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>{try{const data=JSON.parse(body);process.exit(data.serverVersion==='0.4.1'?0:1)}catch{process.exit(1)}})});req.on('error',()=>process.exit(1));req.setTimeout(1000,()=>{req.destroy();process.exit(1)});" >/dev/null 2>&1
}

stop_running_server() {
  node -e "const http=require('http');const req=http.request('${APP_URL}/api/stop',{method:'POST'},res=>{res.resume();res.on('end',()=>process.exit(0))});req.on('error',()=>process.exit(0));req.setTimeout(1000,()=>{req.destroy();process.exit(0)});req.end();" >/dev/null 2>&1 || true
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
  if server_is_running && ! server_is_current; then
    stop_running_server
    sleep 0.5
  fi

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
