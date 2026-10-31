#!/usr/bin/env bash
# Starts everything for development: the web app's Vite dev server (with its
# CalDAV proxy at /dav-proxy/) and, when the dev shell has it, a local
# Radicale with a calendar to sign in to. Stop it all with stop.sh (or Ctrl-C).
# shellcheck source=env.sh
source "$(dirname "$0")/env.sh"
enter_dev_shell "$@"
ensure_deps
record_pid dev

# A local CalDAV server with its data in the dev directory, kept between runs.
if command -v radicale >/dev/null 2>&1; then
  dav="$ASTROTIME_DEV_DIR/radicale"
  mkdir -p "$dav"
  printf 'astro:astro\n' >"$dav/users"
  cat >"$dav/config" <<CONFIG
[server]
hosts = 127.0.0.1:$ASTROTIME_DAV_PORT
[auth]
type = htpasswd
htpasswd_filename = $dav/users
htpasswd_encryption = plain
[storage]
filesystem_folder = $dav/collections
CONFIG
  start_until "Radicale server ready" radicale --config "$dav/config"
  # A first calendar for a fresh dev directory; 405 or 409 mean it is there already.
  made="$(curl -s --connect-timeout 5 --max-time 15 -o /dev/null -w '%{http_code}' -u astro:astro -X MKCALENDAR "http://127.0.0.1:$ASTROTIME_DAV_PORT/astro/personal/")"
  case "$made" in
    201 | 405 | 409) ;;
    *) echo "astrotime: could not make the dev calendar (MKCALENDAR answered $made)" >&2; exit 1 ;;
  esac
  # Beyond localhost (or with a list of the owner's) the dev proxy reaches
  # only listed servers (dav-proxy.ts); the local Radicale is one of them.
  # On localhost with no list it reaches any server, Radicale included.
  if ! web_is_local || [ -n "${ASTROTIME_PROXY_ALLOW:-}" ]; then
    ASTROTIME_PROXY_ALLOW="${ASTROTIME_PROXY_ALLOW:+$ASTROTIME_PROXY_ALLOW,}http://127.0.0.1:$ASTROTIME_DAV_PORT"
    export ASTROTIME_PROXY_ALLOW
  fi
else
  echo "astrotime: no radicale on PATH, so no local CalDAV server (it comes with devenv)" >&2
fi

if ! web_is_local && [ -z "${ASTROTIME_PROXY_ALLOW:-}" ]; then
  echo "astrotime: the dev proxy listens beyond localhost with no ASTROTIME_PROXY_ALLOW, so it refuses every CalDAV server; list yours there" >&2
fi
if ! web_is_local && [ "${ASTROTIME_WEB_CLIENTS:-}" != tailnet ]; then
  echo "astrotime: warning: listening on $ASTROTIME_WEB_HOST for every network; anyone who reaches port $ASTROTIME_WEB_PORT can use the local CalDAV server through the proxy (password astro)" >&2
fi

# Names other devices may reach the dev server by (Vite refuses unknown Host
# headers): this machine's name, and its Tailscale MagicDNS names.
export ASTROTIME_WEB_ALLOWED_HOSTS="${ASTROTIME_WEB_ALLOWED_HOSTS:-$(hostname),.ts.net}"

# The script stays in the checkout's root: stop.sh recognises it by its directory.
start_until "Local:" env NO_COLOR=1 pnpm --dir "$ASTROTIME_ROOT/apps/web" exec vp dev --host "$ASTROTIME_WEB_HOST" --port "$ASTROTIME_WEB_PORT" --strictPort

echo
echo "astrotime: open http://127.0.0.1:$ASTROTIME_WEB_PORT"
if [ "${ASTROTIME_WEB_CLIENTS:-}" = tailnet ]; then
  tailnet="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
  if [ -n "$tailnet" ]; then
    echo "astrotime: on your tailnet http://$tailnet:$ASTROTIME_WEB_PORT (or http://$(hostname):$ASTROTIME_WEB_PORT)"
  fi
fi
if command -v radicale >/dev/null 2>&1; then
  echo "astrotime: local CalDAV at http://127.0.0.1:$ASTROTIME_DAV_PORT/ (user astro, password astro)"
fi
echo "astrotime: stop with scripts/t3/stop.sh"

# Runs until one of the services exits (or stop.sh ends this script).
wait -n
