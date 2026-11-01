#!/usr/bin/env bash
# Proves dev.sh and stop.sh: starts everything, checks the page over http
# and through the https front (and the CalDAV proxy when Radicale is there),
# the proxy's allowlist and Vite's host check, that a second start is
# refused, and that stop.sh leaves nothing running. CI runs it.
# Its own directory and ports, so it never meets (or stops) a dev session
# that is running.
export ASTROTIME_DEV_DIR="${ASTROTIME_SMOKE_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/.astrotime-dev/smoke}"
export ASTROTIME_WEB_PORT="${ASTROTIME_SMOKE_WEB_PORT:-5190}"
export ASTROTIME_DAV_PORT="${ASTROTIME_SMOKE_DAV_PORT:-5242}"
# The setup the tailnet gets without `tailscale serve` (scripts/t3/README.md),
# with or without Tailscale and never touching it: the self-signed https
# front, here on loopback, tailnet clients only, the proxy's allowlist.
export ASTROTIME_WEB_TLS=self-signed ASTROTIME_WEB_HTTPS_HOST=127.0.0.1
export ASTROTIME_WEB_HTTPS_PORT="${ASTROTIME_SMOKE_HTTPS_PORT:-5191}"
# shellcheck source=env.sh
source "$(dirname "$0")/env.sh"
enter_dev_shell "$@"

log="$ASTROTIME_DEV_DIR/smoke.log"
: >"$log"
fifo="$(mktemp -u "$ASTROTIME_DEV_DIR/smoke.XXXXXX")"
mkfifo "$fifo"
# Whatever ends the smoke run, nothing it started stays behind.
trap 'bash "$ASTROTIME_ROOT/scripts/t3/stop.sh" >/dev/null 2>&1 || true' EXIT
# A signal (CI's `timeout`) ends the script through exit, so the cleanup runs.
trap 'exit 130' INT
trap 'exit 143' TERM
bash "$ASTROTIME_ROOT/scripts/t3/dev.sh" >"$fifo" 2>&1 &
exec {out}<"$fifo"
rm -f "$fifo"
# Waits for dev.sh's own "ready" line, not for time.
ready=0
while IFS= read -r line <&"$out"; do
  printf '%s\n' "$line" >>"$log"
  [[ "$line" == *"astrotime: stop with"* ]] && ready=1 && break
done
[ "$ready" = 1 ] || { echo "smoke: dev.sh ended before it was ready; see $log" >&2; exit 1; }
cat <&"$out" >>"$log" &

fail() {
  echo "smoke: $1" >&2
  bash "$ASTROTIME_ROOT/scripts/t3/stop.sh" >/dev/null || true
  exit 1
}

# Read whole, then searched: `curl | grep -q` under pipefail can fail a good page.
page="$(curl -fsS "http://127.0.0.1:$ASTROTIME_WEB_PORT/")" || fail "the page did not load"
[[ "$page" == *"<title>AstroTime</title>"* ]] || fail "the page is not AstroTime's"
# The https front, with the certificate dev.sh made for it (no -k).
https="https://127.0.0.1:$ASTROTIME_WEB_HTTPS_PORT"
cert="$ASTROTIME_DEV_DIR/tls/cert.pem"
page="$(curl -fsS --cacert "$cert" "$https/")" || fail "the page did not load over https"
[[ "$page" == *"<title>AstroTime</title>"* ]] || fail "the page over https is not AstroTime's"
if command -v radicale >/dev/null 2>&1; then
  for origin in "http://127.0.0.1:$ASTROTIME_WEB_PORT" "$https"; do
    status="$(curl -s --cacert "$cert" -o /dev/null -w '%{http_code}' -X PROPFIND -u astro:astro -H 'Depth: 0' \
      "$origin/dav-proxy/http%3A%2F%2F127.0.0.1%3A$ASTROTIME_DAV_PORT/astro/personal/")"
    [ "$status" = 207 ] || fail "the CalDAV proxy at $origin answered $status"
  done
fi
# Beyond localhost the proxy reaches only listed servers, and Vite answers
# only to known host names (DNS rebinding).
# The body tells the allowlist's 403 from the "no list" one.
refused="$(curl -s -w ' %{http_code}' "http://127.0.0.1:$ASTROTIME_WEB_PORT/dav-proxy/https%3A%2F%2Fexample.com/")"
if command -v radicale >/dev/null 2>&1; then
  [[ "$refused" == *"not on this proxy's allowlist. 403" ]] || fail "the CalDAV proxy let in a server not on its allowlist: $refused"
else
  [[ "$refused" == *"ASTROTIME_PROXY_ALLOW"*" 403" ]] || fail "the CalDAV proxy with no allowlist answered: $refused"
fi
status="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: rebound.example' "http://127.0.0.1:$ASTROTIME_WEB_PORT/")"
[ "$status" = 403 ] || fail "the dev server answered $status for an unknown host name"
if second="$(bash "$ASTROTIME_ROOT/scripts/t3/dev.sh" 2>&1)"; then fail "a second dev.sh started"; fi
[[ "$second" == *"dev is already running"* ]] || fail "a second dev.sh failed for another reason: $second"

bash "$ASTROTIME_ROOT/scripts/t3/stop.sh"
if curl -s -o /dev/null "http://127.0.0.1:$ASTROTIME_WEB_PORT/"; then fail "the dev server still answers after stop.sh"; fi
if curl -sk -o /dev/null "$https/"; then fail "the https front still answers after stop.sh"; fi
if curl -s -o /dev/null "http://127.0.0.1:$ASTROTIME_DAV_PORT/"; then fail "Radicale still answers after stop.sh"; fi
echo "smoke: ok"
