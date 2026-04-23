#!/usr/bin/env sh
set -eu

node apps/worker/dist/main.js &
WORKER_PID=$!

cleanup() {
  kill "$WORKER_PID" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

node apps/api/dist/main.js
