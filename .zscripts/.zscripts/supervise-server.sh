#!/bin/bash
# Self-restarting supervisor for the Next.js production server.
# Restarts the server if it crashes, with a small backoff.
cd /home/z/my-project
export NODE_ENV=production
export PORT=3000
export HOSTNAME=0.0.0.0

while true; do
  echo "[$(date '+%H:%M:%S')] Starting next start..."
  ./node_modules/.bin/next start -p 3000
  EXIT_CODE=$?
  echo "[$(date '+%H:%M:%S')] Server exited with code $EXIT_CODE. Restarting in 3s..."
  sleep 3
done
