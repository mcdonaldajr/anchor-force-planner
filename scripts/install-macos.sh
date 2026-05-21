#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Anchor Force Planner"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="${HOME}/Desktop"
MAC_APP="${DESKTOP_DIR}/${APP_NAME}.app"
CONTENTS_DIR="${MAC_APP}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"
LAUNCHER="${MACOS_DIR}/launcher"
PLIST="${CONTENTS_DIR}/Info.plist"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required."
  echo "Install Node.js from https://nodejs.org/ or with Homebrew: brew install node"
  exit 1
fi

mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"
chmod +x "${APP_DIR}/scripts/start-macos.sh"

cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\${PATH:-}"
LOG_DIR="\${HOME}/Library/Logs/Anchor Force Planner"
APP_DIR="${APP_DIR}"
PORT="\${PORT:-4184}"
HOST="\${HOST:-127.0.0.1}"
APP_URL="http://127.0.0.1:\${PORT}"
mkdir -p "\$LOG_DIR"
exec >>"\$LOG_DIR/launcher.log" 2>&1
echo "\$(date): launching Anchor Force Planner"
cd "\$APP_DIR"
if ! curl -fsS --max-time 1 "\$APP_URL" >/dev/null 2>&1; then
  HOST="\$HOST" PORT="\$PORT" nohup npm start >>"\$LOG_DIR/server.log" 2>&1 &
fi
for _ in {1..40}; do
  if curl -fsS --max-time 1 "\$APP_URL" >/dev/null 2>&1; then
    open "\$APP_URL"
    exit 0
  fi
  sleep 0.25
done
open "\$APP_URL"
EOF

chmod +x "$LAUNCHER"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>launcher</string>
  <key>CFBundleIdentifier</key>
  <string>local.anchor-force-planner</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
EOF

touch "$MAC_APP"

echo "Installed ${APP_NAME} on the Desktop."
echo "Double-click ${MAC_APP} to start the server and open the web app."
echo "Command-line start script: ${APP_DIR}/scripts/start-macos.sh"
