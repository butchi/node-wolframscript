#!/usr/bin/env sh
PIDFILE=".node-ws.pid"

if [ ! -f "$PIDFILE" ]; then
  echo "PID file not found; server may not be running."
  exit 0
fi

PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then
  echo "Stopping server PID $PID..."
  kill -15 "$PID"
  sleep 0.5
  if kill -0 "$PID" 2>/dev/null; then
    echo "PID $PID still alive; forcing kill..."
    kill -9 "$PID"
  fi
else
  echo "Process $PID not running. Removing PID file."
fi

rm -f "$PIDFILE"
echo "stopped"
