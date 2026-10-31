# Dev scripts

One command to start everything for development, one to stop it, after
Jhin's `scripts/t3`. T3 Code's project actions call them. They need bash 5.1
and curl; outside the devenv shell they enter it themselves (`devenv shell`),
or use Node 24 and pnpm already on PATH.

| Script     | What it does                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `dev.sh`   | the web app's Vite dev server on `http://127.0.0.1:5180` (with its CalDAV proxy), and a local Radicale when there is one |
| `stop.sh`  | stops what `dev.sh` started and returns once all of it has exited (SIGKILL after 10 s)                                   |
| `smoke.sh` | starts `dev.sh`, checks the page and the proxy, that a second start is refused, and a clean `stop.sh`; CI runs it        |

`dev.sh` prints what to open:

    astrotime: open http://127.0.0.1:5180
    astrotime: local CalDAV at http://127.0.0.1:5232/ (user astro, password astro)

The local Radicale (from the devenv shell) keeps its data in
`.astrotime-dev/radicale` (gitignored), with a calendar `personal` made on the
first start. Everything listens on 127.0.0.1 only.

In T3 Code: a project action running `scripts/t3/dev.sh`, the preview URL
`http://127.0.0.1:5180`, and an action running `scripts/t3/stop.sh`.

Environment overrides: `ASTROTIME_WEB_PORT` (default 5180),
`ASTROTIME_DAV_PORT` (default 5232), `ASTROTIME_DEV_DIR`.

`shellcheck scripts/t3/*.sh` is clean (config in `.shellcheckrc`).
