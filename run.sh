#!/usr/bin/env bash
# Serve Settlers. Usage: ./run.sh [port]   (default 8960)
set -e
cd "$(dirname "$0")"
PORT="${1:-${SETTLERS_PORT:-8960}}"
PID=$(ss -tlnp 2>/dev/null | grep ":$PORT " | grep -oP 'pid=\K[0-9]+' | head -1)
if [ -n "$PID" ]; then echo "stopping existing server (pid $PID)"; kill "$PID" 2>/dev/null || true; sleep 1; fi
echo "Settlers → http://localhost:$PORT"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
