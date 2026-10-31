# Map of AstroTime

Everything AstroTime already has, one line each: an inch deep, a mile wide.
Read it before building anything, so you extend what exists instead of
building it again next to it ([reinvent the wheel](lore/reinvent-the-wheel.md)).
Each line routes to the place that knows the details; open that only when you
need it.

When you add a package, app or module, add its line here in the same PR.

## Shape

- **Local store first, sync behind it.** The UI reads and writes the local
  store; the sync engine reconciles it with servers. → `plans/foundation.md#D5`
- **Providers** bring calendars and tasks in; CalDAV is the first one.
  → `plans/foundation.md#D4`
- **One React UI** for every app; the apps are thin shells around it.
  → `plans/foundation.md#D22`

## Packages

- `packages/core` (`@astrotime/core`) — isomorphic domain core.
  - `CalendarObject` — parses one calendar object resource, reads its
    master and exceptions as `Event` or `Task`, and serializes it back
    without losing a property. → `plans/foundation.md#D7`, `plans/foundation.md#D34`
  - `occurrencesBetween` — expands a series into the occurrences that touch
    a range of days in the user's zone. → `plans/foundation.md#D33`
  - `ItemTime`, `wallClockOf` — the time model. → `plans/foundation.md#D31`
  - `layoutDay`, `layoutSpans`, `isAllDay` — where items go on the views:
    the all-day strip, the time grid, overlaps. → `plans/foundation.md#D42`
  - `mergeObjects` — the three-way merge of a refused write.
    → `plans/foundation.md#D6`
  - `Provider` — the interface every provider implements.
    → `plans/foundation.md#D37`
  - `test/fixtures/` — iCalendar as each client writes it.

- `packages/storage` (`@astrotime/storage`) — the local store.
  - `Store` — accounts, calendars, objects with pending local changes,
    conflicts; finds objects by date range. → `plans/foundation.md#D36`
  - `SqlDriver` and its drivers: `@astrotime/storage/node` (`node:sqlite`),
    `@astrotime/storage/web` (sqlite-wasm on OPFS in a worker).
    → `plans/foundation.md#D25`
  - `schema.ts` (Drizzle) and `migrations.ts` (`PRAGMA user_version`).
  - `test/store.contract.ts` — the store's behaviour, run on every driver.

- `packages/caldav` (`@astrotime/caldav`) — the CalDAV provider.
  - `CalDavProvider` — discovery (`/.well-known/caldav`), calendars,
    `sync-collection` with a full listing as fallback, multiget, writes with
    ETags. → `plans/foundation.md#D2`
  - `startLoginFlow` — Nextcloud Login Flow v2. → `plans/foundation.md#D19`
  - `fetchClient`, `HttpClient` — how it reaches servers on each platform.
  - `proxyHandler`, `throughProxy` — the CORS proxy and its URL space.
    → `plans/foundation.md#D39`
- `packages/sync` (`@astrotime/sync`) — `syncAccount`: the sync engine.
  → `plans/foundation.md#D37`
  - `test/servers.test.ts` — the provider and the engine against Radicale
    (every run) and Nextcloud (nightly, `ASTROTIME_NEXTCLOUD_*`).

`ui` is created by the PRs that first need them
(`plans/foundation.md#D23`, `plans/foundation.md#pr-plan`).

## Apps

- `apps/web` (`@astrotime/web`) — the web app, the first platform; a
  placeholder screen for now. → `plans/foundation.md#D12`
  - `dav-proxy.ts` — the CORS proxy in the dev server. → `plans/foundation.md#D39`,
    its rules beyond localhost `plans/foundation.md#D20`
  - `dev-clients.ts` — lets in only loopback and tailnet clients when the dev
    server listens beyond localhost. → `plans/foundation.md#D20`

- `apps/proxy` (`@astrotime/proxy`) — the web app's server in production:
  static files, `/healthz`, the CalDAV proxy; bundled into the Docker image
  (`Dockerfile`). → `plans/foundation.md#D40`

## Tooling

- `vite.config.ts` — Vite+ config: tests (`unit` in Node, `browser` in
  headless Chromium for `*.browser.test.ts`), format, lint (with the
  isomorphic rule for the core). → `plans/foundation.md#D21`
- `scripts/t3/` — `dev.sh` starts the web dev server and a local Radicale,
  `stop.sh` stops them, `smoke.sh` proves both. → `../scripts/t3/README.md`
- `scripts/docs.test.ts` — checks the context library's routes.
  → `README.md#how-knowledge-is-arranged`
- `.github/workflows/` — CI (with the image built and started), the nightly
  Nextcloud run, the release of the image on a `v*` tag, Claude review,
  `@claude`. → `plans/foundation.md#D27`, `plans/foundation.md#D41`
