# Dev scripts

One command to start everything for development, one to stop it, after
Jhin's `scripts/t3`. T3 Code's project actions call them. They need bash 5.1
and curl; outside the devenv shell they enter it themselves (`devenv shell`),
or use Node 24 and pnpm already on PATH.

| Script     | What it does                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `dev.sh`   | the web app's Vite dev server on port 5180 (with its CalDAV proxy), and a local Radicale when there is one        |
| `stop.sh`  | stops what `dev.sh` started and returns once all of it has exited (SIGKILL after 10 s)                            |
| `smoke.sh` | starts `dev.sh`, checks the page and the proxy, that a second start is refused, and a clean `stop.sh`; CI runs it |

`dev.sh` prints what to open:

    astrotime: open http://127.0.0.1:5180
    astrotime: on your tailnet http://100.x.y.z:5180 (or http://<this machine>:5180)
    astrotime: local CalDAV at http://127.0.0.1:5232/ (user astro, password astro)

The local Radicale (from the devenv shell) keeps its data in
`.astrotime-dev/radicale` (gitignored), with a calendar `personal` made on the
first start. Radicale listens on 127.0.0.1 only; other devices reach it
through the dev proxy.

With Tailscale (`tailscale ip` answers), the web app listens on every
interface but lets in only this machine and tailnet devices (100.64.0.0/10,
fd7a:115c:a1e0::/48; `apps/web/dev-clients.ts`), so it opens from your other
devices and not from the rest of a LAN or a café's Wi-Fi: anyone who reached
it could use the local Radicale with its published password. Without
Tailscale it listens on 127.0.0.1. `ASTROTIME_WEB_HOST=0.0.0.0` opens it to
every network, with no client check. Beyond localhost the dev proxy reaches
only the servers in `ASTROTIME_PROXY_ALLOW` (comma-separated origins);
`dev.sh` adds the local Radicale. To use your own Nextcloud from there:

    ASTROTIME_PROXY_ALLOW=https://cloud.example.com bash scripts/t3/dev.sh

In T3 Code: a project action running `scripts/t3/dev.sh`, the preview URL
`http://127.0.0.1:5180`, and an action running `scripts/t3/stop.sh`.

Environment overrides: `ASTROTIME_WEB_HOST` (default `0.0.0.0` for the tailnet
with Tailscale, else `127.0.0.1`), `ASTROTIME_WEB_CLIENTS` (`tailnet`, set with
that default), `ASTROTIME_WEB_PORT` (default 5180),
`ASTROTIME_DAV_PORT` (default 5232), `ASTROTIME_WEB_ALLOWED_HOSTS` (host names
Vite answers to besides IPs and localhost; default this machine's name and
`.ts.net`), `ASTROTIME_PROXY_ALLOW`, `ASTROTIME_DEV_DIR`.

`shellcheck scripts/t3/*.sh` is clean (config in `.shellcheckrc`).
