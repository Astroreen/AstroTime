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
  the user can apply it again. _Built in PR 6a:_ [D107](#D107).

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
  sent (no iTIP). _Built in PR 6a:_ creating, editing and deleting
  ([D103](#D103)–[D106](#D106)), reminders added and removed in the edit
  dialog (their notifications: [D100](#D100)–[D102](#D102)), attendees in
  the details ([design D108](design.md#D108)).
- **D10. Tasks in the MVP: the full VTODO.** Summary, description,
  `DTSTART`, `DUE`, status and completion, `PERCENT-COMPLETE`, `PRIORITY`,
  `CATEGORIES`, subtasks (`RELATED-TO`), recurrence, reminders, `CLASS`, and
  the Nextcloud/Apple extensions for ordering and hidden subtasks. _Built in
  PR 6a:_ the edit dialog writes a task's summary, description, start, due,
  recurrence, reminders, status, `PERCENT-COMPLETE`, `PRIORITY` and
  `CATEGORIES` ([D103](#D103), [design D109](design.md#D109)); subtasks and
  the parent are shown, not set, and `CLASS` and the ordering extensions are
  kept, not edited ([Deferred](#deferred)).
- **D11. Editing an occurrence asks the scope**, as Google does: "This
  occurrence / This and following / All occurrences". _Built in PR 6a:_
  what each writes is [D105](#D105).

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
  through an i18n library; no strings in code. _Chosen in PR 5a:_ **i18next**
  with react-i18next. It needs no build step or macro plugin (Lingui's
  extraction and macros would add one to Vite+, oxc and the React Compiler),
  and its plurals are CLDR's through `Intl.PluralRules`, Russian's four
  forms included. The catalogs are flat (`packages/ui/src/i18n/`); the
  English one types the keys of `t()`, the compiler checks that the Russian
  one has the same keys, and a test checks each plural against its
  language's categories. Dates, weekday and month names come from `Intl`,
  not the catalogs.
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

  Credentials stay on the device: IndexedDB on the web, sealed with a key
  the page cannot export ([D89](#D89)), the Android Keystore on Android
  ([android D64](android.md#D64)), the system keyring on the desktop
  ([desktop D74](desktop.md#D74)). How the web signs in: [D92](#D92).

- **D20. CORS on the web.** A browser may not read responses from another
  origin unless that server allows it, and Nextcloud does not allow it for
  CalDAV. (Native apps and our Android and Electron shells are not
  browsers and are not affected.) So:
  - in development, the Vite dev server proxies CalDAV requests. Reached
    from beyond localhost (the owner's devices on their tailnet,
    `scripts/t3/README.md`), it lets in loopback and tailnet clients only
    and proxies only to `ASTROTIME_PROXY_ALLOW`'s servers, since the local
    Radicale's password is published. The tailnet reaches it over **https**,
    since the web store needs a secure context (OPFS, Web Locks) and plain
    http is one only on localhost: the dev server stays plain http on
    127.0.0.1, and `tailscale serve` (the tailnet's own certificate, once the
    owner lets it run as them) or, without that permission, the dev server's
    own TLS listener with a self-signed certificate is the https front;
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
  behind interfaces the shared packages define (`@astrotime/core`,
  `caldav`, `storage`, `ui`), named in [android D60](android.md#D60).
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
    one tab's worker opens the database, for every tab ([D98](#D98));
  - Electron and tests: `node:sqlite`, built into Node 24, so no native
    module to rebuild;
  - Android: the web's driver, in the WebView.

  _Changed in PR 3:_ the grilling named wa-sqlite and better-sqlite3; the
  official build and Node's own SQLite do the same with fewer moving parts.

  _Changed by the Android plan ([D63](android.md#D63)):_ Android first named
  `@capacitor-community/sqlite`; OPFS works in the Android WebView, so the
  web's tested driver runs there unchanged and rows stay arrays.

- **D36. The store holds only valid objects.** Every write parses the
  iCalendar with `@astrotime/core` and indexes it by `boundsOf` (and, since
  migration 6, by its titles folded for search, design
  [D97](design.md#D97)); a range query returns candidates for
  `occurrencesBetween` to place exactly. Local
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
  commit SHAs, and the image's base images, pinned by digest ([D41](#D41)).
- **D28. Releases on a `v*` tag:** the web Docker image to GHCR and an
  Android APK to GitHub Releases (unsigned at first); the desktop build
  joins when it exists. How: [android D69](android.md#D69),
  [desktop D79](desktop.md#D79).
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
  `bcp47/timezone.xml` gives `Asia/Kolkata`). A TZID none of these knows
  stays floating. The table is generated, not written by hand
  (`scripts/generate-windows-zones.ts` pins a CLDR release). For a mapped name `ItemTime.timeZone` is the IANA
  zone; the TZID as read stays in the calendar object, so `serialize` writes
  it back unchanged (rule 2). A Windows name the object defines in a
  VTIMEZONE (Outlook's usual output) is mapped the same way for `timeZone`,
  while its instants come from the VTIMEZONE; only a defined TZID that is
  neither (`Customized Time Zone`) stays as written. A known limit: where a
  VTIMEZONE's rules differ from today's IANA data (an old or custom one, a
  historical date), the instant is the VTIMEZONE's and the wall clock in
  `timeZone` may differ from the written one, as for any VTIMEZONE named
  with an IANA name.
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
  reported, until a listing without it finds it has none. In a calendar
  that lets nothing be deleted (read-only, or a share without `unbind`,
  [D37](#D37)) a deletion of ours comes back, reported. A deletion of ours
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
  lists ours as a conflict, unless both are the same. **What the user may
  do in a calendar** is its `rights`, kept with it in the store (migration
  7): `create` a new item, `edit` one, `delete` one. The CalDAV provider
  reads them from the calendar's `current-user-privilege-set` (RFC 3744):
  `bind` creates, `write-content` edits, `unbind` deletes, and `write` or
  `all` grant all three (Radicale lists `all` without its parts, Nextcloud
  lists the parts too); `write-properties` (a share's own name and colour)
  and CalDAV's `read-free-busy` grant none, and a server that reports no
  set grants all. Nextcloud gives an owner and a read-write share every
  right and a read-only share none; a server may grant `write-content`
  without `bind` or `unbind`. A pending change its right does not allow
  never goes up: an edit gives way at once, the server's version comes
  back and ours goes to the Conflicts list; a deletion comes back (D38); a
  new item waits, reported, until the calendar takes new items. The UI
  offers only what the rights allow (design [D108](design.md#D108)). An object a multiget leaves out is fetched
  on its own; one that still cannot be read keeps no sync token, so the next
  sync lists everything again. The time of an item (`DTSTART`, `DTEND`,
  `DURATION`, `DUE`) is one field, and an attendee is identified by their
  address, so changing their answer on one side is no duplicate. The report names the pending changes a server deletion
  dropped, and an interrupted sync's error carries its report so far. An
  edit made while a sync runs is never undone by that sync: a deletion or a
  taken href it learns of leaves the newer edit pending for the next one.
  Through the web proxy, a server it cannot reach is offline, like no answer. The report's
  `errors` carry a `problem` code the UI words in the user's language
  (`read-only`, `no-create` for a new item in a calendar that edits but
  takes no new items, `deletion-reverted`, `no-place`, `taken-unreadable`,
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
  single-page app, precompressed and revalidated by `ETag`, [D80](#D80)),
  `/healthz`, and the CalDAV proxy of [D39](#D39).
  `ASTROTIME_PROXY_ALLOW` is required and holds origins only; the server
  refuses to start without it. TLS is the job of the reverse proxy in front;
  the hosts it answers for can be listed in the image too ([D81](#D81)).
  Proxied answers are streamed and sent `Cache-Control: no-store`; requests
  are capped at 10 MB (413, refused before reading when announced), and slow
  ones are cut off. A missing file under `assets/` is a 404, never the app,
  and only a file that resolves under `assets/` is immutable. Errors are
  logged, not shown to the client. A client that goes away cancels its
  request to the CalDAV server. Behind a TLS terminator the page's `https`
  origin passes the proxy's check, which compares hosts ([D39](#D39)). The
  app runs under a strict Content Security Policy ([D110](#D110)).
- **D41. Releases are tagged from `package.json`.** The root `version` is
  the product's; a `v<version>` tag publishes
  `ghcr.io/astroreen/astrotime:<version>`, `:<major>.<minor>` and, for a
  release that is not a prerelease, `:latest`, for amd64 and arm64. The
  build stage runs on the builder's platform (its output is JavaScript), so
  arm64 needs no emulation. A tag publishes only a commit on `main` whose
  `CI` passed. CI builds and starts the image on every PR. Every `FROM` names
  its base image by digest, the tag kept to read
  (`node:24-alpine@sha256:…`, the multi-arch index), so a tag builds the
  same image whenever it is built; Dependabot proposes the new digest weekly,
  never a new Node major (that one moves with the dev shell's and CI's).
- **D80. Static files are streamed, precompressed and revalidated.** The
  image's build writes a `.br` (brotli, best quality) and a `.gz` (gzip,
  level 9) next to every text file of the app but its page (`apps/proxy/src/compress.ts`),
  kept only where smaller; nothing is compressed per request. The server
  picks one by `Accept-Encoding`: the highest q wins, a tie goes to brotli,
  then gzip, then the file as it is, which is also what a client without the
  header or one that refuses everything gets (never a 406); `Vary:
  Accept-Encoding` on every answer that carries a file (200 and 304). Each variant has a strong `ETag`
  from its content (SHA-256, cut to 22 base64url characters), and a matching
  `If-None-Match` is a 304; there is no `Last-Modified`, since a build that
  rewrites timestamps (`SOURCE_DATE_EPOCH`) would give two builds of
  `index.html` the same date. Files are streamed from disk, never held in
  memory; the server keeps only each file's ETag, hashed once and again only
  when its size or time changes, so memory is bounded by the number of files
  in the image. The root is taken as read-only, as it is in the image: each
  answer reads one open file, so its size, ETag and body agree, but a file
  rewritten in place with the same size within one clock tick keeps its old
  ETag. HEAD answers GET's headers. The page (`index.html`, on every route of
  the single-page app) is the exception: it carries a fresh nonce on every
  answer ([D110](#D110)), so it is read whole (under a kilobyte), sent as it
  is and `no-cache` with no `ETag`, fetched afresh on every load; only files
  under `assets/` are immutable ([D40](#D40)). Ranges are not served: the
  files are small enough to fetch whole. A path ending in `.br` or `.gz` is
  a 404: the copies are reached only through `Accept-Encoding`.
- **D81. The image can answer only for its own hosts.**
  `ASTROTIME_PUBLIC_HOST`, optional, lists the host names the server answers
  for, comma-separated: `calendar.example.com` matches on any port,
  `calendar.example.com:8443` on that port only (browsers leave out 80 and
  443, so list those as the bare name), an IPv6 address goes in brackets
  (`[2001:db8::1]`); names are matched case-insensitively and are written as
  browsers send them (punycode, no scheme, path or `*`), or the server refuses
  to start. A request whose `Host` is not listed is answered 421 Misdirected
  Request (RFC 9110: this server cannot answer for that name; 400 would say
  the request itself is malformed) before it reaches the app or the proxy,
  and so is an HTTP/1.0 request with no `Host`; an HTTP/1.1 one without it
  is malformed, and Node refuses it with 400 first. This holds the line
  against DNS rebinding in the image itself, where [D39](#D39)'s Origin check, which compares with `Host`,
  cannot. `/healthz` answers whatever the `Host`: it tells nothing, and
  health checks come by loopback (Docker's `HEALTHCHECK`) or by the
  container's own address (Kubernetes sends the pod's IP). Unset, every host
  is served, as before.
- **D110. A strict Content Security Policy, with a nonce per answer.** The
  image's server sends the app's page with this policy, built from what the
  app does and nothing more (`contentSecurityPolicy` in
  `apps/proxy/src/server.ts`):
  - `default-src 'none'`: nothing not named below (no frames, objects,
    fonts, images or media: the app uses system fonts and inline SVG icons);
  - `script-src 'self' 'wasm-unsafe-eval'`: the app's own scripts, and
    SQLite's WebAssembly, which the store's worker compiles;
  - `style-src 'self' 'nonce-…'`: the built stylesheet, and the `<style>`
    elements Base UI adds (`ScrollArea` and `Select` do; none of the
    components in use today does), which carry the nonce through
    `CSPProvider`. `style` attributes React and Floating UI set go through
    the CSSOM, which the policy allows;
  - `connect-src 'self'`: the wasm, and every CalDAV request through
    `/dav-proxy/` ([D39](#D39));
  - `worker-src 'self'`: the store's worker, a file of the app's own;
  - `base-uri 'none'`, `form-action 'none'` (no form is ever submitted to
    a URL), `frame-ancestors 'none'` (no other site frames the app).

  Login Flow v2 opens Nextcloud's page with `window.open(…, "noopener")`, a
  navigation no directive governs, and notifications need none. The nonce
  is fresh on every answer (16 random bytes): Vite's build writes the
  placeholder `astrotime-csp-nonce` into the page's tags and a `<meta
  property="csp-nonce">` (`html.cspNonce`), the server puts the nonce
  there, and the web app reads it from the meta and hands it to the UI,
  which passes it to Base UI's `CSPProvider`. Hence [D80](#D80)'s exception:
  the page is not compressed or answered 304 (a stored page revalidated by
  a 304 would get the new answer's policy over its old nonce), which costs
  about 0.4 kB on every load. `'unsafe-inline'` for styles would have kept
  the page cacheable but let any injected `<style>` in; hashes would have
  to follow Base UI's styles at every upgrade. Every file carries the same
  policy without the nonce, since a dedicated worker answers to the policy
  its own script came with (Chromium does not apply the page's to it); the
  page's policy holds what the worker needs too, for a browser that does.
  The page also gets `Referrer-Policy: same-origin` (not `no-referrer`,
  which would send `Origin: null` with the app's own PROPFINDs, and the
  proxy refuses those), `Cross-Origin-Opener-Policy: same-origin` and a
  `Permissions-Policy` that turns off the camera, microphone, location,
  payments, USB, serial, HID and screen capture; `X-Frame-Options` is left
  out, since every supported browser reads `frame-ancestors`. Proxied
  answers get `default-src 'none'; sandbox`, so a page among them, opened
  by URL on the app's origin, runs nothing; `fetch` ignores it. The dev
  server sends no policy: Vite's HMR and React Refresh need inline scripts
  and a WebSocket the production policy refuses, so a dev policy would be
  another policy. The production build is checked under the real one by a
  Playwright project (`apps/web/e2e/built`): the store opens, an account is
  added through the proxy, and not one violation is reported, the worker's
  included.

### Layout

Decided while building the layout engine, ahead of PR 5's screens.

- **D42. The layout is pure geometry in `@astrotime/core`.** `layoutDay`
  places one day's occurrences in minutes and fractions of a column;
  `layoutSpans` packs the all-day strip of a week (or a month's week) into
  rows; with `timed`, a month's week packs timed items too, after the
  all-day ones, in time order, each over the days it shows on (`dayRange`,
  design [D86](design.md#D86)). The UI turns both into pixels, so every view shares one placement and
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

### The calendar UI

Decided while building PR 5a.

- **D54. The views read the store through live queries.** `Store.subscribe`
  calls its listeners after every write, another tab's too ([D98](#D98)); a
  view's query runs again when the
  store changes, and a burst of writes during a run costs one more run, not
  one per write (`liveQuery`), so a sync writing while the app is open shows
  at once ([D5](#D5)). Each object is parsed once while its iCalendar is
  unchanged and its occurrences kept for the last range asked
  (`ObjectCache`, one for every view); a series too dense to expand is left
  out of the view, not the view out ([D33](#D33)). The wall clock of an
  instant in a zone is asked of `Intl` once and remembered (`wallClockIn`),
  and the layout sorts by keys worked out once per item: a month of a big
  calendar is laid out in about 15 ms, not 200 (measured in PR 5a-2).
- **D55. The store finds the undone tasks of design D51.**
  `undoneTasksBefore` returns each task once with the occurrence it counts by
  (`latestUndoneBefore` in `@astrotime/core`), oldest due first. A task is
  **done** when it is completed (`STATUS:COMPLETED` or a `COMPLETED` time) or
  cancelled (`isDone`). Migration 4 adds a `done` column for the master, so
  the query skips done tasks without parsing them; rows written before it
  hold `NULL` and are parsed.
- **D56. One tab holds the web store, and says so.** _Replaced by
  [D98](#D98):_ every tab works on the store; `StoreInUseError` and its
  message are gone. It was: the web driver held a Web Lock named after its
  database while it was open; a second tab got `StoreInUseError` at once,
  and the UI told the user, in their language, to close the other tab.
- **D57. Demo data and end-to-end tests.** `@astrotime/ui/demo` holds
  invented calendars around today, titled in English or Russian; the web dev
  server loads them with `?demo`, and the production build leaves them out
  (`import.meta.env.DEV`). Playwright (`apps/web/e2e/`) runs against the dev
  server on the demo data with the clock frozen (`page.clock`), with role and
  accessibility-tree locators; CI's `e2e` job runs it. The same specs take a
  UI pull request's screenshots (`ASTROTIME_SCREENSHOTS`).

### Accounts and syncing

Decided while building PR 5a-3.

- **D89. The web keeps credentials in IndexedDB, sealed with a key it cannot
  export.** `apps/web`'s `SecretStore` (`indexedDbSecrets`) keeps each
  account's credentials (JSON, [android D60](android.md#D60)) in an
  IndexedDB database of their own, `astrotime-secrets`, encrypted with
  AES-GCM (a new 12-byte IV for every write) under a 256-bit key made with
  `extractable: false` and kept in the same database. What it guards
  against: the password in plain sight, in the browser's storage inspector,
  a search through the profile's files, a copy of the site's data. What it
  does not: script running in the page, which can use the key to decrypt,
  and a reader of the disk who knows how the browser stores a `CryptoKey`,
  whose bytes are in the same profile. Nothing stronger exists on the web
  without a passphrase asked at every start, which background syncs could
  not answer either; rejected. A secret that no longer decrypts (its key
  cleared while it stayed) reads as none, so its account asks to sign in
  again, as on the desktop ([desktop D74](desktop.md#D74)). WebCrypto needs
  a secure context, as the store already does (OPFS, Web Locks).
- **D90. One sync entry, and the accounts' credentials in one place.**
  `@astrotime/sync` exports `syncAll(context, { fresh })`
  ([android D60](android.md#D60)). It syncs every account of the store, one
  after another, through `syncAccount`, and reports each (`AccountSync`):
  `synced` with its report, or `signed-out` (the server refused the
  credentials, or none are saved), `refused` (the web proxy does not carry
  the server), `offline` or `failed`, with the report so far; it never
  throws for an account. A call while a sync of the same store runs joins
  it. `fresh` asks for a sync that starts after the call (a local change,
  an account just added, "Sync now"): the running one's successor, shared
  by every such call meanwhile. The context is the store, the platform's
  `SecretStore` and `connectCalDav(http)`, which opens an account's
  provider at the calendar home kept with the account (`homeUrl`,
  migration 5; discovered again only when missing), so a sync does not
  discover first. `saveAccount` and `removeAccount` are the only code that
  spells the credentials' key (`account:<id>`) and JSON. Signing in to an
  account already here (the same calendar home and user) replaces its
  password instead of adding a second one. Removing makes every sync that
  starts from then on leave the account alone, waits for the running one
  and the one queued after it, deletes the secret first (an account left
  behind asks to sign in again; a password left behind would be invisible),
  then the account with its calendars and items. The demo's account (`provider: "demo"`) is never
  synced. `@astrotime/sync` depends on `@astrotime/caldav` for this: it
  opens the providers. The reminders follow a sync through the store: its
  writes hand the platform a new set ([D101](#D101)).
- **D91. When the UI syncs.** `SyncScheduler` in `@astrotime/ui` runs the
  UI's syncs through `syncAll`, so two never run at once, and the triggers
  are the same in every shell, since the UI is:
  - on start;
  - when the app is in front of the user again (the tab visible, the window
    focused), if the last sync started more than a minute ago;
  - every 5 minutes while the page is visible and the browser online. A
    visible app is one the user is looking at, so a change made on another
    device should show within minutes, and a sync that finds nothing new is
    one `PROPFIND` of the calendar home and one `sync-collection` per
    calendar. A hidden tab's timers are throttled anyway; its next visit
    syncs;
  - when the network comes back (`online`);
  - 2 seconds after the last of a burst of local changes (`changed()`, for
    the editing of PR 5b and PR 6), and on "Sync now", both `fresh`.

  Every open tab runs these triggers on the one store ([D98](#D98)), so a
  sync waits for another tab's to end: two at once would each upload the
  same pending change. The web platform's `syncLock` takes a Web Lock per
  store (`astrotime-sync:<store>`) around each run of `syncAll`
  (`SyncContext.lock`), and removing an account takes it too, so no tab's
  sync is inside an account another tab removes. A tab that closes lets it
  go. It waits rather than skips: a skipped run has no report, so that
  tab would show nothing of its accounts, and a `fresh` request must lead
  to a sync that starts after it; a sync that finds nothing new costs one
  `PROPFIND` and one `sync-collection` per calendar. A shell with one
  instance of its store needs no lock.

  Android adds background sync ([android D67](android.md#D67)), which
  takes the same lock, and the desktop its main-process timer and resume
  ([desktop D75](desktop.md#D75)), both through `syncAll`; the desktop's
  reach the UI as the `Platform`'s `onSyncRequest`, each a "Sync now". The status
  shows without getting in the way: the account button in the top bar
  turns a ring while a sync runs and shows a
  dot when something needs the user (signed out, refused, failed, items the
  sync could not handle, conflicts). Each account says, in the drawer and
  in the accounts dialog, that it syncs, when it last synced, that it is
  offline, or what stops it, with the report's `problem` codes and dropped
  changes in words ([D37](#D37), [D38](#D38)) and "Sign in again" when the
  server refused it. The count of conflicts ([D6](#D6)) is shown there, with
  "Review", which opens the Conflicts list ([D107](#D107)).

- **D92. Signing in on the web, and the accounts in the shell.** The
  add-account dialog has two tabs: Nextcloud (Login Flow v2) and CalDAV
  (address, user name, password); its steps live outside React (`SignIn` in
  `@astrotime/ui`). A typed address without a scheme is `https://`; a path
  is kept. Login Flow opens Nextcloud's page with `openExternal` (a new tab
  with `noopener` on the web) and offers to open it again, since a browser
  may block a tab opened after the flow's first request; it polls as
  [android D65](android.md#D65) says (every 2 seconds, at once when the
  page is visible again, giving up after 20 minutes), waits through a moment
  offline, a 429 or a 5xx, and Cancel stops it. Then discovery and the
  first sync. The proxy marks its own refusals (`x-astrotime-refused`:
  `not-allowed`, or `other-server <origin>`), which `fetchClient` turns into
  `ProxyRefusedError`, so the dialog tells apart a wrong password, an
  unreachable server, an address that is no CalDAV server
  (`NoCalendarHomeError`) or no Nextcloud, a server this AstroTime's
  administrator has not allowed ([D20](#D20)), and a redirect to another
  server, which it names ([D39](#D39)). An account is called
  `user@host`. An app with no account and no demo shows a first-run screen
  with both ways in. The account button in the top bar
  ([design D46](design.md#D46)) opens the accounts dialog (each account
  with its status and menu, "Sync now", "Add account"), as Google's account
  button opens its account sheet; the drawer shows each account with its
  status and menu (sync now, sign in again, remove) above its calendars.
  "Sync now" syncs every account ([D90](#D90)). Removing asks first. "Sign
  in again" opens the dialog with the account's address and user name, on
  Nextcloud's tab for a Nextcloud account.

### The store across tabs

Decided while closing the Deferred "One store across tabs".

- **D98. Every tab works on the one web store; a leader tab runs it.**
  `opfs-sahpool` holds the database's files exclusively, through
  `createSyncAccessHandle`, which only a dedicated worker has, so one worker
  at a time can open the database. Each tab's driver starts a worker that
  asks for the store's Web Lock without `ifAvailable`, so the tabs queue;
  the worker holding it opens the database and runs the statements of every
  tab, its own included: the **leader tab**. A driver says `hello` on the
  store's `BroadcastChannel` and is answered on a channel of its own, which
  only it and the leader hear, so a result is cloned once, for the tab that
  asked; a follower's statement costs one message there and back. The lock
  lives and dies with the worker that holds the files: when the leader's
  tab closes or is discarded, or its worker fails, both go, the next tab in
  the queue opens the database and says so (`leader`), and the others send
  there.
  - **A tab put away** (`pagehide` into the back/forward cache, `freeze`)
    lets go of everything it holds, so no tab waits on it: its worker, with
    the store's lock and files if it led; its own Web Lock, so the leader
    rolls back a transaction it left open and serves the others, as for a
    closed tab; and its channel. What it had on its way fails with
    `HandOverError`, and its open transaction is over. Back (`pageshow` from
    the cache, `resume`), it joins again under a new name, so nothing said
    to the old one reaches it, queues to lead again, and its views read
    again. Whether a browser caches or freezes a page holding Web Locks at
    all varies (Chromium does neither); the tests dispatch the events to an
    iframe.
  - **Nothing lost, nothing run twice.** A statement on its way when the
    leader goes fails with `HandOverError`: it may or may not have run, and
    nothing proves which, so it is never sent again. A leader that closes
    the database says `bye` after its last result, so a statement without
    one did not run and goes to the next leader, as do statements sent while
    no leader was known. A transaction open at a leader that goes is over:
    rolled back there (from its journal at the next open, if the tab died),
    and its tab's statements fail with `HandOverError` until its `ROLLBACK`,
    never running outside it.
  - **Every tab hears every write.** The leader says `changed` after each
    write transaction that commits, whatever it wrote: rows, the schema, a
    pragma such as `user_version` (SQLite's commit hook, not a count of
    changed rows, which leaves the schema out; a `BEGIN IMMEDIATE` that
    wrote nothing counts too, and the others only read again). A rolled
    back one changed nothing for the others. The driver's `SqlDriver.subscribe` (optional;
    the web driver has it) reaches `Store.subscribe`, so a write in one tab
    re-renders the others ([D54](#D54)). A tab hears one after a hand-over
    too, so a read that failed on its way runs again.
  - **One tab's transaction at a time** ([D99](#D99)): while a tab's
    transaction is open, the leader holds the other tabs' statements back.
    Each tab holds a Web Lock of its own while its store is open; when the
    leader is granted it, the tab is gone, and its open transaction is
    rolled back. A tab that is gone never holds the others: if that
    `ROLLBACK` fails and leaves the connection in its transaction, no other
    statement runs inside it; the leader stops (its worker ends, with the
    files and the lock), and the next leader opens the database afresh,
    which rolls the journal back. A migration step outlasts five hand-overs
    in a row, then the opening fails.
  - Every leader sets its connection up alike (foreign keys on), since the
    tabs move between connections without knowing. The pool opens with
    `preserveOnInitFailure`: by default a failed open deletes the pool's
    files, the database with them. A new leader that finds a file still
    held (a closed tab's worker lets its lock and its files go in no set
    order) tries again, for a few seconds.
  - Every tab's worker loads sqlite-wasm's script (220 kB, cached); only the
    leader compiles the wasm and opens the database.
  - Rejected: a `SharedWorker` owning the database (it has no
    `createSyncAccessHandle`, and Android's WebView has no `SharedWorker`,
    [android D67](android.md#D67)); a connection per tab on the `opfs` VFS
    (it needs cross-origin isolation, which D25 avoided, and the tabs would
    wait on each other's file locks); pausing and unpausing the pool around
    each operation (`pauseVfs`: every file handle taken again, by every tab,
    per statement); `MessagePort`s handed out by the leader (a
    `BroadcastChannel` cannot carry one, and the only brokers are a
    `SharedWorker` or a service worker AstroTime does not have); one channel
    for every result (every tab would clone every other tab's rows).

  Replaces [D56](#D56); [android D67](android.md#D67) shares the store
  between the app and its background job the same way.

- **D99. A store operation is a transaction.** Each read-then-write
  operation of the store (`exclusive`) runs in `BEGIN IMMEDIATE … COMMIT`
  and rolls back when it fails, so a failed one leaves nothing of itself;
  each migration step reads the schema's version inside its own
  transaction. The store's queue keeps one tab's operations in order; the
  transaction keeps them whole across tabs ([D98](#D98)): two tabs opening
  an old database at once migrate it once, and a sync in one tab never
  marks synced an edit another tab made meanwhile ([D38](#D38)).
  - **A COMMIT in doubt.** A store operation that fails with
    `HandOverError` did nothing: its transaction went with the leader, so
    trying it again is safe. One whose `COMMIT` was on its way when the
    leader went fails with `CommitInDoubtError` (a `HandOverError`): it may
    have committed, and nothing tells. The store's callers never assume
    either; they read again. A migration step reads the version again and
    goes on from there, so it never runs twice. The sync engine reports the
    object (or, outside one, the account's run) as failed and goes on
    through the next leader; its next run starts from what the store and
    the server hold, where an upload whose marking was lost is recognised as
    our own ([D37](#D37)): a creation finds its href holding our version, an
    update is refused and merged with a server copy that is ours already. A
    view reads again at the hand-over ([D98](#D98)), so the user sees
    whether an edit is there.

### Reminders

Decided while building PR 6's reminders as notifications ([D9](#D9),
[D10](#D10); the set's shape is [android D60](android.md#D60)).

- **D100. How an alarm becomes a reminder.** `remindersOf` in
  `@astrotime/core` turns a calendar object's `VALARM`s into the times they
  fire within a range of days in the user's zone; `soonestReminders` cuts
  the set a platform is handed: from now, 7 days ahead, at most 100, the
  soonest first (ties by id). It also reaches an hour back
  (`REMINDER_GRACE_MS`), so a reminder missed in a sleep is not lost to a
  set computed on waking: each platform shows such a one within its own
  grace (the web 5 minutes, [D101](#D101); the desktop an hour,
  [desktop D76](desktop.md#D76)) and drops it after; one turned off,
  deleted or edited away is not in the new set, so it never shows.
  - **What notifies.** `ACTION:DISPLAY` and `AUDIO`; an alarm without
    `ACTION` reads as `DISPLAY`. `EMAIL` is not ours (a server such as
    Nextcloud sends it), `NONE` (RFC 9074, Apple's placeholder) and
    `PROCEDURE` or unknown actions do nothing. They stay in the object
    unchanged, as everything does ([D7](#D7)).
  - **What a relative trigger counts from.** `START` (the default) is an
    event's start, a task's `DTSTART`, or its `DUE` when it has no start:
    RFC 5545 requires a `DTSTART` for such an alarm, and the due is the only
    time such a task has, so the alarm fires at a time the user can foresee
    instead of never. `RELATED=END` is an event's end (`DTEND`, or
    `DTSTART` + `DURATION`, or RFC 5545's default) and a task's due, or its
    start when it has none. A task with neither reminds only by an absolute
    trigger.
  - **Days of the wall clock.** On a zoned time an offset's weeks and days
    are days of its zone's wall clock and the rest is exact (RFC 5545
    §3.3.6): `-P1D` before 09:00 is 09:00 the day before across a DST
    change, `-PT24H` is 24 hours. A date (an all-day item, a task due on a
    date) counts from the start of its day in the user's zone, as RFC 5545
    says, and a floating time is read in the user's zone when the set is
    computed; on both the whole offset is wall-clock time. That is what
    Google and Nextcloud mean when they write an all-day item's reminder as
    hours from midnight (`-PT15H`: 09:00 the day before; `PT9H`: 09:00 on
    the day), so it stays 09:00 on a DST day instead of moving an hour.
  - **Absolute triggers** (`TRIGGER;VALUE=DATE-TIME`) fire once at their
    instant (a floating one in the user's zone), about their item; on a
    series' master, about the series as a whole (no one occurrence).
  - **`REPEAT` and `DURATION`** fire again, each its own reminder; one
    without the other, or a `DURATION` not positive, does not repeat.
  - **Series.** Each occurrence reminds by the alarms of the item that
    shows there: the master's, or an exception's own (an exception replaces
    its occurrence whole, RFC 5545; a client that changes one occurrence
    copies the alarms into it when it means them). `EXDATE` and a cancelled occurrence ([D35](#D35))
    remind of nothing, and an occurrence moved elsewhere reminds where it
    moved. A series too dense to expand reminds of nothing, as the views
    leave it out ([Deferred](#deferred)).
  - **Done and cancelled.** A done task ([D55](#D55): completed or
    cancelled) and a cancelled event do not remind; a done master makes
    every occurrence done, and a completed exception its own.
  - **Acknowledged.** An alarm acknowledged at or after a time it fires
    does not fire then: RFC 9074's `ACKNOWLEDGED` (Apple writes it) and
    Thunderbird's `X-MOZ-LASTACK` on the item, whichever is later. A series
    still reminds of its later occurrences. RFC 9074's snooze is a further
    alarm with an absolute trigger, so it fires; other clients' snoozes are
    [deferred](#deferred).
  - **The id** is stable while the item and its alarm stay:
    `<object id>/<occurrence>/<repeat>/<alarm>`, the occurrence by its
    recurrence id (an instant, a floating time or a date; `-` for an item
    that does not recur), the alarm by its RFC 9074 `UID`, else its place in
    the item. Two alarms of one occurrence at the same instant (Apple's
    `DISPLAY` and `AUDIO`) are one reminder.
  - **The store finds them** (`Store.reminders(range)`) without a column of
    its own: the objects whose iCalendar holds a `VALARM`, not deleted here,
    not done tasks; every such task wherever its dates are (an absolute
    alarm can remind of an overdue or undated one), and the events ending
    after the range starts less 7 days (an event's alarm fires before it or
    while it runs; one a week after its end, which RFC 5545 allows and no
    client we know writes, is not found). Every calendar reminds, hidden
    ones too: hiding is how this device shows a calendar, as in Google
    Calendar, where notifications are a calendar's own setting
    ([Deferred](#deferred)). Each object's reminders are kept while its
    iCalendar, the range and the zone stay.
- **D101. Who hands the set over, and the web's notifications.**
  `ReminderScheduler` ([android D60](android.md#D60)) lives in
  `@astrotime/core`: `schedule(reminders)` replaces every reminder handed
  over before, `onOpen` reports a tapped one, and beside them
  `permission()`, `requestPermission()` (from a gesture) and
  `whileOpenOnly`. Each reminder carries its notification's words
  ([D102](#D102)). The platform is the shell's `Platform.reminders`.
  - **When.** `ReminderPlanner` in `@astrotime/ui` computes the set from the
    store and hands it over on start, after every write to the store
    (`Store.subscribe`: a sync's writes and the changes made here alike, a
    burst costing one more run, as `liveQuery` does), at midnight in the
    user's zone (the horizon moves a day), and once the last reminder of a
    full set has fired. Turned off, it hands over an empty set. A shell
    without the UI (Android's background job, [android D67](android.md#D67))
    runs the same planner after `syncAll`.
  - **The setting.** "Reminders", a switch at the end of the drawer's
    settings ([design D96](design.md#D96): `reminders` in the one settings
    value): on unless the user turned it off, shown on once the platform may
    notify; on the web, turning it on asks the browser's permission from that
    tap, never at start. Under it, the next reminder ("Next: Call with Anna,
    Wed, Nov 4, 11:00 AM."), that the web reminds only while open, or that
    the browser blocks notifications or has none.
  - **The web reminds only while AstroTime is open in a tab.** It has no
    backend ([D3](#D3)) and so no push server, and Notification Triggers
    were never standardized; Android ([android D66](android.md#D66)) and the
    desktop ([desktop D76](desktop.md#D76)) fire with the app closed. The
    setting says so. `webReminders` (`apps/web`) keeps one `setTimeout` for
    the next reminder and checks again whenever the tab is in front again
    (visible, focused, thawed, back from the bfcache), since a hidden tab's
    timers run once a minute and a sleeping laptop's not at all: a reminder
    missed by up to 5 minutes shows on waking, an older one is dropped as
    stale (the desktop fires them up to an hour late, saying when they were
    due, from its own copy of the set). One tab shows reminders: the one
    holding the Web Lock `astrotime-reminders`; every other tab computes the
    same set and waits in the lock's queue, taking over when that tab
    closes. A notification's tag is its reminder's id, so the browser
    replaces one shown again instead of stacking it.
  - **A tap** brings the tab forward, closes the notification and opens
    the occurrence's day in the Day view (an event's start, a task's due
    or start), with its details over it ([D103](#D103)); one with no time
    opens the details only.
- **D102. What a notification says.** Its title is the item's (or
  "(No title)"); its body says when it is, as seen when it fires, in the
  user's language, with dates and relative times from `Intl`
  (`reminderNotification` in `@astrotime/ui`): an event's time range, with
  its day when that is another day ("Tomorrow, 10:00 – 11:00"); an all-day
  event's day ("Tomorrow, all day"); a task's due, or its start when it has
  none ("Due 3:00 PM", "Due today", "Starts tomorrow, 9:00"); "Task" for
  one with no date. A time less than a day ahead adds how soon ("· in 15
  minutes", "· in 1 hour", "· now"): minutes up to an hour, and up to three
  hours unless whole, then whole hours. A day or more ahead, the day says
  it; a time already passed says nothing more.
  _Added in desktop PR D3:_ each reminder also brings the body of one shown
  late (`notification.late`, [desktop D76](desktop.md#D76)): when the item
  is, without how soon, and when the reminder was due ("10:00 – 11:30 AM ·
  reminder due at 9:50 AM"; "Reminder due at 9:50 AM" for an item with no
  time to say). A platform that never shows one late ignores it.

### Editing

Decided while building PR 6a.

- **D103. An edit writes what the user changed, and nothing else.**
  `editItem` in `@astrotime/core` takes the fields the user changed
  (`ItemChanges`; the edit dialog compares its form before and after) and
  writes those properties into the parsed object, keeping their
  parameters; every other line goes back as it was ([D7](#D7)), as
  `completeTask` does (design [D94](design.md#D94)). An empty text removes
  its property. `LAST-MODIFIED` and `DTSTAMP` become now (RFC 5545
  §3.8.7.2, §3.8.7.3); `SEQUENCE` goes up by one when the time, the rule or
  an exclusion changes (§3.8.7.4's significant changes, as Google and
  Nextcloud count them), not for a title, a place, a reminder or a
  completion (design D94 already leaves it alone for those). A new
  description drops its HTML twins, Thunderbird's `ALTREP` and Outlook's
  `X-ALT-DESC`, which would show the old text in their clients. A colour is
  RFC 7986's `COLOR`, a CSS name, as Nextcloud writes it. A reminder added
  is `ACTION:DISPLAY` with the item's title as its `DESCRIPTION` (RFC 5545
  §3.6.6 asks for one), or for an item without a title the word the UI
  passes in the user's language ("Reminder", "Напоминание"; the core holds
  no UI strings, AGENTS.md rule 5), and a relative `TRIGGER`, `RELATED=END` before a
  task's due; one removed goes whole; the others stay byte for byte. A task's
  status writes what Nextcloud Tasks writes beside it (D94): `COMPLETED`
  and `PERCENT-COMPLETE:100` when completed. **A new item** (`createItem`)
  gets a random UUID, `DTSTAMP`, `CREATED` and `LAST-MODIFIED` now,
  `SEQUENCE:0`, `PRODID:-//AstroTime//AstroTime//EN`, and is stored at
  `<uid>.ics` in its calendar, the href the sync engine creates it under
  ([D37](#D37)); every write is a pending change in the store and tells
  the sync scheduler ([D91](#D91)).
  - **Onto what the store holds when saving.** A sync or another tab may
    change the item while its dialog is open; saving reads it again and
    applies the user's changes to that (`Store.changeLocal`: the read and
    the writes, a split's two objects or a move's two included, are one
    transaction, [D99](#D99)), so the other change stays. A reminder
    removed is found again by what it is, not by its place. An item deleted
    meanwhile, or an occurrence no longer in its series (excluded, or after
    a new end), is not written: the dialog says so. A `HandOverError` wrote
    nothing, so the save runs once more; after a `CommitInDoubtError` the
    store is read again, and when what the save wrote is not there the
    dialog says it is unclear whether the change was saved.
- **D104. An item keeps its zone.** An edited time is written in the zone
  the item had, with the TZID it was written with (`W. Europe Standard
  Time` stays, [D32](#D32)); a UTC time (Nextcloud Tasks writes them) is
  edited on the user's wall clock and written back in UTC; a floating time
  stays floating; a new item, or a date made a time, takes the user's zone.
  A TZID the object did not write before and does not define gets a
  VTIMEZONE (RFC 5545 §3.6.5); one already written without it (Google's
  IANA names, Outlook's Windows ones) stays as it came. It is made from
  what `Intl` knows of the zone (`vtimezone`): a yearly rule per
  observance where the zone's changes follow "the nth or last weekday of a
  month" (checked twenty years ahead), else an observance per change, from
  the year before the item's. A VTIMEZONE no longer used stays (D7). The
  edit dialog names the zone when it is not the user's; choosing another is
  [deferred](#deferred).
- **D105. What each scope writes** ([D11](#D11)), on the occurrence opened:
  - **This occurrence**: its exception, made from the master the first time
    (design D94's `exceptionOf`, which now moves an event's `DTEND` too)
    and changed in place after; deleting it adds an `EXDATE` written as the
    series' start is (its TZID, or a date) and drops its exception.
  - **This and following** splits the series, as Nextcloud and Google do
    (`RANGE=THISANDFUTURE` stays unused, [Deferred](#deferred)): the series
    ends with an `UNTIL` one second before the occurrence, in the type RFC
    5545 §3.3.10 asks (a date, the day before, for a series of dates; UTC
    for a zoned one, a date or floating `RECURRENCE-ID` read in its zone
    ([D35](#D35)); a wall clock for a floating one), a `COUNT` becoming
    that `UNTIL`; the rest is a new object under a new UID, the master
    moved to the occurrence with the edit, its own `CREATED` and
    `SEQUENCE:0`, a `COUNT` left as the occurrences remaining, and the
    exceptions, `EXDATE`s and `RDATE`s from the occurrence on (moved, not
    copied: one calendar object per UID, [D34](#D34)). From the first
    occurrence it is all of them. Deleting ends the series the same way.
  - **All occurrences** edits the master; so does an edit of a series
    with no occurrence named. A field the user changed reaches each
    exception that had the master's value; one changed on its own keeps
    it. Exceptions and `EXDATE`s that no longer name an occurrence of the
    new rule go; "does not repeat" drops the rule with its `RDATE`s,
    `EXDATE`s and exceptions.
  - **A new time moves the series as the occurrence moved**, in "all" and
    in the new series of "this and following": every time in it shifts by
    the same wall-clock time, across a DST change too. A series at 9:00
    moved to 10:00 is at 10:00, its `RDATE` at 14:00 at 15:00, and its
    `EXDATE`s and `RECURRENCE-ID`s shift alike, so they still name their
    occurrences (one of another kind than the start keeps it, [D35](#D35):
    a date moves by whole days, a floating time on its wall clock, and is
    matched by day or wall clock when stale ones are dropped); an exception not moved on its own follows with the new
    times, one moved keeps its own. Made all-day, every time moves by whole
    days; made timed, each takes the new time of day.
  - **The rule moves with it** unless the user picked a new one, as
    Google's repeat menu follows a new date: the days and hours it names
    shift as the start did, so the new start is one of its occurrences
    (RFC 5545 leaves a series whose `DTSTART` its rule does not make
    undefined). Weekdays shift by as many days (Monday, Wednesday and
    Friday a day later are Tuesday, Thursday and Saturday; "weekly on
    Tuesday" becomes "on Wednesday"); the start's nth weekday of its month
    becomes the new day's, as the repeat menu names it (the 2nd Tuesday
    moved to the 18th is the 3rd Wednesday, a day in the month's last week
    the last); the start's day of the month (`BYMONTHDAY`) and a yearly
    rule's month (`BYMONTH`) become the new day's; `BYHOUR` and `BYMINUTE`
    shift as the start's clock did. Other parts (`BYYEARDAY`, `BYWEEKNO`,
    `BYSETPOS`) stay as written. The edit dialog shows the moved rule as
    soon as the date changes (`movedRepeat`), and a rule that only moved is
    no new rule. "This occurrence" on another day leaves the rule alone:
    only its exception moves.
  - **A series held without its master** (only exceptions on the server):
    deleting this occurrence drops its exception, "this and following"
    each from it on, the last one the object; an edit changes the one
    exception. The edit dialog offers no scope for one
    ([Deferred](#deferred)).

  The edit dialog asks only what Google asks: a new day for one occurrence
  is not every occurrence's (no "All"), a new rule is not one occurrence's
  (no "This"), so a new day with a new rule is "This and following" only,
  and a move to another calendar takes the whole series without asking.

- **D106. Moving an item to another calendar is a creation there and a
  deletion here**, the same UID at `<uid>.ics`: the provider has no CalDAV
  `MOVE` ([D37](#D37)), and two pending changes upload through the paths
  the sync engine already has. A server keeps no history across the move
  ([Deferred](#deferred)).
- **D107. The Conflicts list.** The accounts dialog's count of conflicts
  has "Review", which opens the list: each conflict (`Store.conflicts`)
  with its item's title and calendar, the fields our refused version and
  what the calendar holds now (the server's version, or ours merged onto
  it) differ in, worded (`differences` in `@astrotime/core`: title, time,
  repeat, reminders, single occurrences…), and both values side by side
  for the fields that have one. **Keep the server's** drops ours
  (`removeConflict`); **Apply mine again** saves ours over what the
  calendar holds as a pending update against the server's version (its
  base), then drops the conflict, and the next sync uploads it; a creation
  whose href the server gave another item goes to `<uid>-<random>.ics`. In
  a calendar that lets nothing be edited ([D37](#D37)) only keeping the
  server's is offered. Ours is
  applied as it was refused, with its own `DTSTAMP` and `SEQUENCE`.

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
- **Splitting the bundle** — since PR 5a-3 the app's script is about 790 kB
  (250 kB compressed; the CalDAV provider and the sync engine joined it) and
  SQLite's wasm 880 kB; they are served precompressed and revalidated
  ([D80](#D80)), and splitting comes when the first load needs it
  ([D40](#D40)).
- **Display-style Windows TZIDs** — Outlook's desktop export can write
  `TZID:(UTC+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna`, the
  zone's display name, which CLDR's table does not carry (only as comments, in
  English), and its `tzone://Microsoft/Utc`, `tzone://Microsoft/Custom` and
  `Customized Time Zone`; such a time stays floating until a reader of those
  names is justified by a real file ([D32](#D32)).
- **Expanding long series from the middle** — `occurrencesBetween` walks a
  series from its first occurrence and throws `ExpansionLimitError` past
  50 000 steps (a minutely or hourly series from years ago); a start point
  or a cache comes when a real calendar hits it ([D33](#D33)). Until then
  such a series shows nowhere: the views and the "N undone tasks" chip
  leave it out, silently ([D55](#D55)). _Measured in PR 5a-2:_ a daily
  series with a `TZID` from January 2025 takes 50–90 ms to expand into
  November 2026, so 30 of them make the first read of a new range take
  about 1.6 s on the main thread (a desktop i7). The object cache keeps one
  range per object ([D54](#D54)), so each new week, month, or read of the
  Agenda (design [D87](design.md#D87)) pays it again.
- **Past days and their undone tasks** — an undone task due before today
  shows only in today's chip (design [D51](design.md#D51)), so a view of
  last week shows none on the days they were due, as in Google Calendar;
  showing them there too, marked overdue, is a later choice.
- **Plain `http` beyond localhost** — browsers give OPFS and Web Locks only
  to secure contexts, so the web store opens only over `https` or on
  localhost; elsewhere the app says so instead of failing
  (`InsecureContextError`). Self-hosting needs TLS in front (D40 already
  asks for it). The dev server over the tailnet has it: `tailscale serve`,
  or a self-signed front until the owner allows that ([D20](#D20),
  `scripts/t3/README.md`).
- **Recording Nextcloud's web apps in CI** — `scripts/record-nextcloud-fixtures.ts`
  runs by hand; a change in the apps' pages breaks it unseen until the next
  recording. A nightly run that records and compares everything but UIDs and
  timestamps comes if the apps' output changes often enough to matter.
- **Signing in to a server that redirects elsewhere, on Android and the
  desktop** — they follow redirects themselves and drop `Authorization`
  across origins ([android D62](android.md#D62),
  [desktop D72](desktop.md#D72)), so discovery there ends in a refused
  password; naming the other server, as the web does ([D92](#D92)), comes
  with their sign-in (PR A2, PR D2).

- **More of reminders** ([D100](#D100), [D101](#D101)):
  - snoozing and dismissing from AstroTime (writing `ACKNOWLEDGED` and an
    RFC 9074 snooze alarm back, a local change for the sync engine), and
    reading Thunderbird's `X-MOZ-SNOOZE-TIME` and Apple's snooze extensions,
    which are kept as written;
  - per-calendar default reminders and turning one calendar's reminders off
    (every calendar reminds, hidden ones too);
  - `EMAIL` alarms, which a server sends (Nextcloud does), not a client;
  - notifications through a service worker (`showNotification`), which
    mobile browsers require: there `new Notification` fails, and the web
    app shows none (the Android app is the way there);
  - the Android and desktop adapters: [android D66](android.md#D66)
    (PR A3) and [desktop D76](desktop.md#D76).

- **`RANGE=THISANDFUTURE`** on a `RECURRENCE-ID` is read as replacing one
  occurrence only. Nextcloud, Apple and Google split the series instead, so
  it is rare; it comes when a fixture from a real client needs it.
  AstroTime's own "this and following" splits too ([D105](#D105)).
- **Drag and resize** — moving and sizing items in the time grid
  ([D14](#D14), [D16](#D16)), and a press-and-drag on an empty slot to make
  one that long: PR 6b.
- **Editing guests** — attendees are shown, never added, removed or
  answered; it comes with sending invitations ([D9](#D9)).
- **Attachments** — `ATTACH` is kept ([D7](#D7)), not shown or edited.
- **A time-zone picker** — an item keeps its zone and a new one takes the
  user's ([D104](#D104)); writing an item in another zone needs a picker.
- **CalDAV `MOVE`** — a move to another calendar is a creation and a
  deletion ([D106](#D106)); `MOVE` would keep the server's own record of
  the item (its history, Nextcloud's shares), when the provider learns it.
- **Unsaved changes** — closing the edit dialog drops them without asking;
  Google asks first.
- **Subtasks and a task's parent from the edit dialog** — `RELATED-TO` is
  shown in the details, not set; `CLASS` and the ordering extensions are
  kept, not edited ([D10](#D10)).
- **A default calendar** — a new item goes in the first calendar that takes new items
  the views show; remembering the last one used, or choosing a default,
  comes later.
- **A series held without its master** — a server holding only exceptions
  of a series lets each be edited or deleted on its own: the edit dialog
  asks no scope for one, though `deleteItem` can delete each from one on
  ([D105](#D105)); "all" and an edit of the following ones need the master.
- **Tabs of two builds** — after an update, a tab of the new build may
  follow a leader tab of the old one until the old tabs reload: its
  migrations run on the old tab's connection while the old tab's store
  keeps writing the old way, and a later change to the tabs' messages would
  need a version in `hello` ([D98](#D98)). Nothing checks it until a build
  changes the schema or the messages in a way an old tab cannot follow; that
  build tells old tabs to reload. A tab of a build before D98 holds the lock
  without serving: a new tab says it is opening until that tab is closed or
  reloaded.

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
`nextcloud-served-*.ics` in `packages/core/test/fixtures/`. _Since then:_
`scripts/record-nextcloud-fixtures.ts` drives Nextcloud's web Calendar and
Tasks apps in a browser and records what they write as `nextcloud-web-*.ics`;
their provenance is in the fixtures' `README.md`. The nightly Nextcloud job
approves a Login Flow v2 in a browser and signs in with its app password.

### PR 5 — Calendar grid

In two parts, as the [design plan](design.md#pr-plan) splits it ([D18](#D18)):

- **5a** — `@astrotime/ui` and the web app's shell and views: Day, 3 days,
  Week, Month, Agenda; the all-day strip, the overlap layout, task
  placement; both themes; i18n; browser-mode tests and Playwright; and
  the accounts and sync wiring: signing in (Login Flow v2, password), the
  web's credentials, and when the UI syncs (on start, on focus, on a timer:
  [D91](#D91), which closed the Deferred "Scheduling syncs"). Decisions:
  D1, D13, D14, D15, D16, D17, D19, D42, design D43–D51. It lands in three
  PRs:
  - **5a-1** — `@astrotime/ui`, the shell, i18n, themes, the Day, 3-day and
    Week views, the undone tasks, demo data, Playwright (D54–D57, design
    D58, D59);
  - **5a-2** — the Month and Agenda views (design D86–D88);
  - **5a-3** — the accounts and sync wiring above; the account button in
    the top bar (D89–D92).
- **5b** — the tasks screen, the drawer's settings and search, with their
  buttons in the top bar (search, the tasks toggle), which 5a leaves out.
  Decisions: design D52, D53.

Done when, for 5a: each view renders real objects from the local store, in
both themes and both languages, as the references describe, and an account
added by password or Login Flow v2 syncs into them; for 5b: the
tasks screen lists, completes and stars tasks through the local store, the
drawer's settings apply, and search finds an item by its title. Screenshots
of each, set against the reference's description, are the evidence.

### PR 6 — Editing

Drag and resize, the details and edit dialogs for events and tasks (an
item opens them; PR 5a draws items that do not open yet), the recurrence
scope dialog, reminders as notifications; the floating "+" button creates
an event or a task (PR 5a draws it disabled). Decisions: D9, D10, D11.

In three PRs:

- **6a** — the details and edit dialogs, creating ("+", an empty slot,
  "Add a task"), deleting, the scope of an occurrence's edit and deletion,
  reminders added and removed, and the Conflicts list
  ([Deferred](#deferred) until then). Decisions: D6, D9, D10, D11,
  D103–D107, design D108, D109.
- **6b** — dragging and resizing in the time grid ([D14](#D14), [D16](#D16)).
- **6c** — reminders as notifications, landed ahead of 6a: the reminder set
  in `@astrotime/core` and the store, the planner and the "Reminders"
  setting in the UI, the web's notifications (D100–D102). Done when: the
  set's rules are unit-tested (all-day, floating, DST, `RELATED=END`,
  absolute triggers, `REPEAT`, a series with exceptions, tasks), and in the
  web app a reminder of the demo data shows at its time under a controlled
  clock and a tap opens its day.

Done when, for 6a: an event and a task are created, edited and deleted
through the local store and reach a CalDAV server; each scope of an
occurrence's edit and deletion writes what D105 says, against fixtures from
Nextcloud, Apple, Google and Outlook and across a DST change; a read-only
calendar's items open without edit; and the Conflicts list resolves a
conflict both ways. Screenshots of each dialog in both themes and both
languages are the evidence.

### PR 7 — Web proxy and release

`apps/proxy` and the Docker image, its allowlist, the release workflow that
publishes it to GHCR on a `v*` tag. Decisions: D20, D28, D40, D41; later
D80, D81 and D110.

Done when: the image builds in CI, serves the app, proxies to an allowed
server and refuses an unlisted one, and refuses to start without an
allowlist.

### Later — Android, then Linux

Each platform has its own plan, with its decisions and PRs: the Android app
(`apps/mobile`, Capacitor) in [`android.md`](android.md), then the Linux
desktop app (`apps/desktop`, Electron) in [`desktop.md`](desktop.md). Both
start once PR 5's UI lands. Decisions here: D12, D22, D28.
