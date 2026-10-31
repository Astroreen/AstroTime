# shellcheck shell=bash
# Sourced by the other scripts in this directory (after Jhin's scripts/t3):
# the dev shell's tools, the dev directory, and process bookkeeping so
# stop.sh ends exactly what dev.sh started.

set -euo pipefail
shopt -s extglob

# `wait -n`, `exec {fd}<` and EPOCHREALTIME need bash 5.1.
if [ "${BASH_VERSINFO[0]}" -lt 5 ] || { [ "${BASH_VERSINFO[0]}" -eq 5 ] && [ "${BASH_VERSINFO[1]}" -lt 1 ]; }; then
  echo "astrotime: these scripts need bash 5.1 or newer (found $BASH_VERSION)" >&2
  exit 1
fi

ASTROTIME_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# The calling script by an absolute path, taken before the `cd` below: the
# devenv re-exec runs it again from the root.
ASTROTIME_SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
export ASTROTIME_ROOT
# The same path without symlinks, as /proc/<pid>/cwd reports it.
ASTROTIME_ROOT_PHYSICAL="$(cd "$ASTROTIME_ROOT" && pwd -P)"
# The scripts run from the checkout's root, wherever they are called from:
# stop.sh recognises dev.sh by that directory.
cd "$ASTROTIME_ROOT"

# Everything the dev scripts create lives here (gitignored).
ASTROTIME_DEV_DIR="${ASTROTIME_DEV_DIR:-$ASTROTIME_ROOT/.astrotime-dev}"
export ASTROTIME_DEV_DIR
mkdir -p "$ASTROTIME_DEV_DIR"

ASTROTIME_WEB_PORT="${ASTROTIME_WEB_PORT:-5180}"
ASTROTIME_DAV_PORT="${ASTROTIME_DAV_PORT:-5232}"

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

# Runs the calling script again inside the devenv shell when the tools it
# needs (Node 24, pnpm) are not on PATH: T3 Code's actions start in a plain
# shell. Without devenv, Node 24 and pnpm must be installed by hand.
enter_dev_shell() {
  if [ "$(node_major)" -ge 24 ] && command -v pnpm >/dev/null 2>&1; then
    return
  fi
  if [ -z "${ASTROTIME_IN_DEVENV:-}" ] && command -v devenv >/dev/null 2>&1; then
    cd "$ASTROTIME_ROOT"
    ASTROTIME_IN_DEVENV=1 exec devenv shell -- bash "$ASTROTIME_SCRIPT" "$@"
  fi
  echo "astrotime: needs Node 24 and pnpm on PATH (or devenv); see README.md#development" >&2
  exit 1
}

# Installs dependencies when node_modules is missing or older than the lockfile.
ensure_deps() {
  if [ ! -d "$ASTROTIME_ROOT/node_modules" ] || [ "$ASTROTIME_ROOT/pnpm-lock.yaml" -nt "$ASTROTIME_ROOT/node_modules/.modules.yaml" ]; then
    (cd "$ASTROTIME_ROOT" && pnpm install --frozen-lockfile)
  fi
}

# Prints a process and all its descendants, parents first.
tree_pids() {
  local child
  echo "$1"
  for child in $(pgrep -P "$1" 2>/dev/null); do
    tree_pids "$child"
  done
}

# True while pid runs; a zombie counts as exited, since no signal removes it.
is_running() {
  local state
  state="$(ps -o stat= -p "$1" 2>/dev/null)" || return 1
  [ -n "$state" ] && [ "${state:0:1}" != "Z" ]
}

# Ends a process tree and returns once all of it has exited: SIGTERM, then
# SIGKILL for whatever still runs after 10 s.
stop_tree() {
  local start elapsed pid seen alive signal=TERM
  start="${EPOCHREALTIME/[.,]/}"
  seen="$(tree_pids "$1")"
  while :; do
    alive=0
    for pid in $seen; do
      is_running "$pid" || continue
      alive=1
      kill "-$signal" "$pid" 2>/dev/null || true
    done
    [ "$alive" = 0 ] && return 0
    elapsed=$(((${EPOCHREALTIME/[.,]/} - start) / 100000))
    [ "$elapsed" -ge 100 ] && signal=KILL
    if [ "$elapsed" -ge 120 ]; then
      echo "astrotime: processes still running after SIGKILL: $seen" >&2
      return 1
    fi
    # stop.sh is not a test: waiting for other processes to exit is its job.
    sleep 0.1
    # `|| true`: a process that exited since must not end the loop under errexit.
    seen="$(for pid in $seen; do { is_running "$pid" && tree_pids "$pid"; } || true; done | sort -un)"
  done
}

# True when pid is alive and is scripts/t3/<name>.sh of this checkout, so a
# stale pid file never matches an unrelated process that reused the pid.
is_ours() {
  kill -0 "$1" 2>/dev/null || return 1
  ps -o args= -p "$1" 2>/dev/null | grep -Eq "(^|[ /])$2\.sh( |\$)" || return 1
  if [ -d "/proc/$1" ]; then
    [ "$(readlink "/proc/$1/cwd")" = "$ASTROTIME_ROOT_PHYSICAL" ] || return 1
  fi
}

# Records this script's pid so stop.sh can end it; refuses a second instance.
record_pid() {
  local file="$ASTROTIME_DEV_DIR/pids/$1.pid"
  mkdir -p "$ASTROTIME_DEV_DIR/pids"
  if [ -f "$file" ] && ! is_ours "$(cat "$file" 2>/dev/null || true)" "$1"; then
    rm -f "$file" # stale: its process is gone, or is something else now
  fi
  if ! (set -o noclobber && echo "$$" >"$file") 2>/dev/null; then
    echo "astrotime: $1 is already running (pid $(cat "$file")); run scripts/t3/stop.sh first" >&2
    exit 1
  fi
  # shellcheck disable=SC2154 # job is the loop variable inside the trap string
  # On exit (Ctrl-C included) the services are stopped and waited for, so a
  # quick restart does not find their ports still taken.
  trap 'rm -f "'"$file"'"; for job in $(jobs -p); do stop_tree "$job" || true; done' EXIT
  trap 'exit 130' INT TERM
}

# Starts a command in the background with its output on this terminal, and
# returns once a line of it matches `ready` (the service's own "I listen" line,
# not a timer). Sets STARTED_PID. Fails if the command exits first.
start_until() {
  local ready="$1" fifo line out
  shift
  fifo="$(mktemp -u "$ASTROTIME_DEV_DIR/out.XXXXXX")"
  mkfifo "$fifo"
  "$@" >"$fifo" 2>&1 &
  STARTED_PID=$!
  exec {out}<"$fifo"
  rm -f "$fifo"
  while IFS= read -r line <&"$out"; do
    printf '%s\n' "$line"
    # Matched without colour codes: in CI, Vite writes `\e[1mLocal\e[22m:`.
    if [[ "${line//$'\e'\[+([0-9;])m/}" == *"$ready"* ]]; then
      # Keep forwarding its output.
      cat <&"$out" &
      return 0
    fi
  done
  wait "$STARTED_PID" || true
  echo "astrotime: '$*' exited before it was ready" >&2
  exit 1
}
