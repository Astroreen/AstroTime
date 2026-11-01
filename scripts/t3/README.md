# Dev scripts

One command to start everything for development, one to stop it, after
Jhin's `scripts/t3`. T3 Code's project actions call them. They need bash 5.1,
curl and (for a self-signed certificate) openssl; outside the devenv shell
they enter it themselves (`devenv shell`), or use Node 24 and pnpm already on
PATH.

| Script     | What it does                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `dev.sh`   | the web app's Vite dev server on port 5180 (with its CalDAV proxy), https for the tailnet, and a local Radicale   |
| `stop.sh`  | stops what `dev.sh` started, its `tailscale serve` entry too; returns once all has exited (SIGKILL after 10 s)    |
| `smoke.sh` | starts `dev.sh`, checks the page over http and https, the proxy, a refused second start and `stop.sh`; CI runs it |

`dev.sh` prints what to open:

    astrotime: open http://127.0.0.1:5180
    astrotime: on your tailnet https://<machine>.<tailnet>.ts.net:5180 (tailscale serve)
    astrotime: local CalDAV at http://127.0.0.1:5232/ (user astro, password astro)

Open `http://127.0.0.1:5180/?demo` to fill the app's local store with demo
data around today (dev server only; `docs/map.md`, `apps/web`).

The local Radicale (from the devenv shell) keeps its data in
`.astrotime-dev/radicale` (gitignored), with a calendar `personal` made on the
first start. Radicale listens on 127.0.0.1 only; other devices reach it
through the dev proxy.

## From your other devices: https on the tailnet

The web store needs a secure context (OPFS and Web Locks), and plain http is
one only on localhost. So the dev server stays on plain http on 127.0.0.1,
and with Tailscale (`tailscale ip` answers) your tailnet devices reach it
over https, on the same port number, through one of two fronts:

- **`tailscale serve`**, with the tailnet's own certificate, at
  `https://<machine>.<tailnet>.ts.net:5180`. It needs HTTPS certificates on
  the tailnet and Tailscale's permission to run as you, which you give once:

      sudo tailscale set --operator=$USER

  `dev.sh` reads that permission (`tailscale debug prefs`) without changing
  anything, adds its serve entry after Vite has the port, and removes
  exactly that entry on exit (`stop.sh` removes it too, after a kill);
  serve config you made yourself is left alone, and a port it already uses
  for something else stops `dev.sh`.

- **Otherwise, a self-signed certificate**: the dev server's own TLS listener
  (`apps/web/dev-tls.ts`) on the tailnet address,
  `https://100.x.y.z:5180` or `https://<machine>.<tailnet>.ts.net:5180`.
  The browser warns about the certificate until you go on; the page is then
  a secure context. The certificate (`.astrotime-dev/tls`, made with
  openssl from the devenv shell) is made once, and again when the names it
  covers change. `dev.sh` prints the command above while it falls back.

**A single-user preset.** `.astrotime-dev/preset.env` (gitignored), with
`ASTROTIME_SERVER_URL=https://cloud.example.com` and
`ASTROTIME_USERNAME=astro`, makes the dev server's page name that server and
user, so signing in asks for the password alone, and puts the server on the
proxy's list (`docs/plans/foundation.md#D123`). It holds no password.

**One address, one store.** A browser keeps the app's store, accounts and
passwords per origin, so `http://127.0.0.1:5180`, `https://100.x.y.z:5180`,
`https://<machine>:5180` and the `tailscale serve` name each start empty,
and none sees another's (`docs/plans/foundation.md#D121`). Keep to one: the
`tailscale serve` name when it runs, for this machine too.

Either way only this machine and tailnet devices (100.64.0.0/10,
fd7a:115c:a1e0::/48; `apps/web/dev-clients.ts`) get in, not the rest of a LAN
or a café's Wi-Fi, and the dev proxy reaches only the servers in
`ASTROTIME_PROXY_ALLOW` (comma-separated origins; `dev.sh` adds the local
Radicale): anyone who reached it could use the local Radicale with its
published password. To use your own Nextcloud from there:

    ASTROTIME_PROXY_ALLOW=https://cloud.example.com bash scripts/t3/dev.sh

Without Tailscale the dev server is on 127.0.0.1 only.
`ASTROTIME_WEB_HOST=0.0.0.0` opens it to every network, on plain http with
no front and no client check (add `ASTROTIME_WEB_CLIENTS=tailnet` for the
client check); beyond localhost the web store does not open over plain http.

In T3 Code: a project action running `scripts/t3/dev.sh`, the preview URL
`http://127.0.0.1:5180`, and an action running `scripts/t3/stop.sh`.

Environment overrides: `ASTROTIME_WEB_TLS` (`serve`, `self-signed` or
`off`; default `serve` when permitted, else `self-signed`, with Tailscale,
and `off` without it or with `ASTROTIME_WEB_HOST` set), `ASTROTIME_WEB_HOST`
(default `127.0.0.1`), `ASTROTIME_WEB_CLIENTS` (`tailnet`, set with a
front), `ASTROTIME_WEB_PORT` (default 5180), `ASTROTIME_WEB_HTTPS_PORT` (the
tailnet's https port, default the web port), `ASTROTIME_WEB_HTTPS_HOST` (the
self-signed front's address, default this machine's tailnet IPv4),
`ASTROTIME_DAV_PORT` (default 5232), `ASTROTIME_WEB_ALLOWED_HOSTS` (host
names Vite answers to besides IPs and localhost; default this machine's
name and `.ts.net`), `ASTROTIME_PROXY_ALLOW`, `ASTROTIME_DEV_DIR`.

`smoke.sh` runs the self-signed front on loopback (`ASTROTIME_WEB_TLS=self-signed`,
`ASTROTIME_WEB_HTTPS_HOST=127.0.0.1`), so CI proves the https path without
Tailscale; it never touches `tailscale serve`.

`shellcheck scripts/t3/*.sh` is clean (config in `.shellcheckrc`).
