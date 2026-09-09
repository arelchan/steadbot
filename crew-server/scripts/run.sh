#!/bin/sh
# Supervisor for crew-server: restarts on exit code 75 (state replaced by a migration) and on crashes; stops on a clean exit.
cd "$(dirname "$0")/.." || exit 1
while :; do
  npx tsx src/index.ts
  code=$?
  if [ "$code" = "0" ]; then exit 0; fi
  if [ "$code" = "75" ]; then echo "[crew] restarting on new state"; continue; fi
  echo "[crew] exited with $code; restarting in 2s"; sleep 2
done
