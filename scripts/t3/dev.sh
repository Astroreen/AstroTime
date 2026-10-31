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
else
  echo "astrotime: no radicale on PATH, so no local CalDAV server (it comes with devenv)" >&2
fi

# The script stays in the checkout's root: stop.sh recognises it by its directory.
start_until "Local:" env NO_COLOR=1 pnpm --dir "$ASTROTIME_ROOT/apps/web" exec vp dev --host 127.0.0.1 --port "$ASTROTIME_WEB_PORT" --strictPort

echo
echo "astrotime: open http://127.0.0.1:$ASTROTIME_WEB_PORT"
if command -v radicale >/dev/null 2>&1; then
  echo "astrotime: local CalDAV at http://127.0.0.1:$ASTROTIME_DAV_PORT/ (user astro, password astro)"
fi
echo "astrotime: stop with scripts/t3/stop.sh"

# Runs until one of the services exits (or stop.sh ends this script).
wait -n
