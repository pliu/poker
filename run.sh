#!/usr/bin/env bash
# Start Hold'em Coach and open it in the browser.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8777}"
python3 server.py &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
sleep 1
URL="http://127.0.0.1:${PORT}/"
if command -v open >/dev/null 2>&1; then open "$URL"; fi
echo "Serving $URL — Ctrl-C to stop."
wait $SERVER_PID
