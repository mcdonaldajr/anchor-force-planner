#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/anchor-force-planner"

mkdir -p "$LOG_DIR"
exec >>"${LOG_DIR}/desktop-launcher.log" 2>&1

echo "$(date "+%Y-%m-%dT%H:%M:%S%z") desktop launcher invoked"
echo "APP_DIR=${APP_DIR}"
echo "PATH=${PATH}"

exec "${APP_DIR}/scripts/start-lubuntu.sh" --desktop
