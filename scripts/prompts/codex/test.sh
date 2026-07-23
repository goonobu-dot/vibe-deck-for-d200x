#!/bin/bash
printf %s "Write tests for: " | pbcopy
osascript -e 'tell application "System Events" to keystroke "v" using command down' &>/dev/null || true
