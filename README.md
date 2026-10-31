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
reverse proxy for TLS, next to your Nextcloud.

## Development

```sh
direnv allow     # or: devenv shell — provides Node 24 and pnpm
pnpm install
vp dev apps/web  # the web app; CalDAV goes through its /dav-proxy/
vp check && vp run -r typecheck && vp test run
```

Contributors and agents start at [`AGENTS.md`](AGENTS.md).

## License

[AGPL-3.0](LICENSE).
