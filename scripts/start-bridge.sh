#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${VIBE_DECK_PORT:-17823}"
DEMO="${VIBE_DECK_DEMO:-1}"
LOG="/tmp/vibe-deck-bridge.log"
WRAPPER_LOG="/tmp/vibe-deck-bridge-wrapper.log"
PIDFILE="/tmp/vibe-deck-bridge.pid"
NODE="$(command -v node)"

cd "$ROOT/bridge"
npm run build >/dev/null

# Stop previous wrapper/bridge
if [[ -f "$PIDFILE" ]]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
fi
pkill -f "vibe-deck/bridge/dist/index.js" 2>/dev/null || true
pkill -f "vibe-deck-bridge-wrapper" 2>/dev/null || true
sleep 0.3

WRAPPER="/tmp/vibe-deck-bridge-wrapper.sh"
cat >"$WRAPPER" <<EOF
#!/bin/bash
# vibe-deck-bridge-wrapper
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:\$PATH"
while true; do
  echo "[\$(date '+%Y-%m-%dT%H:%M:%S%z')] starting demo=\$DEMO" >>"$WRAPPER_LOG"
  VIBE_DECK_DEMO="$DEMO" VIBE_DECK_PORT="$PORT" "$NODE" "$ROOT/bridge/dist/index.js" >>"$LOG" 2>&1
  code=\$?
  echo "[\$(date '+%Y-%m-%dT%H:%M:%S%z')] exited code=\$code; restart in 1s" >>"$WRAPPER_LOG"
  sleep 1
done
EOF
chmod +x "$WRAPPER"

# Detach fully from parent shell/job control
/bin/bash "$WRAPPER" >/dev/null 2>&1 &
echo $! >"$PIDFILE"
disown $! 2>/dev/null || true
sleep 1

if curl -fsS "http://127.0.0.1:$PORT/health"; then
  echo
  echo "bridge OK (wrapper pid $(cat "$PIDFILE"), demo=$DEMO)"
else
  echo "bridge failed to start; see $LOG / $WRAPPER_LOG" >&2
  exit 1
fi
