#!/usr/bin/env bash
# Proves dev.sh and stop.sh: starts everything, checks the page (and the
# CalDAV proxy when Radicale is there), that a second start is refused, and
# that stop.sh leaves nothing running. CI runs it.
# shellcheck source=env.sh
source "$(dirname "$0")/env.sh"
enter_dev_shell "$@"

log="$ASTROTIME_DEV_DIR/smoke.log"
: >"$log"
fifo="$(mktemp -u "$ASTROTIME_DEV_DIR/smoke.XXXXXX")"
mkfifo "$fifo"
bash "$ASTROTIME_ROOT/scripts/t3/dev.sh" >"$fifo" 2>&1 &
exec {out}<"$fifo"
rm -f "$fifo"
# Waits for dev.sh's own "ready" line, not for time.
while IFS= read -r line <&"$out"; do
  printf '%s\n' "$line" >>"$log"
  [[ "$line" == *"astrotime: stop with"* ]] && break
done
cat <&"$out" >>"$log" &
# Whatever ends the smoke run, nothing it started stays behind.
trap 'bash "$ASTROTIME_ROOT/scripts/t3/stop.sh" >/dev/null 2>&1 || true' EXIT

fail() {
  echo "smoke: $1" >&2
  bash "$ASTROTIME_ROOT/scripts/t3/stop.sh" >/dev/null || true
  exit 1
}

curl -fsS "http://127.0.0.1:$ASTROTIME_WEB_PORT/" | grep -q "<title>AstroTime</title>" || fail "the page did not load"
if command -v radicale >/dev/null 2>&1; then
  status="$(curl -s -o /dev/null -w '%{http_code}' -X PROPFIND -u astro:astro -H 'Depth: 0' \
    "http://127.0.0.1:$ASTROTIME_WEB_PORT/dav-proxy/http%3A%2F%2F127.0.0.1%3A$ASTROTIME_DAV_PORT/astro/personal/")"
  [ "$status" = 207 ] || fail "the CalDAV proxy answered $status"
fi
if second="$(bash "$ASTROTIME_ROOT/scripts/t3/dev.sh" 2>&1)"; then fail "a second dev.sh started"; fi
[[ "$second" == *"dev is already running"* ]] || fail "a second dev.sh failed for another reason: $second"

bash "$ASTROTIME_ROOT/scripts/t3/stop.sh"
if curl -s -o /dev/null "http://127.0.0.1:$ASTROTIME_WEB_PORT/"; then fail "the dev server still answers after stop.sh"; fi
echo "smoke: ok"
