#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Anchor Force Planner"
APP_ID="anchor-force-planner"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="${HOME}/Desktop"
APPLICATIONS_DIR="${HOME}/.local/share/applications"
START_DESKTOP_FILE="${APPLICATIONS_DIR}/start-${APP_ID}.desktop"
STOP_DESKTOP_FILE="${APPLICATIONS_DIR}/stop-${APP_ID}.desktop"
START_LAUNCHER="${APP_DIR}/scripts/start-server-lubuntu.sh"
STOP_LAUNCHER="${APP_DIR}/scripts/stop-server-lubuntu.sh"
UNIT_DIR="${HOME}/.config/systemd/user"
UNIT_FILE="${UNIT_DIR}/${APP_ID}.service"
NODE_BIN="$(command -v node || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js is required."
  echo "Install it on Lubuntu with: sudo apt update && sudo apt install -y nodejs git"
  exit 1
fi

mkdir -p "$APPLICATIONS_DIR" "$DESKTOP_DIR" "$UNIT_DIR"
chmod +x "${APP_DIR}/scripts/start-lubuntu.sh" "${APP_DIR}/scripts/launch-desktop-lubuntu.sh" "$START_LAUNCHER" "$STOP_LAUNCHER"
rm -f "${DESKTOP_DIR}/${APP_NAME}.desktop" "${APPLICATIONS_DIR}/${APP_ID}.desktop"

cat > "$UNIT_FILE" <<EOF
[Unit]
Description=${APP_NAME} local web server
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=HOST=0.0.0.0
Environment=PORT=4184
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ExecStart=${NODE_BIN} ${APP_DIR}/server.mjs
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload

cat > "$START_DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Start ${APP_NAME} Server
Comment=Start the local anchor force planner server
Exec=/usr/bin/env bash ${START_LAUNCHER}
Icon=${APP_DIR}/assets/anchor-force-planner.svg
Terminal=false
Categories=Utility;Education;
StartupNotify=false
EOF

cat > "$STOP_DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Stop ${APP_NAME} Server
Comment=Stop the local anchor force planner server
Exec=/usr/bin/env bash ${STOP_LAUNCHER}
Icon=${APP_DIR}/assets/anchor-force-planner.svg
Terminal=false
Categories=Utility;Education;
StartupNotify=false
EOF

cp "$START_DESKTOP_FILE" "${DESKTOP_DIR}/Start ${APP_NAME} Server.desktop"
cp "$STOP_DESKTOP_FILE" "${DESKTOP_DIR}/Stop ${APP_NAME} Server.desktop"
chmod +x "$START_DESKTOP_FILE" "$STOP_DESKTOP_FILE" "${DESKTOP_DIR}/Start ${APP_NAME} Server.desktop" "${DESKTOP_DIR}/Stop ${APP_NAME} Server.desktop"

echo "Installed ${APP_NAME} user service and Start/Stop launchers."
echo "Start:  systemctl --user start ${APP_ID}"
echo "Stop:   systemctl --user stop ${APP_ID}"
echo "Status: systemctl --user status ${APP_ID}"
echo "Logs:   journalctl --user -u ${APP_ID} -f"
echo "Open http://127.0.0.1:4184 in Firefox, or bookmark it."
