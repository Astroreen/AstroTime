#!/usr/bin/env bash
# Starts a packaged AstroTime on a virtual display, as a user would, and
# shows that its window comes up (docs/plans/desktop.md#D79):
#   start.sh <screenshot.png> <command> [args...]
# The app runs with a profile of its own and no keyring: the store opens in
# the profile and nothing reaches the runner's (or a developer's) data.
# xdotool returns once the window is mapped; `timeout` is a ceiling on a
# start that never comes, not a wait. Needs bash 5.1 (`wait -p`).
set -euo pipefail

# On a virtual display of its own: this script again, under xvfb-run.
if [ -z "${ASTROTIME_ON_XVFB:-}" ]; then
  ASTROTIME_ON_XVFB=1 exec xvfb-run -a -s "-screen 0 1440x900x24" bash "$0" "$@"
fi

screenshot="$1"
shift
home="$(mktemp -d)"
HOME="$home" XDG_CONFIG_HOME="$home/.config" "$@" --password-store=basic > "$home/app.log" 2>&1 &
app=$!
trap 'kill "$app" 2> /dev/null || true' EXIT
timeout 90 xdotool search --sync --onlyvisible --name '^AstroTime$' > /dev/null &
finder=$!
# Whichever comes first: the window, or the app's end.
status=0
wait -n -p first "$app" "$finder" || status=$?
if [ "$first" = "$app" ]; then
  kill "$finder" 2> /dev/null || true
  echo "AstroTime ended ($status) before its window came up; its log:" >&2
  cat "$home/app.log" >&2
  exit 1
fi
if [ "$status" -ne 0 ]; then
  echo "No AstroTime window came up; its log:" >&2
  cat "$home/app.log" >&2
  exit 1
fi
import -window root "$screenshot"
cat "$home/app.log"
