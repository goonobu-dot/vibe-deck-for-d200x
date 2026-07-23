#!/bin/bash
exec /usr/bin/python3 "$(cd "$(dirname "$0")" && pwd)/switch-profile.py" next
