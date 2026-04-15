#!/bin/bash
# Signal Intel — startup script
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

# ── Ollama ────────────────────────────────────────────────────────────────────

MODEL="${ANALYST_MODEL:-llama3.2}"

# Check ollama is installed
if ! command -v ollama &>/dev/null; then
  echo "❌  Ollama not found. Install it with:"
  echo "       brew install ollama"
  exit 1
fi

# Start ollama serve in background if not already running
if ! curl -s http://localhost:11434 &>/dev/null; then
  echo "Starting Ollama..."
  ollama serve &>/dev/null &
  OLLAMA_PID=$!
  # Wait for it to be ready
  for i in $(seq 1 15); do
    if curl -s http://localhost:11434 &>/dev/null; then break; fi
    sleep 1
  done
  if ! curl -s http://localhost:11434 &>/dev/null; then
    echo "❌  Ollama failed to start"
    exit 1
  fi
  echo "Ollama running (pid $OLLAMA_PID)"
fi

# Pull model if not already downloaded
if ! ollama list 2>/dev/null | grep -q "^${MODEL}"; then
  echo "Pulling model ${MODEL} (first-time download, may take a few minutes)..."
  ollama pull "$MODEL"
fi

# ── Reset seen-articles so current articles get analysed ─────────────────────
node --no-warnings -e "
  const {DatabaseSync}=require('node:sqlite');
  const fs=require('fs');
  if(fs.existsSync('data/signal-intel.db')){
    const db=new DatabaseSync('data/signal-intel.db');
    db.exec('DELETE FROM seen_articles');
    console.log('[start.sh] Seen-articles cache cleared — all articles will be analysed');
  }
"

# ── Launch server ─────────────────────────────────────────────────────────────
echo "Starting Signal Intel on http://localhost:3838"
node --no-warnings server.js
