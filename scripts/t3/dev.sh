#!/usr/bin/env bash
# Starts everything for development: the web app's Vite dev server (with its
# CalDAV proxy at /dav-proxy/) and, when the dev shell has it, a local
# Radicale with a calendar to sign in to. Stop it all with stop.sh (or Ctrl-C).
# shellcheck source=env.sh
source "$(dirname "$0")/env.sh"
enter_dev_shell "$@"
ensure_deps
record_pid dev

# The owner's tailnet devices reach the dev server over https: the web store
# needs a secure context for OPFS and Web Locks, and plain http is one only on
# localhost. Vite stays on plain http on 127.0.0.1; in front of it goes
# `tailscale serve`, with the tailnet's own certificate, when it may run as
# this user, else the dev server's own TLS listener (apps/web/dev-tls.ts)
# with a self-signed certificate.
tailnet_ip="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
# This machine's MagicDNS name, when the tailnet gives it HTTPS certificates.
tailnet_name=""
if [ -n "$tailnet_ip" ]; then
  tailnet_name="$(tailscale status --json 2>/dev/null | node -p '
    const status = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const name = (status.Self?.DNSName ?? "").replace(/\.$/, "");
    (status.CertDomains ?? []).includes(name) ? name : ""' 2>/dev/null || true)"
fi

# True when `tailscale serve` may run as this user: root, or the operator
# Tailscale was given (`sudo tailscale set --operator=$USER`). Reads the
# settings only; changes nothing.
serve_permitted() {
  [ -n "$tailnet_name" ] || return 1
  [ "$(id -u)" = 0 ] && return 0
  [[ "$(tailscale debug prefs 2>/dev/null)" == *"\"OperatorUser\": \"$(id -un)\""* ]]
}

# Serves the dev server on the tailnet's https port, unless that port serves
# something else. The port and target go to the dev directory first, so
# serve_off (env.sh) removes exactly this entry, even after a kill.
serve_on() {
  local port="$ASTROTIME_WEB_HTTPS_PORT" target="http://127.0.0.1:$ASTROTIME_WEB_PORT" status out
  status="$(tailscale serve status --json 2>&1)" || { printf '%s\n' "$status" >&2; return 1; }
  # Ours already, from a dev.sh that was killed: Vite has the port now.
  [ "$(serve_target "$status" "$port" || true)" = "$target" ] && printf '%s %s\n' "$port" "$target" >"$ASTROTIME_DEV_DIR/serve" && return 0
  if [[ "$status" == *"\"$port\": {"* ]]; then
    echo "astrotime: tailscale serve already uses https port $port for something else; pick another with ASTROTIME_WEB_HTTPS_PORT" >&2
    return 1
  fi
  printf '%s %s\n' "$port" "$target" >"$ASTROTIME_DEV_DIR/serve"
  if ! out="$(tailscale serve --bg --yes --https="$port" "$target" </dev/null 2>&1)"; then
    printf '%s\n' "$out" >&2
    echo "astrotime: tailscale serve failed; ASTROTIME_WEB_TLS=self-signed serves https with a self-signed certificate instead" >&2
    return 1
  fi
}

# A self-signed certificate for the https front, made once into the dev
# directory, and again when the names it covers change or it nears its end.
self_signed_cert() {
  local dir="$ASTROTIME_DEV_DIR/tls" names
  names="IP:$ASTROTIME_WEB_HTTPS_HOST,DNS:localhost,IP:127.0.0.1,DNS:$(hostname)${tailnet_name:+,DNS:$tailnet_name}"
  export ASTROTIME_WEB_TLS_CERT="$dir/cert.pem" ASTROTIME_WEB_TLS_KEY="$dir/key.pem"
  if [ -f "$ASTROTIME_WEB_TLS_KEY" ] && [ "$(cat "$dir/names" 2>/dev/null)" = "$names" ] &&
    openssl x509 -checkend 86400 -noout -in "$ASTROTIME_WEB_TLS_CERT" >/dev/null 2>&1; then
    return
  fi
  command -v openssl >/dev/null 2>&1 || { echo "astrotime: the self-signed certificate needs openssl (the devenv shell has it)" >&2; exit 1; }
  mkdir -p "$dir"
  (umask 077 && openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 365 \
    -subj "/CN=AstroTime dev server" -addext "subjectAltName=$names" -addext "extendedKeyUsage=serverAuth" \
    -keyout "$ASTROTIME_WEB_TLS_KEY" -out "$ASTROTIME_WEB_TLS_CERT" 2>/dev/null) ||
    { echo "astrotime: openssl could not make the self-signed certificate" >&2; exit 1; }
  printf '%s\n' "$names" >"$dir/names"
}

# serve, self-signed or off; by default the best the tailnet allows, and off
# without Tailscale or with a host set by hand.
if [ -z "${ASTROTIME_WEB_TLS:-}" ]; then
  if [ -n "$ASTROTIME_WEB_HOST_BY_HAND" ] || [ -z "$tailnet_ip" ]; then
    ASTROTIME_WEB_TLS=off
  elif serve_permitted; then
    ASTROTIME_WEB_TLS=serve
  else
    ASTROTIME_WEB_TLS=self-signed
  fi
fi
export ASTROTIME_WEB_HTTPS_PORT="${ASTROTIME_WEB_HTTPS_PORT:-$ASTROTIME_WEB_PORT}"
# Only the self-signed mode starts the front (apps/web/dev-tls.ts); a
# certificate inherited from the caller's shell must not start one otherwise.
[ "$ASTROTIME_WEB_TLS" = self-signed ] || unset ASTROTIME_WEB_TLS_CERT ASTROTIME_WEB_TLS_KEY
case "$ASTROTIME_WEB_TLS" in
  off) ;;
  serve)
    [ -n "$tailnet_name" ] || { echo "astrotime: tailscale serve needs Tailscale up, with HTTPS certificates on the tailnet" >&2; exit 1; }
    export ASTROTIME_WEB_CLIENTS=tailnet
    ;;
  self-signed)
    export ASTROTIME_WEB_HTTPS_HOST="${ASTROTIME_WEB_HTTPS_HOST:-$tailnet_ip}"
    [ -n "$ASTROTIME_WEB_HTTPS_HOST" ] || { echo "astrotime: no tailnet address for the https front; set ASTROTIME_WEB_HTTPS_HOST" >&2; exit 1; }
    self_signed_cert
    export ASTROTIME_WEB_CLIENTS=tailnet
    ;;
  *)
    echo "astrotime: ASTROTIME_WEB_TLS is \"$ASTROTIME_WEB_TLS\"; it takes serve, self-signed or off" >&2
    exit 1
    ;;
esac

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
# With the self-signed front, ready once that listens too (it starts after Vite).
ready="Local:"
[ "$ASTROTIME_WEB_TLS" = self-signed ] && ready="Https:"
start_until "$ready" env NO_COLOR=1 pnpm --dir "$ASTROTIME_ROOT/apps/web" exec vp dev --host "$ASTROTIME_WEB_HOST" --port "$ASTROTIME_WEB_PORT" --strictPort
# After Vite, which has the port by now: no other checkout's dev server is
# behind an entry for it.
if [ "$ASTROTIME_WEB_TLS" = serve ]; then
  serve_on || exit 1
fi

echo
echo "astrotime: open http://127.0.0.1:$ASTROTIME_WEB_PORT"
case "$ASTROTIME_WEB_TLS" in
  serve)
    echo "astrotime: on your tailnet https://$tailnet_name:$ASTROTIME_WEB_HTTPS_PORT (tailscale serve)"
    ;;
  self-signed)
    echo "astrotime: on your tailnet https://$ASTROTIME_WEB_HTTPS_HOST:$ASTROTIME_WEB_HTTPS_PORT (or https://${tailnet_name:-$(hostname)}:$ASTROTIME_WEB_HTTPS_PORT), with a self-signed certificate: the browser warns until you go on"
    if [ -n "$tailnet_name" ] && ! serve_permitted; then
      # Literally $USER, for the owner to paste.
      # shellcheck disable=SC2016
      echo 'astrotime: for the tailnet'"'"'s own certificate (tailscale serve), allow it once: sudo tailscale set --operator=$USER'
    fi
    ;;
  off)
    if [ "${ASTROTIME_WEB_CLIENTS:-}" = tailnet ] && [ -n "$tailnet_ip" ]; then
      echo "astrotime: on your tailnet http://$tailnet_ip:$ASTROTIME_WEB_PORT, plain http: the web store opens only over https or on localhost"
    fi
    ;;
esac
if command -v radicale >/dev/null 2>&1; then
  echo "astrotime: local CalDAV at http://127.0.0.1:$ASTROTIME_DAV_PORT/ (user astro, password astro)"
fi
echo "astrotime: stop with scripts/t3/stop.sh"

# Runs until one of the services exits (or stop.sh ends this script).
wait -n
