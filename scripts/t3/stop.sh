#!/usr/bin/env bash
# Stops what dev.sh started and returns once all of it has exited.
# shellcheck source=env.sh
source "$(dirname "$0")/env.sh"

file="$ASTROTIME_DEV_DIR/pids/dev.pid"
if [ ! -f "$file" ]; then
  echo "astrotime: nothing to stop"
  exit 0
fi
pid="$(cat "$file")"
if is_ours "$pid" dev; then
  stop_tree "$pid"
  echo "astrotime: stopped"
else
  echo "astrotime: nothing to stop (a stale pid file)"
fi
rm -f "$file"
