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

The container sends the app with a strict Content Security Policy and a
fresh nonce on every page ([D110](docs/plans/foundation.md#D110)). Let the
reverse proxy pass it on as it is and keep the page out of its cache: a policy
added there applies on top of this one, and a cached page would give everyone
the same nonce.

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
