#!/bin/bash
printf %s "Implement this: " | pbcopy
osascript -e 'tell application "System Events" to keystroke "v" using command down' &>/dev/null || true
