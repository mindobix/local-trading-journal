#!/bin/bash
# Market News Crawler — start script
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Kill any process currently LISTENING on the port and wait for it to release
PORT=3737
LISTENER=$(lsof -ti :$PORT -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$LISTENER" ]; then
  echo "Stopping existing server (PID $LISTENER)..."
  kill -9 $LISTENER 2>/dev/null || true
  # Wait until the port is actually free (up to 5 seconds)
  for i in $(seq 1 10); do
    sleep 0.5
    lsof -ti :$PORT -sTCP:LISTEN > /dev/null 2>&1 || break
  done
fi

echo "Installing dependencies..."
npm install --silent

echo "Starting Market News Crawler on http://localhost:$PORT"
echo "Open http://localhost:$PORT in your browser"
echo ""
# On macOS, onnxruntime writes "Removing initializer" W: warnings via NSLog
# directly to stderr — they bypass all ORT log-level APIs. Filter them at the
# shell level. The forked report-worker processes inherit this stderr fd too.
node server.js 2> >(grep -v "CleanUnusedInitializersAndNodeArgs\|Removing initializer.*It is not used by any node" >&2)
