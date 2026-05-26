#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Anchor Force Planner"
APP_ID="anchor-force-planner"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="${HOME}/Desktop"
APPLICATIONS_DIR="${HOME}/.local/share/applications"
DESKTOP_FILE="${APPLICATIONS_DIR}/${APP_ID}.desktop"
LAUNCHER="${APP_DIR}/scripts/launch-desktop-lubuntu.sh"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required."
  echo "Install them on Lubuntu with: sudo apt update && sudo apt install -y nodejs npm git"
  exit 1
fi

mkdir -p "$APPLICATIONS_DIR" "$DESKTOP_DIR"
chmod +x "${APP_DIR}/scripts/start-lubuntu.sh" "$LAUNCHER"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Run the local anchor force planner web app
Exec=/usr/bin/env bash ${LAUNCHER}
Icon=${APP_DIR}/assets/anchor-force-planner.svg
Terminal=false
Categories=Utility;Education;
StartupNotify=false
EOF

cp "$DESKTOP_FILE" "${DESKTOP_DIR}/${APP_NAME}.desktop"
chmod +x "$DESKTOP_FILE" "${DESKTOP_DIR}/${APP_NAME}.desktop"

echo "Installed ${APP_NAME} launcher."
echo "Use the desktop icon to start the app and open Firefox, or run: ${APP_DIR}/scripts/start-lubuntu.sh"
echo "For iPad access, keep the Lubuntu laptop and iPad on the same Wi-Fi and open the printed LAN URL."
