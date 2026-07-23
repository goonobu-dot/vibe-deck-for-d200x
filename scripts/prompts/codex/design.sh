#!/bin/bash
printf %s "Design this feature: " | pbcopy
osascript -e 'tell application "System Events" to keystroke "v" using command down' &>/dev/null || true
