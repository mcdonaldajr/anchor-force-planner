#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

cd "$(dirname "$0")/.."

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-4184}"
APP_URL="http://127.0.0.1:${PORT}"
APP_VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));process.stdout.write(p.version || '');" 2>/dev/null || true)"
LOG_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/anchor-force-planner"
LOG_FILE="${LOG_DIR}/server.log"
LAUNCH_LOG="${LOG_DIR}/launcher.log"
DESKTOP_MODE=0

if [[ "${1:-}" == "--desktop" ]]; then
  DESKTOP_MODE=1
fi

server_is_running() {
  node -e "const http=require('http');const req=http.get('${APP_URL}',res=>{res.resume();process.exit(res.statusCode<500?0:1)});req.on('error',()=>process.exit(1));req.setTimeout(1000,()=>{req.destroy();process.exit(1)});" >/dev/null 2>&1
}

server_is_current() {
  [[ -n "$APP_VERSION" ]] || return 1
  EXPECTED_VERSION="$APP_VERSION" node -e "const http=require('http');const expected=process.env.EXPECTED_VERSION;const req=http.get('${APP_URL}/api/version',res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>{try{const data=JSON.parse(body);process.exit(data.serverVersion===expected?0:1)}catch{process.exit(1)}})});req.on('error',()=>process.exit(1));req.setTimeout(1000,()=>{req.destroy();process.exit(1)});" >/dev/null 2>&1
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

timestamp() {
  date "+%Y-%m-%dT%H:%M:%S%z"
}

if [[ "$DESKTOP_MODE" -eq 1 ]]; then
  mkdir -p "$LOG_DIR"
  exec >>"$LAUNCH_LOG" 2>&1
  echo "$(timestamp) launching Anchor Force Planner ${APP_VERSION:-unknown} on ${APP_URL}"

  if server_is_running && ! server_is_current; then
    echo "$(timestamp) stopping stale server before launch"
    stop_running_server
    sleep 0.5
  fi

  if ! server_is_running; then
    echo "$(timestamp) starting server"
    if command -v setsid >/dev/null 2>&1; then
      setsid npm start >>"$LOG_FILE" 2>&1 </dev/null &
    else
      nohup npm start >>"$LOG_FILE" 2>&1 </dev/null &
    fi
  else
    echo "$(timestamp) server already running"
  fi

  for _ in {1..40}; do
    if server_is_running; then
      echo "$(timestamp) server ready, opening browser"
      open_browser
      exit 0
    fi
    sleep 0.25
  done

  open_browser
  echo "$(timestamp) browser opened before server readiness check succeeded"
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
