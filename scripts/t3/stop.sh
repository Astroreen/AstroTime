#!/usr/bin/env bash
# Stops what dev.sh started and returns once all of it has exited, its
# `tailscale serve` entry included.
# shellcheck source=env.sh
source "$(dirname "$0")/env.sh"

file="$ASTROTIME_DEV_DIR/pids/dev.pid"
if [ ! -f "$file" ]; then
  echo "astrotime: nothing to stop"
else
  pid="$(cat "$file")"
  if is_ours "$pid" dev; then
    stop_tree "$pid"
    echo "astrotime: stopped"
  else
    echo "astrotime: nothing to stop (a stale pid file)"
  fi
  rm -f "$file"
fi
# dev.sh removes it on exit; this is for one that was killed before it could.
serve_off
