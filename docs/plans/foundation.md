# Foundation plan

Status: **in progress** — PR 1 lands the docs and the skeleton; the MVP is
PRs 2–7. This file records every decision taken while designing AstroTime,
everything explicitly deferred, and the PR-by-PR plan with acceptance
criteria. The decisions were reached in
[`../grilling/2026-10-31-foundation.md`](../grilling/2026-10-31-foundation.md).

## Goal

There is no good-looking, open-source client that shows calendars and tasks
together and works with your own server. AstroTime is that client: events and
tasks from a CalDAV server (Nextcloud first) on one time grid, offline-first,
on the web, Android and Linux. Google Calendar and Google Tasks are the
references for behaviour; open-source clients (Nextcloud Calendar and Tasks,
Thunderbird, DAVx5, jtx Board, Tasks.org) are the references for protocol
logic worth borrowing.

## Decisions

### Product scope

- **D1. One client for events and tasks.** Events (`VEVENT`) and tasks
  (`VTODO`) appear on the same views; neither is a second-class add-on.
- **D2. Generic CalDAV, Nextcloud first.** The protocol layer is a standard
  CalDAV client: RFC 4791 (CalDAV), RFC 5545 (iCalendar), RFC 6578
  (sync-collection), RFC 6764 (discovery). Nextcloud is the main test target,
  not the only one; Radicale, Baïkal, iCloud and Fastmail should work.
- **D3. No backend of our own.** No accounts, no registration, no analytics.
  Data lives on the user's server and in the local store. The only server
  piece is the stateless web proxy ([D20](#D20)).
- **D4. Providers behind one interface.** CalDAV is the first provider.
  Google (Calendar API + Tasks API over OAuth, since Google Tasks has no
  CalDAV) and the phone's system calendars are later providers
  ([Deferred](#deferred)).

### Sync

- **D5. Offline-first.** The local store is the UI's source of truth. The
  sync engine reconciles it with servers in the background: `sync-collection`
  with a sync token where the server supports it, ETag comparison otherwise;
  writes carry `If-Match`.
- **D6. Conflicts.** When a write is refused (`412 Precondition Failed`), the
  engine fetches the server's version and merges field by field when the two
  sides changed different properties. When both changed the same property,
  the server wins and our version goes to the **Conflicts** list, from which
  the user can apply it again.

### Protocol and data

- **D7. The whole protocol, lossless.** The data layer parses and keeps
  everything in `VEVENT`, `VTODO`, `VALARM` and `VTIMEZONE`, including
  properties and parameters it does not understand (`X-*`, other clients'
  extensions such as `X-APPLE-SORT-ORDER`, `X-OC-HIDESUBTASKS`). An item is
  written back unchanged except for what the user changed. The UI exposes a
  subset that grows over time ([D9](#D9), [D10](#D10)).
- **D8. ical.js for iCalendar.** Parsing, time zones and recurrence
  expansion use Mozilla's `ical.js` (also used by Nextcloud Calendar),
  wrapped in `@astrotime/core` so it can be replaced. No parser of our own.
- **D9. Events in the MVP UI:** create, edit, delete; all-day and timed;
  recurrence with exceptions (`RRULE`, `EXDATE`, `RECURRENCE-ID`); time
  zones; reminders (`VALARM`) as local notifications; attendees shown, not
  sent (no iTIP).
- **D10. Tasks in the MVP: the full VTODO.** Summary, description,
  `DTSTART`, `DUE`, status and completion, `PERCENT-COMPLETE`, `PRIORITY`,
  `CATEGORIES`, subtasks (`RELATED-TO`), recurrence, reminders, `CLASS`, and
  the Nextcloud/Apple extensions for ordering and hidden subtasks.
- **D11. Editing an occurrence asks the scope**, as Google does: "This
  occurrence / This and following / All occurrences".

### Platforms

- **D12. Platform order: web → Android → Linux → Windows.** The web app comes
  first because development and design review happen in a browser preview.
  Android follows (Capacitor), then Linux desktop (Electron). Windows is a
  by-product of the desktop build, checked last if at all. **iOS and macOS
  are out of scope** (no Mac to build on).

### Calendar UI

- **D13. Views: Day, 3 days, Week, Month, Agenda.** The Year view is
  deferred. _Changed by the design plan ([D48](design.md#D48)): the grilling
  deferred the 3-day view too; the owner's reference uses it._
- **D14. Google-style layout.** All-day items sit in the all-day strip,
  pinned above the time grid so they stay visible while the day scrolls.
  Timed items sit in the time grid. Items can be dragged to another time and
  resized; a click opens their details, with an edit action.
- **D15. Overlaps cascade.** Overlapping timed items form a cluster. In a
  cluster the item that starts earlier and lasts longer is wider and below;
  an item that starts later or is shorter is drawn on top, shifted right and
  narrower. When more than three or four items overlap at once, the cluster
  switches to equal-width columns.
- **D16. Where a task goes.**
  - Only `DUE` with a time: a chip at the due time (drawn about
    30 minutes tall); dragging it moves `DUE`.
  - `DTSTART` and `DUE`: a block from start to due, like an event; resizing
    moves either end.
  - `DUE` with a date only: the all-day strip of that day.
  - No date: the tasks screen only (design D52).
  - Completed tasks stay visible, struck through and dimmed, with a "hide
    completed" toggle.
  - Overdue tasks roll over to today.
    _Changed by the design plan ([D50](design.md#D50), [D51](design.md#D51)):
    all-day items, and tasks not drawn as blocks, are one-line chips; completed tasks
    are struck through and muted; the roll-over is one "N undone tasks" chip
    on today; "hide completed" lives in the drawer's settings._
- **D17. English and Russian from the first screen.** Every UI string goes
  through an i18n library (Lingui or i18next, chosen in PR 5); no strings in
  code.
- **D18. The visual design is decided later**, in its own plan, before
  PR 5. Until then UI work is structure and behaviour. _Decided:_ the
  [design plan](design.md), from Google Calendar's Android app.

### Accounts and connectivity

- **D19. Signing in.** Two ways, both in the MVP:
  - **Nextcloud Login Flow v2**: the user enters the server address, approves
    access on Nextcloud's page, and AstroTime receives an app password; the
    user never copies one.
  - **Any CalDAV server**: address, user name and password; the CalDAV home
    is found through `/.well-known/caldav` (RFC 6764).

  Credentials stay on the device: IndexedDB on the web, the Android Keystore
  on Android.

- **D20. CORS on the web.** A browser may not read responses from another
  origin unless that server allows it, and Nextcloud does not allow it for
  CalDAV. (Native apps and our Android and Electron shells are not
  browsers and are not affected.) So:
  - in development, the Vite dev server proxies CalDAV requests. Reached
    from beyond localhost (the owner's devices on their tailnet,
    `scripts/t3/README.md`), it lets in loopback and tailnet clients only
    and proxies only to `ASTROTIME_PROXY_ALLOW`'s servers, since the local
    Radicale's password is published;
  - in production, the web app ships as **one Docker image** that serves the
    static app and proxies `/dav/*` to the user's server. The proxy keeps no
    state: credentials come from the client and are passed through. An
    allowlist of target servers (an environment variable) keeps it from being
    an open proxy. The image is published to GHCR.

### Stack

- **D21. Jhin's stack, without its plugin system.** pnpm workspaces with a
  catalog, Vite+ (`vp`) for tasks, tests, format and lint; Node 24;
  TypeScript 7; React 19 with the React Compiler; Tailwind 4; Base UI; Zod;
  Vitest; Playwright; oxlint; knip; devenv with direnv.
- **D22. One React UI, thin shells.** Mobile (Android) is **Capacitor**; desktop is **Electron**; the web is plain Vite. Native
  needs (HTTP without CORS, secure storage, notifications, background sync,
  system calendars) go through Capacitor plugins or Electron's main process,
  behind interfaces the core defines.
- **D23. Monorepo layout.**
  - `apps/web`, `apps/mobile` (Capacitor), `apps/desktop` (Electron),
    `apps/proxy` (the web proxy, [D20](#D20));
  - `packages/core` (model, iCalendar, recurrence, sync engine),
    `packages/caldav` (the CalDAV provider), `packages/storage` (local store
    adapters), `packages/ui` (shared components).

  An app or package is created by the PR that first needs it.

- **D24. The core is isomorphic** (AGENTS.md rule 1): `core` and `caldav`
  have no Node or DOM dependencies, enforced by oxlint and `types: []`.
- **D25. SQLite everywhere, through Drizzle.** One schema and one query
  layer (Drizzle's `sqlite-proxy`) over a small `SqlDriver` per platform:
  - web: the official `@sqlite.org/sqlite-wasm` in a worker, on OPFS through
    the `opfs-sahpool` VFS, which needs no cross-origin isolation headers;
  - Electron and tests: `node:sqlite`, built into Node 24, so no native
    module to rebuild;
  - Android: `@capacitor-community/sqlite`.

  _Changed in PR 3:_ the grilling named wa-sqlite and better-sqlite3; the
  official build and Node's own SQLite do the same with fewer moving parts.

- **D36. The store holds only valid objects.** Every write parses the
  iCalendar with `@astrotime/core` and indexes it by `boundsOf`; a range
  query returns candidates for `occurrencesBetween` to place exactly. Local
  changes carry `pending` (`create`, `update`, `delete`) for the sync engine;
  credentials are not in the store ([D19](#D19)). An object a server serves
  that does not parse is refused by the store; the sync engine skips it,
  counts it in its report and leaves it on the server untouched (PR 4).

### Process

- **D26. Docs follow Jhin's context library** (`../README.md`): a trailhead,
  a map, a glossary, plans with numbered decisions and Deferred sections,
  lore. From Caspian Logistics: dated grilling sessions in `docs/grilling/`.
- **D27. CI on GitHub-hosted runners**, as in Jhin: format and lint,
  typecheck, unit tests, knip, and one aggregate `CI` status for branch
  protection. Integration tests against Radicale run on every PR from PR 4;
  a nightly job runs them against a real Nextcloud. Claude reviews every PR
  and answers `@claude`. Dependabot updates the actions, which are pinned to
  commit SHAs.
- **D28. Releases on a `v*` tag:** the web Docker image to GHCR and an
  Android APK to GitHub Releases (unsigned at first); the desktop build
  joins when it exists.
- **D29. License: AGPL-3.0.** The web app is meant to be self-hosted; a
  modified hosted copy must share its code. It matches Nextcloud's license.
- **D30. Repository and branches.** `Astroreen/AstroTime`, public. `main` is
  protected: the `CI` status is required, no direct or force pushes. One
  branch per PR; Conventional Commits.

### The core's time model

Decided while building PR 2.

- **D31. Three kinds of time.** An `ItemTime` is a `date` (all-day), a
  `floating` wall clock (the same in every zone), or a `zoned` wall clock
  with its IANA zone and the instant it names. Instants are never stored
  without the wall clock and zone they came from.
- **D32. A TZID without a VTIMEZONE is an IANA or a Windows name.** ical.js
  resolves zones the object defines; a TZID it does not define is tried in
  this order: an IANA name (Google, some Android clients), resolved through
  `Intl`, following RFC 5545 for DST gaps (the offset before the gap) and
  repeats (the earlier instant); then a Windows zone name (Outlook,
  Exchange: `W. Europe Standard Time`), mapped to IANA by Unicode CLDR's
  `windowsZones.xml`, the `territory="001"` row of each name, compared
  without regard to case and surrounding spaces, and spelled as IANA names
  the zone today (CLDR keeps old spellings such as `Asia/Calcutta`; its
  `bcp47/timezone.xml` gives `Asia/Kolkata`). A TZID none of these knows stays floating. The
  table is generated, not written by hand (`scripts/generate-windows-zones.ts`
  pins a CLDR release). For a mapped name `ItemTime.timeZone` is the IANA
  zone; the TZID as read stays in the calendar object, so `serialize` writes
  it back unchanged (rule 2). A zone the object defines keeps its TZID as
  `timeZone` even when it is a Windows name.
- **D33. Occurrences are placed in the user's zone.** `occurrencesBetween`
  takes days and the IANA zone the calendar is shown in; a zoned item shows
  on the user's day, a floating one at the same wall clock everywhere. A
  series keeps its wall-clock time and length across DST changes.
- **D34. A calendar object is one UID.** A `VCALENDAR` mixing UIDs, or events
  with tasks, or with two masters, is refused (RFC 4791 §4.1); exceptions
  without their master are kept and shown. A component without a UID is
  refused.
- **D35. Exceptions, leniently.** A `STATUS:CANCELLED` exception removes
  its occurrence, as Google shows it. A `RECURRENCE-ID` written as another
  kind of time than the series' start (a date for a zoned series, a floating
  time for a zoned one) matches by wall clock, or by day when one side is a
  date.

### Sync

- **D38. Who wins a deletion.** A calendar or an object deleted on the
  server is deleted here, with any pending change to it; a calendar that
  merely went missing from a listing while it holds unsent changes stays,
  reported, until a listing without it finds it has none. In a read-only
  calendar a deletion of ours comes back, reported. A deletion of ours
  the server refuses because the object changed there is dropped: the object
  comes back as the server has it. An edit of an object deleted on this
  device before the deletion is uploaded revives it as an update. Otherwise
  the store never lets the
  server's version overwrite a pending local change; the sync engine (PR 4)
  is the one place that applies these rules.

Decided while building PR 4.

- **D37. The sync engine is its own package.** `@astrotime/sync` reconciles
  the store with any `Provider` (the interface lives in `@astrotime/core`);
  `@astrotime/caldav` implements it and knows nothing of the store. One sync
  replaces the account's calendar list, then per calendar uploads pending
  changes first and downloads the server's changes after, so a refused write
  is merged before anything comes down. A refused write is merged three ways
  against the object's **base** (the server's version the change started
  from, kept by the store) and tried once more; refused again, or edited on
  this device meanwhile, it waits for the next sync. Properties that hold a
  set (`EXDATE`, `CATEGORIES`, `ATTENDEE`…) combine both sides' additions and
  removals instead of conflicting, and a VTIMEZONE our side uses comes along.
  A failure of one object (or one calendar's download) is reported in the
  sync's `errors` and the rest goes on; only `OfflineError` and `AuthError`
  stop a sync. A creation the server has no place for stays pending; one
  that finds its href taken is recognised if the server holds our own
  version (an upload whose answer was lost), and otherwise goes to the
  Conflicts list with the server's version kept. A write against an
  object the server last answered without an ETag first fetches it: if it
  is still our change's base, the write goes against the ETag it has now;
  if it changed, our change is merged as for a refused write; if it is gone,
  D38 applies. A refused write with no base keeps the server's version and
  lists ours as a conflict, unless both are the same. In a read-only
  calendar a pending edit gives way at once: the server's version comes back
  and ours goes to the Conflicts list; a new item there waits, reported,
  until the calendar is writable. An object a multiget leaves out is fetched
  on its own; one that still cannot be read keeps no sync token, so the next
  sync lists everything again. The time of an item (`DTSTART`, `DTEND`,
  `DURATION`, `DUE`) is one field, and an attendee is identified by their
  address, so changing their answer on one side is no duplicate. The report names the pending changes a server deletion
  dropped, and an interrupted sync's error carries its report so far. An
  edit made while a sync runs is never undone by that sync: a deletion or a
  taken href it learns of leaves the newer edit pending for the next one.
  Through the web proxy, a server it cannot reach is offline, like no answer. The report's
  `errors` carry a `problem` code the UI words in the user's language
  (`read-only`, `deletion-reverted`, `no-place`, `taken-unreadable`,
  `calendar-gone-unsent`, `failed`) and an English `detail` for the logs.
  An object with no ETag on either side is fetched again, never taken as
  unchanged.
- **D39. The proxy's URL space.** The web app sends a request for
  `https://cloud.example.com/remote.php/dav/` to
  `/dav-proxy/https%3A%2F%2Fcloud.example.com/remote.php/dav/` on its own
  origin. The handler (`proxyHandler` in `@astrotime/caldav`) passes only the
  headers CalDAV needs, maps redirects back into its URL space, and refuses
  origins off its allowlist. It serves the app's own pages only: a request
  with another `Origin`, or that the browser marks cross-site, is refused, so
  a page elsewhere cannot use it to reach the servers behind it. The host is
  compared, not the scheme, so it works behind a TLS terminator. A caller
  that is not a browser sends neither header and passes: the check keeps
  other sites' pages out, while the allowlist bounds where anyone can reach,
  and credentials are the caller's own. The
  provider sends credentials to its calendar home's origin only (discovery
  too: a principal or a home named on another origin is not followed);
  hrefs the
  server names elsewhere are ignored, and every href is spelled one way
  (`canonicalHref`: `a@b.ics` and `a%40b.ics` are one resource) for
  comparing, while requests about an href use the server's own spelling. A redirect
  to another server is not passed through the proxy (the browser would keep
  the credentials for it): sign in with that server's address instead. The dev server allows any origin
  (only while it listens on localhost; with `--host` it requires the list) unless
  `ASTROTIME_PROXY_ALLOW` lists some; the production image (PR 7) requires
  the list.

### The web image

Decided while building PR 7.

- **D40. One small image.** `apps/proxy` is bundled by Vite into one
  JavaScript file with the workspace packages it needs, and runs on
  `node:24-alpine` next to `apps/web/dist`, as the unprivileged `node` user.
  It serves the app (hashed assets as immutable, every other path as the
  single-page app), `/healthz`, and the CalDAV proxy of [D39](#D39).
  `ASTROTIME_PROXY_ALLOW` is required and holds origins only; the server
  refuses to start without it. TLS is the job of the reverse proxy in front.
  Proxied answers are streamed and sent `Cache-Control: no-store`; requests
  are capped at 10 MB (413, refused before reading when announced), and slow
  ones are cut off. A missing file under `assets/` is a 404, never the app,
  and only a file that resolves under `assets/` is immutable. Errors are
  logged, not shown to the client. A client that goes away cancels its
  request to the CalDAV server. Behind a TLS terminator the page's `https`
  origin passes the proxy's check, which compares hosts ([D39](#D39)).
- **D41. Releases are tagged from `package.json`.** The root `version` is
  the product's; a `v<version>` tag publishes
  `ghcr.io/astroreen/astrotime:<version>`, `:<major>.<minor>` and, for a
  release that is not a prerelease, `:latest`, for amd64 and arm64. The
  build stage runs on the builder's platform (its output is JavaScript), so
  arm64 needs no emulation. A tag publishes only a commit on `main` whose
  `CI` passed. CI builds and starts the image on every PR.

### Layout

Decided while building the layout engine, ahead of PR 5's screens.

- **D42. The layout is pure geometry in `@astrotime/core`.** `layoutDay`
  places one day's occurrences in minutes and fractions of a column;
  `layoutSpans` packs the all-day strip of a week (or a month's week) into
  rows. The UI turns both into pixels, so every view shares one placement and
  the rules are tested without a browser. On top of D14–D16:
  - a timed item lasting 24 hours or more (elapsed, so across a DST change
    too), or covering a whole day of the user's wall clock, goes to the
    all-day strip, as Google shows a three-day conference;
  - a task's due date is its last day (an event's `DTEND` date is the day
    after its last);
  - a task is a chip when it has a timed due and no timed start (a date
    start included), or a timed start and no due; the chip sits on the day
    of that time only;
  - an occurrence that does not show on the day it is laid out for is left
    out;
  - an item over midnight is clipped to each day and says it goes on;
  - a block is drawn at least 15 minutes tall, a chip 30; a chip at the end
    of the day is lifted to fit;
  - the cascade steps 15% of the column per item underneath, and switches to
    equal columns past three items at once; the depth is transitive (an item
    over a cascaded one steps once more, even along a chain where no more
    than two overlap at once); a chain deep enough to run off the column
    switches to equal columns too, so no item hides another;
  - in the strip, longer spans come first, then events before tasks.

## Deferred

- **Google provider** — Google Calendar and Google Tasks through their REST
  APIs and OAuth ([D4](#D4)).
- **System calendars** — Android `CalendarContract` (calendars synced by
  DAVx5 and others), read-only first ([D4](#D4)).
- **Time blocking** — planning tasks as blocks beyond `DTSTART`/`DUE`.
- **Sending invitations** — iTIP/iMIP for attendees ([D9](#D9)).
- **Year view** ([D13](#D13); the 3-day view joined the MVP, [D48](design.md#D48)).
- **Windows** — checked last, if at all ([D12](#D12)).
- **Signed Android release** — the APK is unsigned at first ([D28](#D28)).
- **Static files served whole** — the image reads each file into memory
  with no `ETag`, `Last-Modified` or compression; the bundle is small
  today. Precompressed assets and conditional requests come when PR 5's app
  makes the bundle large ([D40](#D40)).
- **A Host allowlist in the image** — the proxy compares `Origin` with
  `Host`, so against DNS rebinding the image relies on the reverse proxy in
  front answering only for its own server name; an optional
  `ASTROTIME_PUBLIC_HOST` would make the image hold that line itself
  ([D40](#D40)).
- **Base images by digest** — the Dockerfile uses `node:24-alpine` by tag;
  pinning it by digest, with Dependabot for Docker, makes releases
  reproducible ([D41](#D41)).
- **Content Security Policy** for the web image — once the app's own needs
  (wasm, workers) are known from PR 5 ([D40](#D40)).
- **Display-style Windows TZIDs** — Outlook's desktop export can write
  `TZID:(UTC+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna`, the
  zone's display name, which CLDR's table does not carry (only as comments, in
  English), and its `tzone://Microsoft/Utc`, `tzone://Microsoft/Custom` and
  `Customized Time Zone`; such a time stays floating until a reader of those
  names is justified by a real file ([D32](#D32)).
- **Expanding long series from the middle** — `occurrencesBetween` walks a
  series from its first occurrence and throws `ExpansionLimitError` past
  50 000 steps (a minutely or hourly series from years ago); a start point
  or a cache comes when a real calendar hits it ([D33](#D33)).
- **Fixtures from Nextcloud's web calendar** — PR 4's "Done when" first
  asked for objects written by Nextcloud's web calendar; the recordings are
  of objects as Nextcloud serves them back. Recording what its web calendar
  writes needs a browser driving it, which comes with Playwright e2e.
- **Finer write rights** — a calendar is read-only unless its privilege
  set grants `write`, `write-content` or `all`; a share that lets one edit
  but not create (`bind`) or delete (`unbind`) is taken as fully writable,
  and its refused creations show as errors ([D37](#D37)).
- **Login Flow v2 end to end** — the flow is tested against Nextcloud up to
  the approval page; approving it needs a browser driving Nextcloud's login,
  which comes with Playwright e2e ([D19](#D19)).
- **Scheduling syncs** — `syncAccount` runs when called; when and how often
  the apps call it (on start, on focus, on a timer, Android background sync)
  is decided with each app.

- **Overdue tasks on today** — D16's roll-over needs the store to find
  undone tasks due before today; it comes with PR 5a's calendar views
  (design D51).
- **`RANGE=THISANDFUTURE`** on a `RECURRENCE-ID` is read as replacing one
  occurrence only. Nextcloud, Apple and Google split the series instead, so
  it is rare; it comes when a fixture from a real client needs it.
- **Playwright e2e** — set up in PR 5, when there is UI to test. Browser-mode
  tests run since PR 3.
- **One store across tabs** — the web store opens its database in one tab;
  a second tab fails to open it until a `SharedWorker` or a lock hands it
  over ([D25](#D25)).

## PR plan

### PR 1 — Foundation

The docs (this plan, the map, the glossary, the lore, the grilling session)
and the skeleton: workspace, toolchain, devenv, a placeholder web app, CI,
Claude review, Dependabot. Decisions: D21, D23, D24, D26, D27,
D29, D30.

Done when: `vp check`, `vp run -r typecheck`, `vp test run` and `pnpm knip`
pass locally and in CI; the docs route test passes.

### PR 2 — iCalendar core

`@astrotime/core`: the event and task model over `ical.js`, lossless
round-trip, recurrence expansion with exceptions and time zones. Decisions:
D7, D8, D10, D31–D35.

Done when: fixtures in the shape Nextcloud, Apple, Thunderbird, Google and
Tasks.org write parse and serialize back with every property kept;
recurrence expansion matches the fixtures' expected occurrences.

_Changed in PR 2:_ this PR first asked for fixtures recorded from those
clients. Recording needs the servers PR 4 brings, so the fixtures here are
written by hand after each client's documented output, and recording moved
to PR 4's "Done when". The owner may set it back.

### PR 3 — Local store

`@astrotime/storage`: the Drizzle schema, the migrations, the Node driver and
the web driver (sqlite-wasm on OPFS). The browser test project and Chromium
in CI arrive with it.

Decisions: D5, D25, D36, D38.

Done when: items, calendars, accounts, sync tokens and conflicts persist and
are queried by date range in a browser test.

### PR 4 — CalDAV provider

`@astrotime/caldav` and the sync engine: discovery, Login Flow v2, password
sign-in, `sync-collection`, ETag writes, conflicts; the Vite dev proxy;
integration tests against Radicale in CI and the nightly Nextcloud job.
Decisions: D2, D5, D6, D19, D20 (development half), D27, D37, D38, D39.

Done when: a Radicale and a Nextcloud account sync both ways, offline edits
reach the server when it comes back, and a conflicting edit lands in the
Conflicts list; objects as Nextcloud and Radicale serve them back are
recorded as fixtures and pass PR 2's round-trip tests.

_Changed in PR 4:_ "objects written by Nextcloud's web calendar" became
"objects as Nextcloud serves them back": the web calendar is a browser app
no test drives yet. The recordings are `radicale-*.ics` and
`nextcloud-served-*.ics` in `packages/core/test/fixtures/`.

### PR 5 — Calendar grid

In two parts, as the [design plan](design.md#pr-plan) splits it ([D18](#D18)):

- **5a** — `@astrotime/ui` and the web app's shell and views: Day, 3 days,
  Week, Month, Agenda; the all-day strip, the overlap layout, task
  placement; both themes; i18n; browser-mode tests and Playwright.
  Decisions: D1, D13, D14, D15, D16, D17, D42, design D43–D51.
- **5b** — the tasks screen, the drawer's settings and search. Decisions:
  design D52, D53.

Done when, for 5a: each view renders real objects from the local store, in
both themes and both languages, as the references describe; for 5b: the
tasks screen lists, completes and stars tasks through the local store, the
drawer's settings apply, and search finds an item by its title. Screenshots
of each, set against the reference's description, are the evidence.

### PR 6 — Editing

Drag and resize, the details and edit dialogs for events and tasks, the
recurrence scope dialog, reminders as notifications. Decisions: D9, D10, D11.

### PR 7 — Web proxy and release

`apps/proxy` and the Docker image, its allowlist, the release workflow that
publishes it to GHCR on a `v*` tag. Decisions: D20, D28, D40, D41.

Done when: the image builds in CI, serves the app, proxies to an allowed
server and refuses an unlisted one, and refuses to start without an
allowlist.

### Later — Android, then Linux

`apps/mobile` (Capacitor: native HTTP, Keystore, notifications, background
sync, APK release), then `apps/desktop` (Electron for Linux). Each gets its
own plan before it starts. Decisions: D12, D22, D28.
