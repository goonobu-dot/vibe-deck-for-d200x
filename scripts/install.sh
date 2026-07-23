#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_SRC="$ROOT/plugin/com.vibe.deck.status.ulanziPlugin"
PLUGIN_DST="$HOME/Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.vibe.deck.status.ulanziPlugin"
LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.vibe.deck.bridge.plist"
PORT="${VIBE_DECK_PORT:-17823}"

echo "==> Generate status + nav icons"
python3 -c "import PIL" 2>/dev/null || python3 -m pip install --user Pillow
python3 "$ROOT/scripts/generate-icons.py"

echo "==> Generate per-tool themes"
python3 "$ROOT/scripts/generate-tool-themes.py"

echo "==> Build bridge"
cd "$ROOT/bridge"
npm install
npm run build

echo "==> Install plugin deps"
cd "$PLUGIN_SRC"
npm install --omit=dev

echo "==> Wire profiles (nav + skills + themes) and install plugin"
node "$ROOT/scripts/wire-deck.mjs"

echo "==> Write LaunchAgent for bridge"
mkdir -p "$(dirname "$LAUNCH_AGENT")"
cat > "$LAUNCH_AGENT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.vibe.deck.bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>$ROOT/bridge/dist/index.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>VIBE_DECK_PORT</key><string>$PORT</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>VIBE_DECK_DEMO</key><string>0</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/vibe-deck-bridge.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/vibe-deck-bridge.err.log</string>
</dict>
</plist>
EOF

launchctl unload "$LAUNCH_AGENT" 2>/dev/null || true
launchctl load "$LAUNCH_AGENT" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/com.vibe.deck.bridge" 2>/dev/null || true

pkill -f "vibe-deck/bridge/dist/index.js" 2>/dev/null || true
sleep 0.3
# Prefer LaunchAgent; fallback direct start
if ! curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  VIBE_DECK_PORT="$PORT" node "$ROOT/bridge/dist/index.js" >>"$HOME/Library/Logs/vibe-deck-bridge.out.log" 2>&1 &
  sleep 1
fi

if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "==> Bridge OK on :$PORT"
else
  echo "==> Bridge health check failed — see ~/Library/Logs/vibe-deck-bridge.*.log"
fi

cat <<MSG

Install complete.

Next steps:
1. Quit & reopen Ulanzi Studio
2. Use bottom L/R buttons to cycle profiles (all N in Studio)
3. Use rightmost dial to switch pages 1/2/3
4. Accessibility + Automation: allow Ulanzi Studio

Manual: $ROOT/docs/取扱説明書.md
MSG
