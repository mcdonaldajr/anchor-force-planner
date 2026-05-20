#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-4184}"

echo "Starting Anchor Force Planner on port ${PORT}"
echo "Local URL: http://127.0.0.1:${PORT}"

if command -v hostname >/dev/null 2>&1; then
  for ip in $(hostname -I 2>/dev/null || true); do
    case "$ip" in
      127.*|"") ;;
      *) echo "iPad/LAN URL: http://${ip}:${PORT}" ;;
    esac
  done
fi

npm start
