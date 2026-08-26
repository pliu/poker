#!/usr/bin/env bash
# There is no node on this machine, so the suite runs under macOS
# JavaScriptCore via osascript. Run from the project root.
set -euo pipefail
cd "$(dirname "$0")/.."
osascript -l JavaScript test/run_tests.js
