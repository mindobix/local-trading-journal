#!/bin/bash
# Market News Crawler — start script
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Installing dependencies..."
npm install --silent

echo "Starting Market News Crawler on http://localhost:3737"
echo "Open http://localhost:3737 in your browser"
echo ""
node server.js
