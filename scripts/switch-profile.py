#!/usr/bin/env python3
"""Ask vibe-deck bridge to cycle profiles. Never quits Ulanzi Studio."""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

BRIDGE = "http://127.0.0.1:17823"
LOG = Path.home() / "Library/Logs/vibe-deck-profile-switch.log"


def log(msg: str) -> None:
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        LOG.open("a", encoding="utf-8").write(msg + "\n")
    except OSError:
        pass


def main() -> int:
    direction = (sys.argv[1] if len(sys.argv) > 1 else "next").lower()
    path = "/profile/prev" if direction in ("prev", "previous", "-1") else "/profile/next"
    url = BRIDGE + path
    try:
        with urllib.request.urlopen(url, timeout=2) as res:
            body = json.loads(res.read().decode("utf-8"))
    except urllib.error.URLError as err:
        log(f"bridge unreachable: {err}")
        # Soft beep failure
        subprocess.Popen(
            ["afplay", "/System/Library/Sounds/Basso.aiff"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return 1

    log(f"ok {direction} -> {body.get('current')!r}")
    subprocess.Popen(
        ["afplay", "/System/Library/Sounds/Tink.aiff"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
