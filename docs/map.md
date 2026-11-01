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
  → `plans/foundation.md#D22`; what each shell hands the UI (HTTP, SQLite,
  secrets, reminders, sync triggers) → `plans/android.md#D60`

## Packages

- `packages/core` (`@astrotime/core`) — isomorphic domain core.
  - `CalendarObject` — parses one calendar object resource, reads its
    master and exceptions as `Event` or `Task`, and serializes it back
    without losing a property. → `plans/foundation.md#D7`, `plans/foundation.md#D34`
  - `occurrencesBetween` — expands a series into the occurrences that touch
    a range of days in the user's zone. → `plans/foundation.md#D33`
  - `ItemTime`, `wallClockOf` — the time model. → `plans/foundation.md#D31`
  - `windows-zones.ts` — Windows zone name → IANA, generated from Unicode
    CLDR by `scripts/generate-windows-zones.ts`; do not edit by hand.
    → `plans/foundation.md#D32`
  - `layoutDay`, `layoutSpans`, `isAllDay` — where items go on the views:
    the all-day strip, the time grid, overlaps. → `plans/foundation.md#D42`
  - `isDone`, `isUndoneBefore`, `latestUndoneBefore` — done tasks, and the
    undone ones that roll over to today. → `plans/design.md#D51`,
    `plans/foundation.md#D55`
  - `mergeObjects` — the three-way merge of a refused write.
    → `plans/foundation.md#D6`
  - `Provider` — the interface every provider implements.
    → `plans/foundation.md#D37`
  - `test/fixtures/` — iCalendar as each client writes it; where each file
    comes from: [`README.md`](../packages/core/test/fixtures/README.md).

- `packages/storage` (`@astrotime/storage`) — the local store.
  - `Store` — accounts, calendars, objects with pending local changes,
    conflicts; finds objects by date range. → `plans/foundation.md#D36`
    - `subscribe` — hears every write, for live queries.
      → `plans/foundation.md#D54`
    - `undoneTasksBefore` — the undone tasks due before today.
      → `plans/foundation.md#D55`
  - `StoreInUseError` — another tab holds the web store.
    → `plans/foundation.md#D56`
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
    (every run) and Nextcloud (nightly, `ASTROTIME_NEXTCLOUD_*`), with a
    Login Flow v2 approved in Chromium on Nextcloud's own pages.

- `packages/ui` (`@astrotime/ui`) — the React UI every app renders.
  → `plans/foundation.md#D22`
  - `AstroTime` — the root: the app gives it its store (opening), where
    preferences are kept (`Preferences`), the user's languages and zone.
  - `components/` — the shell (top bar, month picker, drawer, floating
    button) and the time grid of Day, 3 days and Week with the all-day
    strip and the undone tasks chip. → `plans/design.md#D46`
  - `calendar/` — the views (`views.ts`), days, the locale's week and clock
    (`locale.ts`), `Intl` formats, the query path to the layout
    (`query.ts`, `ObjectCache`) and `liveQuery`. → `plans/foundation.md#D54`
  - `i18n/` — i18next and the English and Russian catalogs.
    → `plans/foundation.md#D17`
  - `styles.css` — the theme's tokens, dark and light.
    → `plans/design.md#D58`
  - `demo/` (`@astrotime/ui/demo`) — demo data around today, for the dev
    server, tests and screenshots. → `plans/foundation.md#D57`

## Apps

- `apps/web` (`@astrotime/web`) — the web app, the first platform: the web
  store, preferences in localStorage and the browser's languages around
  `@astrotime/ui` (`src/main.tsx`); `?demo` in the dev server loads the demo
  data. → `plans/foundation.md#D12`
  - `e2e/` — Playwright against the dev server on the demo data with a
    frozen clock; `screenshots.spec.ts` takes a UI PR's evidence
    (`ASTROTIME_SCREENSHOTS`). → `plans/foundation.md#D57`
  - `dav-proxy.ts` — the CORS proxy in the dev server. → `plans/foundation.md#D39`,
    its rules beyond localhost `plans/foundation.md#D20`
  - `dev-clients.ts` — lets in only loopback and tailnet clients when the dev
    server listens beyond localhost. → `plans/foundation.md#D20`
  - `dev-tls.ts` — the dev server's https front for the tailnet with a
    self-signed certificate, when `tailscale serve` may not run.
    → `plans/foundation.md#D20`

- `apps/proxy` (`@astrotime/proxy`) — the web app's server in production:
  static files, `/healthz`, the CalDAV proxy, the Host allowlist; bundled
  into the Docker image (`Dockerfile`). → `plans/foundation.md#D40`, `#D81`
  - `compress.ts` — precompresses the built app (brotli, gzip) when the image
    is built. → `plans/foundation.md#D80`

## Tooling

- `vite.config.ts` — Vite+ config: tests (`unit` in Node, `browser` in
  headless Chromium for `*.browser.test.ts`), format, lint (with the
  isomorphic rule for the core). → `plans/foundation.md#D21`
- `apps/web/playwright.config.ts` — the end-to-end tests
  (`pnpm --filter @astrotime/web e2e`). → `plans/foundation.md#D57`
- `scripts/t3/` — `dev.sh` starts the web dev server and a local Radicale,
  `stop.sh` stops them, `smoke.sh` proves both. → `../scripts/t3/README.md`
- `scripts/docs.test.ts` — checks the context library's routes.
  → `README.md#how-knowledge-is-arranged`
- `scripts/generate-windows-zones.ts` — fetches a pinned Unicode CLDR
  `windowsZones.xml` and writes `packages/core/src/windows-zones.ts`.
  → `plans/foundation.md#D32`
- `scripts/record-nextcloud-fixtures.ts` — drives Nextcloud's web Calendar
  and Tasks apps in Chromium on a disposable Nextcloud in Docker and records
  what they write as `packages/core/test/fixtures/nextcloud-web-*.ics`.
- `.github/workflows/` — CI (with the image built and started), the nightly
  Nextcloud run, the release of the image on a `v*` tag, Claude review,
  `@claude`. → `plans/foundation.md#D27`, `plans/foundation.md#D41`
