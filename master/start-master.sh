#!/usr/bin/env bash
# Starts the bundled TMWebDriver master (WebSocket 18765 / HTTP 18766).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

if ! python3 -c "import simple_websocket_server, bottle, requests" 2>/dev/null; then
  echo "Installing Python dependencies (simple-websocket-server, bottle, requests)..."
  python3 -m pip install -r "$DIR/requirements.txt"
fi

echo "Starting TMWebDriver master on ws://127.0.0.1:18765 (HTTP link on 18766)..."
echo "Press Ctrl+C to stop."
exec python3 -u "$DIR/tmwebdriver_master.py"
