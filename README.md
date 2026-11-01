# AstroTime

Your calendars and your tasks in one place, from your own server.

AstroTime is an open-source client that shows events and tasks together on
one time grid, the way Google Calendar shows Google Tasks — but over CalDAV,
so it works with Nextcloud, Radicale, Baïkal and other servers you control.
It is offline-first and has no backend of its own.

**Status:** early. Nothing usable yet; see the
[foundation plan](docs/plans/foundation.md) for what is coming and in which
order (web first, then Android and Linux).

## Self-hosting

The web app ships as one Docker image: the app itself and the small proxy it
needs to reach CalDAV servers from a browser (browsers block reading another
server's answers unless it allows it, and Nextcloud does not for CalDAV).
The proxy keeps nothing; your credentials pass through it.

```sh
docker run -d -p 8080:8080 \
  -e ASTROTIME_PROXY_ALLOW=https://cloud.example.com \
  ghcr.io/astroreen/astrotime:latest
```

`ASTROTIME_PROXY_ALLOW` is required: the comma-separated origins of the
CalDAV servers the proxy may reach. Put the container behind your usual
reverse proxy for TLS, next to your Nextcloud. The proxy serves the app's own
pages only and checks this by host, so the reverse proxy must pass the
original `Host`, port included, on (nginx: `proxy_set_header Host
$http_host;` — `$host` drops the port; Caddy and Traefik pass it by
default).

`ASTROTIME_PUBLIC_HOST` is optional: the comma-separated host names the
container answers for, such as `calendar.example.com` (any port) or
`calendar.example.com:8443` (that port only; browsers leave out 80 and 443,
so list those as the bare name), IPv6 in brackets (`[2001:db8::1]`). Any
other `Host` gets 421, which keeps DNS rebinding out even if the reverse
proxy answers for every name; `/healthz` answers whatever the `Host`, for
health checks. Unset, every host is served
([D81](docs/plans/foundation.md#D81)).

For one person's calendar, name the server and the user, and signing in
asks only for the password ([D123](docs/plans/foundation.md#D123)):

```sh
docker run -d -p 8080:8080 \
  -e ASTROTIME_SERVER_URL=https://cloud.example.com \
  -e ASTROTIME_USERNAME=astro \
  ghcr.io/astroreen/astrotime:latest
```

`ASTROTIME_SERVER_URL` is then the proxy's allowlist when
`ASTROTIME_PROXY_ALLOW` is unset (and must be on it when it is set);
`ASTROTIME_USERNAME` is optional. Both are shown to whoever opens the page:
never put a password there, and leave the user name out if the instance must
not say whose it is. Without them the app asks for the server, user name and
password, or opens Nextcloud's own sign-in; either way it first opens on a
calendar on the device, with no account
([D122](docs/plans/foundation.md#D122)).

The app installs as a web app on phones and desktops, and once loaded it
starts with no network ([D124](docs/plans/foundation.md#D124)); a new
version is offered with a quiet "Reload" after you update the container.

The container sends the app with a strict Content Security Policy and a
fresh nonce on every page ([D110](docs/plans/foundation.md#D110)). Let the
reverse proxy pass it on as it is and keep the page out of its cache: a policy
added there applies on top of this one, and a cached page would give everyone
the same nonce.

## Downloads

Each release on [GitHub Releases](https://github.com/Astroreen/AstroTime/releases)
carries the Linux and Android apps; the web app is the image above.

**Linux** (x64 and arm64):

- Debian and Ubuntu: `astrotime-<version>-amd64.deb` (or `-arm64.deb`),
  installed with `sudo apt install ./astrotime-<version>-amd64.deb`. It
  brings an AppArmor profile, so on Ubuntu 24.04 the app keeps Chromium's
  sandbox: prefer it there.
- Any distribution: `astrotime-<version>-x86_64.AppImage` (or
  `-arm64.AppImage`); make it executable and run it. It needs `libfuse2`
  (Ubuntu 24.04: `sudo apt install libfuse2t64`). Where the system keeps
  user namespaces from it, as Ubuntu 24.04 does, it starts without
  Chromium's sandbox ([D78](docs/plans/desktop.md#D78)).

**Android:** `astrotime-<version>-unsigned.apk` is not signed yet, so
Android does not install it as it is; sign it with a key of your own
(`apksigner sign`) to try it. Signed releases come later
([D69](docs/plans/android.md#D69)).

## Development

```sh
direnv allow     # or: devenv shell — provides Node 24 and pnpm
pnpm install
vp dev apps/web  # the web app; CalDAV goes through its /dav-proxy/
vp check && vp run -r typecheck && vp test run
```

The Android app's debug APK (the dev shell has the SDK and JDK 21):

```sh
vp run --filter @astrotime/mobile build && pnpm --filter @astrotime/mobile sync
(cd apps/mobile/android && ./gradlew assembleDebug test)
```

Or everything at once (the dev server and a local CalDAV server):
`scripts/t3/dev.sh`, stopped with `scripts/t3/stop.sh`
([details](scripts/t3/README.md)).

Contributors and agents start at [`AGENTS.md`](AGENTS.md).

## License

[AGPL-3.0](LICENSE).
