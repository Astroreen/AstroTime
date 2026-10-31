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

- **D13. Views: Day, Week, Month, Agenda.** Year and 3-day views are
  deferred.
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
  - Only `DUE` with a time: a task chip at the due time (drawn about
    30 minutes tall); dragging it moves `DUE`.
  - `DTSTART` and `DUE`: a block from start to due, like an event; resizing
    moves either end.
  - `DUE` with a date only: the all-day strip of that day.
  - No date: the task panel only.
  - Completed tasks stay visible, struck through and dimmed, with a "hide
    completed" toggle.
  - Overdue tasks roll over to today.
- **D17. English and Russian from the first screen.** Every UI string goes
  through an i18n library (Lingui or i18next, chosen in PR 5); no strings in
  code.
- **D18. The visual design is decided later**, in its own plan, before
  PR 5. Until then UI work is structure and behaviour.

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
  - in development, the Vite dev server proxies CalDAV requests;
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
- **D25. SQLite everywhere, through Drizzle.** wa-sqlite on OPFS on the
  web, `@capacitor-community/sqlite` on Android, `better-sqlite3` in
  Electron; one schema and one query layer (Drizzle) over all three.

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
- **D32. A TZID without a VTIMEZONE is an IANA name.** ical.js resolves
  zones the object defines; a TZID it does not define (Google, some Android
  clients) is resolved through `Intl`, following RFC 5545 for DST gaps (the
  offset before the gap) and repeats (the earlier instant). A TZID neither
  knows stays floating.
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

## Deferred

- **Google provider** — Google Calendar and Google Tasks through their REST
  APIs and OAuth ([D4](#D4)).
- **System calendars** — Android `CalendarContract` (calendars synced by
  DAVx5 and others), read-only first ([D4](#D4)).
- **Time blocking** — planning tasks as blocks beyond `DTSTART`/`DUE`.
- **Sending invitations** — iTIP/iMIP for attendees ([D9](#D9)).
- **Year and 3-day views** ([D13](#D13)).
- **Windows** — checked last, if at all ([D12](#D12)).
- **Signed Android release** — the APK is unsigned at first ([D28](#D28)).
- **Windows time zone names** — Outlook's `TZID:W. Europe Standard Time`
  without a VTIMEZONE stays floating until it is mapped to IANA; with a
  VTIMEZONE the instant is exact and `timeZone` keeps the Windows name
  ([D32](#D32)).
- **Expanding long series from the middle** — `occurrencesBetween` walks a
  series from its first occurrence and throws `ExpansionLimitError` past
  50 000 steps (a minutely or hourly series from years ago); a start point
  or a cache comes when a real calendar hits it ([D33](#D33)).
- **`RANGE=THISANDFUTURE`** on a `RECURRENCE-ID` is read as replacing one
  occurrence only. Nextcloud, Apple and Google split the series instead, so
  it is rare; it comes when a fixture from a real client needs it.
- **Browser-mode component tests and Playwright e2e** — set up in PR 5,
  when there is UI to test.

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

`@astrotime/storage`: the Drizzle schema and the web adapter (wa-sqlite on
OPFS). Decisions: D5, D25.

Done when: items, calendars, accounts, sync tokens and conflicts persist and
are queried by date range in a browser test.

### PR 4 — CalDAV provider

`@astrotime/caldav` and the sync engine: discovery, Login Flow v2, password
sign-in, `sync-collection`, ETag writes, conflicts; the Vite dev proxy;
integration tests against Radicale in CI and the nightly Nextcloud job.
Decisions: D2, D5, D6, D19, D20 (development half), D27.

Done when: a Radicale and a Nextcloud account sync both ways, offline edits
reach the server when it comes back, and a conflicting edit lands in the
Conflicts list; objects written by Nextcloud's web calendar and by Radicale
are recorded as fixtures and pass PR 2's round-trip tests.

### PR 5 — Calendar grid

`@astrotime/ui` and the web app's views: Day, Week, Month, Agenda, the
all-day strip, the overlap layout, task placement, the task panel; i18n;
browser-mode tests and Playwright. Needs the design plan ([D18](#D18)).
Decisions: D1, D13, D14, D15, D16, D17.

### PR 6 — Editing

Drag and resize, the details and edit dialogs for events and tasks, the
recurrence scope dialog, reminders as notifications. Decisions: D9, D10, D11.

### PR 7 — Web proxy and release

`apps/proxy` and the Docker image, its allowlist, the release workflow that
publishes it to GHCR on a `v*` tag. Decisions: D20, D28.

### Later — Android, then Linux

`apps/mobile` (Capacitor: native HTTP, Keystore, notifications, background
sync, APK release), then `apps/desktop` (Electron for Linux). Each gets its
own plan before it starts. Decisions: D12, D22, D28.
