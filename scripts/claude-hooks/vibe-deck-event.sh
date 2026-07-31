#!/usr/bin/env bash
# Claude Code hook → Vibe Deck bridge. $1 = needs_input | done.
# Reads the hook JSON on stdin, forwards session_id; never blocks Claude Code.
STATE="${1:-needs_input}"
SID="$(/usr/bin/python3 -c 'import sys,json;print(json.load(sys.stdin).get("session_id",""))' 2>/dev/null)"
/usr/bin/curl -s --max-time 1 "http://127.0.0.1:17823/event?tool=claude&state=${STATE}&session=${SID}" >/dev/null 2>&1 || true
exit 0
