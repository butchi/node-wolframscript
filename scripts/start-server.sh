#!/usr/bin/env sh
# Simple server starter that writes a PID file and redirects logs to /tmp/node-ws.log
PIDFILE=".node-ws.pid"
PORT="${PORT:-3000}"

if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Server already running (PID $PID)."
    exit 0
  else
    echo "Stale PID file found. Removing."
    rm -f "$PIDFILE"
  fi
fi

nohup env PORT="$PORT" node dist/index.js &>/tmp/node-ws.log &
echo $! > "$PIDFILE"
echo "started:$(cat $PIDFILE) (PORT=$PORT, logs=/tmp/node-ws.log)"
