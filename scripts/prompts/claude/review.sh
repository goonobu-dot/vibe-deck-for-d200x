#!/bin/bash
printf %s "Review this code: " | pbcopy
osascript -e 'tell application "System Events" to keystroke "v" using command down' &>/dev/null || true
