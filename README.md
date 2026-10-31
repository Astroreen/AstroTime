# AstroTime

Your calendars and your tasks in one place, from your own server.

AstroTime is an open-source client that shows events and tasks together on
one time grid, the way Google Calendar shows Google Tasks — but over CalDAV,
so it works with Nextcloud, Radicale, Baïkal and other servers you control.
It is offline-first and has no backend of its own.

**Status:** early. Nothing usable yet; see the
[foundation plan](docs/plans/foundation.md) for what is coming and in which
order (web first, then Android and Linux).

## Development

```sh
direnv allow     # or: devenv shell — provides Node 24 and pnpm
pnpm install
vp dev apps/web  # the web app
vp check && vp run -r typecheck && vp test run
```

Contributors and agents start at [`AGENTS.md`](AGENTS.md).

## License

[AGPL-3.0](LICENSE).
