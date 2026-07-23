#!/bin/bash
printf %s "Write a commit message for: " | pbcopy
osascript -e 'tell application "System Events" to keystroke "v" using command down' &>/dev/null || true
