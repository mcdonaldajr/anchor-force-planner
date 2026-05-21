#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

cd "$(dirname "$0")/.."

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-4184}"
APP_URL="http://127.0.0.1:${PORT}"
LOG_DIR="${HOME}/Library/Logs/Anchor Force Planner"
LOG_FILE="${LOG_DIR}/server.log"
DESKTOP_MODE=0

if [[ "${1:-}" == "--desktop" ]]; then
  DESKTOP_MODE=1
fi

expected_version() {
  node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); process.stdout.write(pkg.version || '');"
}

server_is_running() {
  node -e "const http=require('http');const req=http.get('${APP_URL}',res=>{res.resume();process.exit(res.statusCode<500?0:1)});req.on('error',()=>process.exit(1));req.setTimeout(1000,()=>{req.destroy();process.exit(1)});" >/dev/null 2>&1
}

server_is_current() {
  local version
  version="$(expected_version)"
  node -e "const http=require('http');const expected='${version}';const req=http.get('${APP_URL}/api/version',res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>{try{const data=JSON.parse(body);process.exit(data.serverVersion===expected?0:1)}catch{process.exit(1)}})});req.on('error',()=>process.exit(1));req.setTimeout(1000,()=>{req.destroy();process.exit(1)});" >/dev/null 2>&1
}

stop_running_server() {
  node -e "const http=require('http');const req=http.request('${APP_URL}/api/stop',{method:'POST'},res=>{res.resume();res.on('end',()=>process.exit(0))});req.on('error',()=>process.exit(0));req.setTimeout(1000,()=>{req.destroy();process.exit(0)});req.end();" >/dev/null 2>&1 || true
}

open_browser() {
  open "${APP_URL}" >/dev/null 2>&1
}

start_background_server() {
  mkdir -p "$LOG_DIR"
  nohup npm start >>"$LOG_FILE" 2>&1 &
}

if [[ "$DESKTOP_MODE" -eq 1 ]]; then
  if server_is_running && ! server_is_current; then
    stop_running_server
    sleep 0.5
  fi

  if ! server_is_running; then
    start_background_server
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
echo "Log file when launched from Desktop: ${LOG_FILE}"
npm start
