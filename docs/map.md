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
  - `layoutDay`, `layoutSpans`, `isAllDay`, `dayRange` — where items go on
    the views: the all-day strip, the time grid, overlaps, a month's weeks.
    → `plans/foundation.md#D42`
  - `isDone`, `isUndoneBefore`, `latestUndoneBefore` — done tasks, and the
    undone ones that roll over to today. → `plans/design.md#D51`,
    `plans/foundation.md#D55`
  - `completeTask`, `starTask` — the tasks screen's two edits, a series'
    occurrence through its exception, nothing else changed.
    → `plans/design.md#D94`
  - `remindersOf`, `soonestReminders` — the times an object's alarms fire,
    and the reminder set a platform is handed; `ReminderScheduler`, how a
    platform shows them. → `plans/foundation.md#D100`, `plans/android.md#D60`
  - `mergeObjects` — the three-way merge of a refused write.
    → `plans/foundation.md#D6`
  - `Provider` — the interface every provider implements.
    → `plans/foundation.md#D37`
  - `SecretStore` — where a platform keeps credentials, never the store.
    → `plans/android.md#D60`
  - `test/fixtures/` — iCalendar as each client writes it; where each file
    comes from: [`README.md`](../packages/core/test/fixtures/README.md).

- `packages/storage` (`@astrotime/storage`) — the local store.
  - `Store` — accounts (with the calendar home discovery found, migration 5),
    calendars, objects with pending local changes, conflicts; finds objects
    by date range. → `plans/foundation.md#D36`, `plans/foundation.md#D90`
    - `subscribe` — hears every write, for live queries.
      → `plans/foundation.md#D54`
    - `undoneTasksBefore` — the undone tasks due before today.
      → `plans/foundation.md#D55`
    - `tasks` — every task of some calendars: the tasks screen's lists.
      → `plans/design.md#D95`
    - `search` — objects by title, case and diacritics aside, over the
      folded `titles` column (`search.ts`, migration 6).
      → `plans/design.md#D97`
    - every operation that writes is a transaction.
      → `plans/foundation.md#D99`
    - `reminders` — every calendar's reminders in a range of days.
      → `plans/foundation.md#D100`
  - `SqlDriver` and its drivers: `@astrotime/storage/node` (`node:sqlite`),
    `@astrotime/storage/web` (sqlite-wasm on OPFS in a worker).
    → `plans/foundation.md#D25`
    - `subscribe` — tells the store of writes made elsewhere.
  - `web/` — every tab on one store: the leader tab's worker (`worker.ts`)
    runs every tab's statements, one tab's transaction at a time
    (`serving.ts`), the drivers (`index.ts`) follow it and take over when it
    goes (`protocol.ts`); `HandOverError` when a statement's answer went
    with it, `CommitInDoubtError` when a COMMIT's did.
    → `plans/foundation.md#D98`, `plans/foundation.md#D99`
  - `schema.ts` (Drizzle) and `migrations.ts` (`PRAGMA user_version`).
  - `test/store.contract.ts` — the store's behaviour, run on every driver.

- `packages/caldav` (`@astrotime/caldav`) — the CalDAV provider.
  - `CalDavProvider` — discovery (`/.well-known/caldav`), calendars,
    `sync-collection` with a full listing as fallback, multiget, writes with
    ETags. → `plans/foundation.md#D2`
  - `startLoginFlow` — Nextcloud Login Flow v2. → `plans/foundation.md#D19`
  - `fetchClient`, `HttpClient` — how it reaches servers on each platform.
  - `proxyHandler`, `throughProxy` — the CORS proxy and its URL space; its
    own refusals come to the app as `ProxyRefusedError`.
    → `plans/foundation.md#D39`, `plans/foundation.md#D92`
  - `NoCalendarHomeError` — an address that answers but is no CalDAV server.
- `packages/sync` (`@astrotime/sync`) — `syncAccount`: the sync engine.
  → `plans/foundation.md#D37`
  - `syncAll` — the one sync entry every shell calls: every account, joins
    a running sync, waits for another tab's (`SyncLock`, D91);
    `connectCalDav` opens an account's provider; `saveAccount`,
    `removeAccount` keep an account with its credentials.
    → `plans/foundation.md#D90`
  - `test/servers.test.ts` — the provider and the engine against Radicale
    (every run) and Nextcloud (nightly, `ASTROTIME_NEXTCLOUD_*`), with a
    Login Flow v2 approved in Chromium on Nextcloud's own pages.

- `packages/ui` (`@astrotime/ui`) — the React UI every app renders.
  → `plans/foundation.md#D22`
  - `AstroTime` — the root: the app gives it its `Platform` (the store,
    HTTP, secrets, `openExternal`, `Preferences`, reminders), the user's
    languages and zone. → `plans/android.md#D60`
  - `accounts/` — signing in (`SignIn`: password, Login Flow v2) and when
    the UI syncs (`SyncScheduler`). → `plans/foundation.md#D91`,
    `plans/foundation.md#D92`
  - `components/` — the shell (top bar, month picker, drawer, floating
    button), the time grid of Day, 3 days and Week with the all-day strip
    and the undone tasks chip, the Month (`month-view.tsx`,
    `plans/design.md#D86`) and the Agenda (`agenda-view.tsx`,
    `plans/design.md#D87`). → `plans/design.md#D46`
    - `accounts.tsx`, `sign-in-dialog.tsx`, `remove-account.tsx` — the
      account button and dialog, each account in the drawer, the sync
      status, the first-run screen, adding and removing an account.
      → `plans/foundation.md#D92`
    - `tasks-screen.tsx` — the tasks screen, or panel on a wide screen.
      → `plans/design.md#D95`
    - `search.tsx` — the search field and its results.
      → `plans/design.md#D97`
    - `settings-section.tsx` — the drawer's settings.
      → `plans/design.md#D96`
  - `calendar/` — the views and their keys (`views.ts`), days, the locale's
    week and clock (`locale.ts`), `Intl` formats, the query path to the
    layout (`query.ts`, `ObjectCache`), the month's weeks and their folding
    (`month.ts`), the Agenda's days (`agenda.ts`) and `liveQuery`.
    → `plans/foundation.md#D54`
    - `tasks.ts` — the store's tasks as the tasks screen's lists: sorted,
      subtasks under parents, a series by its current occurrence.
      → `plans/design.md#D95`
  - `hooks.ts` — `useEntries` (a view's live query of a range of days),
    `useSwipe`, `useNow`, `useMediaQuery`.
  - `settings.ts` — the drawer's settings, kept in the preferences and
    applied over the locale. → `plans/design.md#D96`
  - `reminders/` — `ReminderPlanner` (when the reminder set goes to the
    platform) and `reminderNotification` (its words);
    `components/reminders-context.tsx` and `reminders-switch.tsx`, the
    "Reminders" setting in the drawer and a tapped reminder opening its day.
    → `plans/foundation.md#D101`, `plans/foundation.md#D102`
  - `i18n/` — i18next and the English and Russian catalogs.
    → `plans/foundation.md#D17`
  - `styles.css` — the theme's tokens, dark and light.
    → `plans/design.md#D58`
  - `demo/` (`@astrotime/ui/demo`) — demo data around today, for the dev
    server, tests and screenshots. → `plans/foundation.md#D57`

## Apps

- `apps/web` (`@astrotime/web`) — the web app, the first platform: its
  `Platform` (`src/platform.ts`: the web store, HTTP through the proxy,
  credentials, a new tab for Login Flow, preferences in localStorage, a
  Web Lock so the tabs sync one at a time, `plans/foundation.md#D91`,
  reminders) and
  the browser's languages around `@astrotime/ui` (`src/main.tsx`); `?demo`
  in the dev server loads the demo data. → `plans/foundation.md#D12`
  - `src/secrets.ts` — credentials in IndexedDB under a key the page cannot
    export. → `plans/foundation.md#D89`
  - `src/reminders.ts` — `webReminders`: notifications while the app is open,
    from the one tab holding the `astrotime-reminders` Web Lock.
    → `plans/foundation.md#D101`
  - `e2e/` — Playwright against the dev server on the demo data with a
    frozen clock; `screenshots.spec.ts` takes a UI PR's evidence
    (`ASTROTIME_SCREENSHOTS`). → `plans/foundation.md#D57`;
    `accounts.spec.ts` signs in to a real Radicale (the one
    `packages/sync/test/servers.ts` starts), `accounts-screenshots.spec.ts`
    takes the accounts' evidence. → `plans/foundation.md#D92`;
    `reminders.spec.ts` moves `page.clock` and sees notifications through a
    wrapped `Notification` (`captureNotifications`). → `plans/foundation.md#D101`
  - `e2e/built/` — the production build on the image's server, under its
    Content Security Policy, with no violation. → `plans/foundation.md#D110`
  - `dav-proxy.ts` — the CORS proxy in the dev server. → `plans/foundation.md#D39`,
    its rules beyond localhost `plans/foundation.md#D20`
  - `dev-clients.ts` — lets in only loopback and tailnet clients when the dev
    server listens beyond localhost. → `plans/foundation.md#D20`
  - `dev-tls.ts` — the dev server's https front for the tailnet with a
    self-signed certificate, when `tailscale serve` may not run.
    → `plans/foundation.md#D20`

- `apps/proxy` (`@astrotime/proxy`) — the web app's server in production:
  static files, `/healthz`, the CalDAV proxy, the Host allowlist, the
  Content Security Policy with a nonce per answer; bundled into the Docker
  image (`Dockerfile`). → `plans/foundation.md#D40`, `#D81`, `#D110`
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
