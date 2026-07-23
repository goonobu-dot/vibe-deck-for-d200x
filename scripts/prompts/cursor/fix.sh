#!/bin/bash
printf %s "Fix this bug: " | pbcopy
osascript -e 'tell application "System Events" to keystroke "v" using command down' &>/dev/null || true
