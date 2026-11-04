# Providers plan

Status: **in progress** — the survey, the order and the testing policy are
decided; the interop matrix ([PR P2](#pr-p2--the-interop-matrix)) is built. This plan owns which calendar and
task services AstroTime syncs with beyond Nextcloud, how each is reached,
and how each is tested against the real thing. Foundation owns the
provider interface and the sync engine: [D2](foundation.md#D2) (generic
CalDAV), [D4](foundation.md#D4) (providers behind one interface),
[D5](foundation.md#D5) (offline-first), [D7](foundation.md#D7) (nothing
lost), [D19](foundation.md#D19) (signing in), [D20](foundation.md#D20) and
[D39](foundation.md#D39) (the web proxy), [D126](foundation.md#D126) (what
a sync costs a server) and [D145](foundation.md#D145) (the first load's
budget); this plan builds on them and does not repeat them. Its
decisions are D245–D259; D260–D264 are kept for the decisions its PRs
take while building, and no other plan numbers them.

## Goal

The owner: "support for as many other kinds of calendars as possible
besides Nextcloud/WebDAV. That needs tests for those calendars, so their
software has to be installed and checked for real through tests — but only
when the API changes, not all the time, or the tests take too long."

So: every service people actually keep their calendars in, reached the way
it allows, each proven against the real software or a recording of it, at
a cost CI can carry. The survey was done on 2026-11-04 from the services'
own documentation; what a service does that no recording has shown yet is
marked _to be recorded_.

## Decisions

### The services

- **D245. What people use, and how each syncs.** One row per service;
  "events" and "tasks" are what its protocol carries, not what its own app
  shows.

  | Service                                                                                                                        | Protocol                                                           | Auth                                   | Events         | Tasks                                                           | Needs from the owner                                                      |
  | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------- | -------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
  | Nextcloud                                                                                                                      | CalDAV                                                             | Login Flow v2, password                | yes            | yes                                                             | — (built)                                                                 |
  | Radicale                                                                                                                       | CalDAV                                                             | Basic                                  | yes            | yes                                                             | — (built, CI's server)                                                    |
  | Baïkal, Davis (sabre/dav)                                                                                                      | CalDAV                                                             | Basic or **Digest** (Baïkal's default) | yes            | yes                                                             | —                                                                         |
  | Xandikos                                                                                                                       | CalDAV                                                             | its proxy's                            | yes            | yes                                                             | —                                                                         |
  | Stalwart                                                                                                                       | CalDAV (since 0.12)                                                | Basic, app passwords                   | yes            | yes                                                             | —                                                                         |
  | Cyrus IMAP (and Fastmail, built on it)                                                                                         | CalDAV                                                             | Basic                                  | yes            | yes                                                             | —                                                                         |
  | DAViCal, SOGo, Kopano/Grommunio, Open-Xchange, Zimbra, Synology                                                                | CalDAV                                                             | Basic                                  | yes            | yes (Synology: _to be recorded_)                                | — (the self-hostable ones); Synology and Zimbra: someone's server         |
  | iCloud                                                                                                                         | CalDAV, `caldav.icloud.com`                                        | Apple ID + **app-specific password**   | yes            | only lists not "upgraded" to Reminders' format of iOS 13 (rare) | an Apple ID with two-factor sign-in, for the recording                    |
  | Fastmail                                                                                                                       | CalDAV, `caldav.fastmail.com`                                      | **app password** (CalDAV scope)        | yes            | yes                                                             | an account (a paid one; its trial is 30 days), for the recording          |
  | mailbox.org                                                                                                                    | CalDAV, `dav.mailbox.org` (Open-Xchange)                           | password                               | yes            | yes                                                             | an account (paid), for the recording                                      |
  | Yandex Calendar                                                                                                                | CalDAV, `caldav.yandex.ru`                                         | **app password** (Calendar)            | yes            | _to be recorded_ ("Дела")                                       | an account, for the recording                                             |
  | Yahoo, Zoho, GMX/Web.de, Posteo                                                                                                | CalDAV                                                             | app password (Yahoo, Zoho), password   | yes            | _to be recorded_                                                | accounts, for the recordings                                              |
  | Google Calendar                                                                                                                | CalDAV `apidata.googleusercontent.com/caldav/v2/`, or its REST API | **OAuth 2 only**                       | yes            | no (CalDAV)                                                     | a Google Cloud project, OAuth clients, the consent screen ([D257](#D257)) |
  | Google Tasks                                                                                                                   | Tasks REST API v1                                                  | OAuth 2                                | —              | yes                                                             | the same project                                                          |
  | Microsoft 365, Outlook.com                                                                                                     | Microsoft Graph (`/me/events`, To Do's `/me/todo/lists`)           | OAuth 2 (Microsoft identity platform)  | yes            | yes (Microsoft To Do)                                           | an app registration in Entra ID ([D258](#D258))                           |
  | Any published calendar (holidays, sports, a school, a shared Google or Outlook calendar's secret address, Proton's share link) | ICS over HTTP (`webcal://`, `https://…ics`)                        | none, or a secret in the URL           | yes, read-only | read-only, if the file has them                                 | —                                                                         |
  | Proton Calendar, Tuta                                                                                                          | **no API, no CalDAV**                                              | —                                      | —              | —                                                               | — (out, [D256](#D256))                                                    |
  | Exchange on premises (EWS), EteSync, Android's system calendars                                                                | EWS; Etebase; `CalendarContract`                                   | —                                      | —              | —                                                               | — (deferred, [D256](#D256))                                               |

  **Why this cut.** CalDAV covers every self-hosted server and most mail
  providers: one provider, already built, reaches them, so their cost is
  testing and naming their addresses, not code. Google and Microsoft are
  the two calendars most people have and the two that speak no CalDAV
  AstroTime can use with a password, so each is a provider of its own.
  An ICS subscription is the one way to see a calendar from anywhere else,
  Proton's included.

- **D246. The order they are built in: what needs nothing from the owner
  first.** Each is one or more PRs of the [PR plan](#pr-plan):
  1. **The interop matrix** ([D248](#D248)): the CalDAV provider against
     self-hosted servers in containers, fixing what breaks there
     (discovery, `sync-collection` against ctag and ETags, Digest, VTODO).
  2. **Known services** ([D250](#D250)): iCloud, Fastmail, Yandex,
     mailbox.org and the others in the sign-in dialog by name, their
     address filled in, the app password explained.
  3. **Subscriptions** ([D251](#D251)): a read-only calendar from an ICS
     URL, kept fresh.
  4. **OAuth 2** ([D254](#D254)) and **Google** ([D252](#D252)): built up
     to the point where the owner's OAuth clients are needed, against
     recordings and a fake server; finished once the owner has made them.
  5. **Microsoft** ([D253](#D253)): the same, after Google.

  Google comes before Microsoft because more of AstroTime's references are
  Google's (Google Calendar and Google Tasks are the behaviour references,
  [D1](foundation.md#D1)) and its events reuse the CalDAV provider.

- **D247. A known service is a CalDAV account, not a provider.** iCloud,
  Fastmail, Yandex and the rest differ from any CalDAV server only in their
  address and in where the user makes an app password. Their accounts are
  `caldav` accounts; the service is a row of data (its name, its address,
  a link to where its app passwords are made, what it carries) that the
  sign-in dialog offers, and no code of its own. A new provider is made
  only for a service whose protocol is not CalDAV with a password: Google
  (OAuth, and Tasks' REST API), Microsoft (Graph), subscriptions (a plain
  GET).

### Testing

- **D248. Real software, checked for real, only when something changed.**
  Three tiers, each run as often as its cost allows:
  1. **Every PR** (`ci.yml`, as now): unit tests on recorded fixtures of
     every server and service ([D249](#D249)), and the integration tests
     against Radicale (foundation [D27](foundation.md#D27)). Minutes, no
     network beyond the runner.
  2. **The interop run** (`interop.yml`): the same integration tests
     (`packages/sync/test/servers.test.ts`, one suite for every server)
     against every self-hostable server of D245 in a container — Baïkal
     (with Basic and with Digest), Xandikos, Stalwart, Cyrus, DAViCal,
     Davis, SOGo, as each one's container can be made to start without a
     human (the PR that adds a server says if one could not, and why, in
     [Deferred](#deferred)). It runs:
     - on a PR or a push to `main` that changes what talks to servers:
       `packages/caldav/**`, `packages/sync/**`,
       `packages/core/src/provider.ts`, the servers' definitions
       (`packages/sync/test/interop/**`) or the workflow itself (path
       filters);
     - weekly (Monday night), to catch a server's new release;
     - by hand (`workflow_dispatch`), one server or all.

     Each server's image is pinned to a version in one compose file
     (`packages/sync/test/interop/compose.yaml`), which Dependabot's
     `docker-compose` ecosystem bumps: a new server release is a PR that
     changes the compose file, so the path filter runs the interop run
     on exactly the change that may break it. This is "only when the API
     changes": the code's side by the path filter, the server's side by
     Dependabot and the weekly run. It is not a required check (a
     required check that a path filter skips blocks every other PR), so a
     failure is read in the PR and by the orchestrator, not by branch
     protection; the weekly run's failure opens no issue by itself, it
     shows on the Actions page and in the owner's GitHub notifications.
     Each server runs as its own job, one test file at a time, so one
     server's failure names itself and does not hide another's.

  3. **The cloud run** (`interop-cloud.yml`): the same suite against the
     cloud services (iCloud, Fastmail, Google, Microsoft…) from test
     accounts the owner makes, their credentials only in GitHub secrets the
     owner creates ([D249](#D249)). By hand, and monthly; a provider's PR that
     changes its cloud code may run it by hand. A service without its
     secrets is skipped, said so in the job's summary, not failed. Never
     on a PR from a fork (secrets do not reach one anyway).

  **Why not every time.** Seven containers, each a few minutes to start
  (SOGo and Cyrus the slowest), would more than double CI's time on PRs
  that touch only the UI, which is most of them; and a server's behaviour
  changes when its release or AstroTime's protocol code changes, which
  the filters and the weekly run catch. Cloud services also cost the
  services something and can lock an account that signs in too often,
  so they are recorded
  ([D249](#D249)) and run live rarely.

- **D249. Recordings: what every PR replays.** A service whose real
  server cannot run in CI (iCloud, Fastmail, Google, Microsoft, Yandex)
  is recorded once from a test account by a script
  (`scripts/record-<service>.ts`, by hand, as
  `scripts/record-nextcloud-fixtures.ts` does) into
  `packages/<provider>/test/fixtures/<service>/`: each request and its
  answer, with the account's name, e-mail, tokens, cookies and every
  `Authorization` taken out and replaced by fixed stand-ins before the
  file is written (the script refuses to write a file that still holds
  the test account's address or a token). Unit tests replay them through
  an `HttpClient` that answers from the recording and fails on any
  request it does not hold, so a change that sends a request the service
  was never asked fails at once. A recording is made again by hand, or
  by the cloud run's job with `record: true`, which uploads the new files
  as an artifact for a PR, never commits them. A self-hosted server's
  `PROPFIND` answers, where a unit test needs one, are recorded from the
  interop run's container the same way (as Radicale's and Nextcloud's
  are now, `packages/caldav/test/fixtures/README.md`).
  _Built:_ `packages/caldav/test/recording.ts`: the recorder (each
  request's `Authorization` kept as its scheme alone, its values in
  memory only; each request's server too, as a service answers on several,
  iCloud's `pNN-caldav`), the stand-ins put in word by word into the
  values themselves, quotes, line breaks and non-ASCII as they are, never
  the file's keys; the ids to put out found in every address the
  recording holds (requests, answers, every `href`: owners, shares,
  principals) and every other user's `mailto:`, from the recording alone,
  with no request more to the account (`standInsFor`); and **the guard**
  (`leaks`), which looks at the file to be written on its own, whatever
  the stand-ins did, for every spelling of the account's values as a raw
  substring in any case: the user name and e-mail, the password, each
  URL-encoded, JSON- and XML-escaped, the e-mail's local part and its
  domain (unless a public mail domain), Basic's base64 of them, and every
  Digest `response` and `cnonce` sent; any of them found, nothing is
  written. Only a local test server's fixed user name (the interop run's
  `astro`) may be declared public. The strict replay answers in order,
  checks each request's server, scheme and the headers that change what
  it does (`Content-Type`, `If-Match`, `If-None-Match`, `Prefer`), and
  recomputes a Digest answer against the challenge whose nonce it names
  (a parameter read whole: `nonce`, never `cnonce`'s), so a replay proves
  Digest too.
  `scenario.ts` makes a calendar named for the run (`astrotime-recording-`,
  a time and a random part), removes what an earlier run left under that
  prefix first, and tries its cleanup twice; a cleanup that fails after
  the scenario failed is reported beside that failure, never in its
  place. `scripts/record-caldav-service.ts`
  and `services.test.ts` complete it, first proven on the interop run's
  Baïkal (Digest), Xandikos and DAViCal (`fixtures/services/`). Recording
  Xandikos found AstroTime's own scenario writing a `SUMMARY` with an
  unescaped comma, which Xandikos serves back escaped (RFC 5545 §3.3.11
  asks for `\,`): the scenario's text has none now.

### Known services and subscriptions

- **D250. Known services in the sign-in dialog.** The dialog's CalDAV
  choice offers a list of services by name (iCloud, Fastmail, Yandex,
  mailbox.org, Yahoo, Zoho, Posteo, GMX, Web.de; "Other server" for an
  address) with the help each needs ("Make an app-specific password at
  appleid.apple.com: your Apple ID password is refused"), the address
  filled in and not shown. A service's data is in one table of
  `@astrotime/caldav`; which services show is not up to the page: on the
  web, a service off the proxy's allowlist ([D20](foundation.md#D20)) is
  refused with the dialog's "not-allowed" words as an address would be.
  A service is listed only once a recording or an interop run has shown
  that discovery and a sync work on it; until then it is "Other server"
  with its address typed, and the PR that adds it says which.

- **D251. Subscriptions: a calendar from an ICS address, read-only.** A
  new provider, `ics`, in a package of its own: one account per address,
  one read-only calendar (`NO_RIGHTS`, foundation [D37](foundation.md#D37)'s "what the user may do in a calendar"), its name from
  the file's `X-WR-CALNAME` (or the address's host), its colour from
  `X-APPLE-CALENDAR-COLOR` or `COLOR` (RFC 7986) if the file has one.
  `webcal://` is read as `https://`. A sync is one conditional `GET`
  (`If-None-Match` with the last `ETag`, `If-Modified-Since` with the
  last `Last-Modified`): a `304` changes nothing; a `200` is split into
  one calendar object per `UID` (a series with its exceptions together,
  with the file's `VTIMEZONE`s each needs), each kept as its own object
  in the store under the href `<the address>#<the UID, percent-encoded>`
  (one per UID, never sent anywhere: the file is the only resource), its
  ETag the hash of its text, and objects whose UID is gone are removed.
  **A bad answer never empties a calendar.** A `200` is applied only when
  its body parses as one `VCALENDAR` (whatever its `Content-Type`: many
  servers send `text/plain` or `application/octet-stream`); an HTML page
  (a sign-in page, a captive portal), a truncated file (no `END:VCALENDAR`)
  or anything that does not parse is a failed sync that changes nothing,
  reported in words. A parsed file that would remove every object of a
  calendar that had some, or more than half of one with at least 20, is
  held: nothing is removed, the account's sync status says how many would
  go, and the user applies it ("Remove N events") or leaves it; the next
  answer that does not remove so many applies as usual. It syncs with the others, at most hourly unless the
  user asks ("Sync now"), or as the file's `REFRESH-INTERVAL` (RFC 7986)
  or `X-PUBLISHED-TTL` asks, if longer. Nothing is ever written back. A
  secret in the URL (Google's "secret address", Outlook's published
  calendar) is a credential: it is kept in the secret store, not the
  account's row, and shown in the UI with its path cut. On the web it
  goes through the proxy like any server, so it must be on its allowlist;
  Android and the desktop reach it directly. The proxy's URL space
  ([D39](foundation.md#D39)) puts the whole address in the request's
  path, so the proxy logs no request's path or query: its own log names a
  failure by method and origin only, and the image documents that a
  reverse proxy in front of it should not log `/dav-proxy/` paths either
  (P4 tests the first and fixes any log line that names a path).

### OAuth providers

- **D252. Google: one account, one provider, two APIs: events over
  Google's CalDAV, tasks over the Tasks API.** A Google account is one
  account of provider `google` (`Account.provider` stays one key per
  account). Its provider is a composite: each `Provider` call names a
  calendar or an href, and the provider sends it on by its URL, a
  calendar under `apidata.googleusercontent.com/caldav/v2/` to the CalDAV
  provider with a bearer token, a task list under
  `tasks.googleapis.com/tasks/v1/lists/` to the Tasks code. Its
  `calendars()` is both lists in one. So the sync engine and the store see
  one account, as the user does, and nothing outside the package knows
  there are two APIs (AGENTS.md rule 4).
  Google Calendar's CalDAV endpoint takes an OAuth 2 bearer token, not a
  password, and speaks the CalDAV the provider already speaks, so events
  stay iCalendar end to end ([D7](foundation.md#D7)) and reuse every test
  of it. Google's CalDAV carries events only, never tasks. How it keeps a
  series with its `RECURRENCE-ID` exceptions, and which calendars it
  serves read-only (birthdays, holidays, other people's), is _to be
  recorded_ in P5 before anything is written through it; if a recording
  shows a write that loses properties, events move to the Calendar REST
  API, mapped and written field by field as Google Tasks is below, and
  this decision says so. Google Tasks has no CalDAV: the provider's Tasks code maps the
  Tasks API (`tasklists`, `tasks`: title, notes, due as a date, status,
  completed, parent, position, links) to `VTODO`s in the store and back,
  each task list a calendar of `VTODO`s. A write sends only what the user
  changed (`PATCH` of the fields an edit touched), so whatever Google
  keeps that iCalendar cannot say (a task's `position`, `links`, assigned
  Docs) is never overwritten: D7's promise kept on the server's side.
  What a `VTODO` says that Google Tasks cannot keep (a time on the due,
  a start, priority, categories, reminders, recurrence) is not offered by
  the edit dialog for such a list, as a read-only field is not
  ([design D159](design.md#D159) shows what a task has). A task's
  `VTODO` in the store holds what Google gave and nothing else, and after
  each write it is made again from Google's answer, so the store never
  holds a property Google dropped (D7 locally: what is in the store is
  what the server keeps). One sign-in adds both: one Google account, with
  its calendars and its task lists.
  Changes are found with CalDAV's `sync-collection` for events and the
  Tasks API's `updatedMin` with `showDeleted` for tasks. Google's APIs
  answer CORS, its CalDAV does not: on the web events go through the
  proxy, whose allowlist is the deployment's ([D20](foundation.md#D20)):
  a deployment that names a Google client ([D254](#D254)) has
  `https://apidata.googleusercontent.com` added to its allowlist by the
  image itself, as the preset's server is ([D123](foundation.md#D123)),
  and the image's documentation says so; Android and the desktop need no
  proxy.

  _Decided while building (P5's third part), D7 against what Google keeps:_
  a **notice**, not a second copy. A write sends the fields Google keeps
  (title, notes, the due day, status; an insert the same), and names what
  the item said that Google could not keep (`WriteResult.dropped`: a
  priority, categories, a time on the due, a status other than done or
  not, reminders); the sync reports it once as the problem `not-kept`
  as one line for a sync's every such write with what was not kept ("3
  items: the service did not keep PRIORITY, CATEGORIES; it stays on this
  device until the items change there", in words that load with it,
  `i18n/subscribe.ts`), apart from the sync's failures, since the writes
  went through. The store keeps the item as it
  was written here until Google's version of it changes, which then
  replaces it, as any server's does ([D5](foundation.md#D5)); keeping
  local extras over Google's answer would need the engine to merge every
  download with what is stored, a second source of truth this plan
  refused for Microsoft too ([D253](#D253)). The edit dialog for a Google
  list will offer only what Google keeps, so a notice comes only from an
  item made elsewhere (moved, imported). _Built:_ `@astrotime/google` —
  `GoogleTasks` (lists, tasks with `updatedMin` and deleted ones, paged,
  the next `updatedMin` the latest `updated` a listing saw, Google's
  clock and never the device's; the first listing removing what Google no
  longer has; `PATCH` of the kept fields, `completed` cleared when a task
  is reopened, and a done task's `COMPLETED` sent as its `completed`; a
  parent set by `insert`'s `parent` and changed by `move`, never lost,
  and only from a `RELATED-TO` with `RELTYPE=PARENT` (or none) naming a
  task of the same list, any other said not kept; the Tasks API taking no `If-Match`, so the last write wins),
  `vtodoOf` and `taskFieldsOf` (the mapping both ways, lines folded at 75
  octets of UTF-8, never inside a character; Google's `position` kept as
  `X-GOOGLE-TASKS-POSITION`, read-only), and
  `GoogleProvider`, the composite that sends each call to the API whose
  address it names, and lists both sides so that one failing (the Tasks
  API not enabled, its scope not granted) leaves the other syncing: the
  engine's `PartialListing`, the side not read reported `failed` and its
  calendars kept as they were, not removed (a side signed out or offline
  is the account's, `AuthError` or `OfflineError` stopping the sync as
  ever); proven against a fake Tasks API through the engine
  and a real store. The account's sign-in, its `google` row and secret,
  the registry's entry and the dialog's button come with the owner's
  clients ([D257](#D257)), as does recording Google's CalDAV. The first
  load shrinks by 24 bytes (127 443 to 127 419 on main `6ab69ea`: the
  engine's `not-kept` in, and the held removal's and the not-kept notice
  one lazy part, `components/held-removal.tsx`), `@astrotime/google`
  loading with a Google account.

- **D253. Microsoft: Graph, events and To Do.** Outlook's calendars and
  Microsoft To Do have no CalDAV; Microsoft Graph carries both
  (`/me/calendars/{id}/events`, `/me/todo/lists/{id}/tasks`) and answers
  CORS. A provider `microsoft` maps Graph's events and tasks to
  iCalendar in the store and back, with Graph's `delta` queries for
  changes, and writes only
  what changed (`PATCH`), as [D252](#D252) does for Google Tasks. The
  store keeps iCalendar only, as for every provider
  ([D5](foundation.md#D5)): no second copy of an item in Graph's JSON,
  which would be a second source of truth to keep in step with every
  edit. What changed is found as for any provider, by comparing the edited
  object with its base ([D37](foundation.md#D37)), and each changed
  property is sent as its Graph field; what Graph keeps that the store
  does not hold stays on Graph's side, untouched, because no `PATCH`
  names it ([D7](foundation.md#D7)'s promise kept on the server's side).
  Graph fields worth showing that iCalendar has no property for (an
  online meeting's link, the item's page in Outlook) are read into the
  `X-` properties Outlook's own iCalendar export writes for them
  (`X-MICROSOFT-SKYPETEAMSMEETINGURL`, …), and are never written back:
  Graph sets them itself. Graph's `changeKey` is the object's ETag.
  **Series.** `calendarView/delta` lists occurrences in a window, not
  the series, so it is not used: a calendar's events come from
  `/me/calendars/{id}/events/delta` (single events and series masters,
  `type: seriesMaster` with its `recurrence`, which maps to an `RRULE`),
  and each changed master's changed and cancelled occurrences from
  `/events/{id}/instances` over the range the store keeps, which become
  its `RECURRENCE-ID` exceptions and `EXDATE`s in one calendar object, as
  CalDAV keeps a series. Writes go the same way back: an edit of the
  series is a `PATCH` of the master; an edit of one occurrence is a
  `PATCH` of that occurrence's own event (`type: exception`), and a
  deleted occurrence a `DELETE` of it, as Outlook does. Whether
  `events/delta` returns masters for every calendar kind (shared, group
  calendars) and how `instances` pages a long series is _to be recorded_
  in P6 before anything is written; what does not hold is recorded here.
  Tasks come from `/me/todo/lists/{id}/tasks/delta`. It comes after
  Google ([D246](#D246)).

  _Built, against a fake Graph until the owner's client exists
  ([D258](#D258)):_ `@astrotime/microsoft` — `OutlookCalendars` (the
  calendars of `me/calendars`, read-only where `canEdit` is false; each
  calendar's single events and series masters, pages followed by
  `@odata.nextLink`; every time asked as an instant (`Prefer` in UTC)
  and written in the event's own zone, `originalStartTimeZone` (an IANA
  name or a Windows one, `W. Europe Standard Time`), with its VTIMEZONE
  ([foundation D104](foundation.md#D104)), so a series keeps its wall
  clock across a DST change ([D33](foundation.md#D33)), its `BYDAY` its
  start's weekday and its `UNTIL` its end day's last second there; a
  floating time written back in the user's zone, a TZID's in its own;
  an all-day event's day that of its midnight's instant in its own zone
  (Vilnius's 6 November begins on the 5th in UTC; a zone not known
  here, the nearest midnight), and a day made here the user's midnight;
  a changed master's
  exceptions from `instances` over a year before today and two after,
  one calendar object whose ETag is the master's and its exceptions'
  together; a write the `PATCH` of the fields that differ from Graph's
  version read just before, with the event's `If-Match`, `412` a
  conflict for the sync's merge, `404` gone; a create carrying the UID
  as Graph's `transactionId`, so one sent again after its answer was
  lost is the event Graph made then, not a second; a rule or a field removed
  here sent as `null` or empty (a series made single, a place cleared);
  a rule leaving its days to the start (`FREQ=WEEKLY`, as Google and
  Nextcloud write it) taken from the start, RFC 5545's reading; a rule
  Graph's `recurrence` cannot say (a month-day list, `BYMONTHDAY=1,15`,
  or one from the end, `-1`) not sent and said not kept, the event
  written without it; an
  exception under its series' UID ([D34](foundation.md#D34)), whatever
  its own `iCalUId`), `MicrosoftTodo`
  (lists and tasks the same way, a task with no ETag on either side
  fetched again ([D37](foundation.md#D37)), `importance` as `PRIORITY`,
  what To Do has no field for said not kept), `rruleOf` and `recurrenceOf` (each of
  Graph's patterns both ways) and `MicrosoftProvider`, the composite
  routing by address with one side failing leaving the other syncing, as
  Google's ([D252](#D252)); iCalendar's lines from `@astrotime/core/lines`.
  Until Graph is recorded (P6's "Done when"), what a recording decides is
  built the plain way: **no `delta` yet** — each sync lists a calendar's
  events and a list's tasks in full and compares their ETags, which
  holds on every calendar kind, where `delta`'s masters are not proven;
  an exception edited in Outlook with its master untouched arrives with
  the master's next change; a cancelled occurrence (`EXDATE`) is not
  read; an occurrence's own edit here is not written, and is said not
  kept (`RECURRENCE-ID`), as is a series made here with exceptions. The
  account's sign-in and the dialog's button come with the owner's client.
  The first load grows by 90 bytes (127 406 to 127 496 on main
  `1d6f7fb`), the engine's partial listing ([D252](#D252)), known by its
  fields so that the class stays with the providers; `@astrotime/microsoft`
  loads with a Microsoft account.

- **D254. OAuth 2 on every platform: the authorization code with PKCE.**
  One flow, `@astrotime/oauth` (isomorphic, AGENTS.md rule 1): the
  authorization URL with a PKCE challenge (S256) and a `state`, opened
  with the platform's `openExternal`; the code back at the platform's
  redirect; the code and the verifier exchanged for an access token and a
  refresh token; the refresh token kept in the secret store like a
  password ([android D60](android.md#D60)), the access token in memory
  and refreshed when it expires or a request answers `401`. A refused
  refresh (revoked access) is the account's "signed out", as a refused
  password is. The redirect, per platform:
  - **Android**: a custom scheme (`io.github.astroreen.astrotime:/oauth`,
    the app's id, as Google asks of Android clients; Microsoft takes the
    same URI, so Android has one redirect for both), through a Custom
    Tab, back by an intent filter;
  - **the desktop**: a loopback address on a free port
    (`http://127.0.0.1:<port>/oauth`), opened by the main process for
    the one request, as Google and Microsoft allow desktop clients;
  - **the web**: the app's own page (`/oauth`), back in the same tab.
    The page's origin must be registered with the client, so each web
    deployment registers its own clients and names them in its
    environment (`ASTROTIME_GOOGLE_CLIENT_ID`,
    `ASTROTIME_MICROSOFT_CLIENT_ID`), carried to the page in `<meta>`
    tags as the preset is ([D123](foundation.md#D123)); without one, the
    web's sign-in dialog does not offer that service. Google's web
    clients must send their secret with the code, so on the web the image
    exchanges and refreshes Google's codes itself, adding the secret from
    its environment (`ASTROTIME_GOOGLE_CLIENT_SECRET`), keeping nothing
    (a stateless pass-through like the proxy, [D3](foundation.md#D3));
    Microsoft's single-page clients need no secret.

  Android's and the desktop's client ids are the project's own, made by
  the owner ([D257](#D257), [D258](#D258)) and given to their release
  builds from GitHub's repository variables, never written in the repo
  (a desktop client's secret, which Google issues but says is not
  secret, is kept so too). A build without them does not offer the
  service.

  _Built, the groundwork (P5's first part):_ `@astrotime/oauth` —
  `authorization` (the URL with an S256 challenge of a fresh 43-character
  verifier and a `state`), `codeOf` (the redirect read back: an error it
  says first, a denial coming back without a state too, then a `state`
  of another sign-in's refused), `exchange` (the
  code and the verifier for the tokens; a service that gives no refresh
  token is refused, a sign-in must last), `tokenSource` (the access
  token while it lasts (`expires_in` a number or a number in a string),
  renewed a minute before its end and when a server
  refuses it, renewals at once sharing one request, a rotated refresh
  token kept through `keep`, or, when the device cannot keep it, the new
  access token used all the same and `TokenNotKeptError` reported to the
  account (`report`, on the early renewal and after a `401` alike: after a
  restart it will have to sign in again); a renewal before the end that fails offline or
  busy keeps the token that still works and is tried again with the next
  request; a 401 for a token another request replaced renews nothing
  more; `invalid_grant` of a refresh token is `AuthError`, the account
  signed out, of a code `OAuthRefusedError`, that sign-in refused), and `GOOGLE`, `MICROSOFT` (their endpoints and
  scopes). The CalDAV provider takes a `TokenSource` where it took a
  password (`Authorization`: `Bearer`, renewed once on a `401`; its
  `credentials` are `null` then, not an empty password), and never sends
  a token over plain http to another host than this device (`inClear`,
  [D262](#D262)): OAuth's services are all https. Proven
  against a fake authorization server that checks the verifier, the
  redirect URI and the client as a real one does; the platforms'
  redirects (Android's scheme, the desktop's loopback, the web's
  `/oauth`) and the Google provider come next, the owner's clients
  ([D257](#D257), [D258](#D258)) last. The first load grows by 94 bytes
  (127 166 to 127 260 on main `4569838`: the bearer branch; its header
  and renewal are `bearer.ts`, loaded with the first OAuth request);
  `@astrotime/oauth` loads with an OAuth account.

  _Built, the redirects (P5's second part):_ `Platform.oauth`, an
  `OAuthRedirect` (`@astrotime/oauth`): `begin` gives the redirect URI
  for the authorization URL, `open` shows the service's page and
  resolves with the redirect's address (`null` when the user left it),
  `cancel` stops waiting. **Android:** `io.github.astroreen.astrotime:/oauth`,
  an intent filter on the main activity, the page in a Custom Tab, the
  answer from `appUrlOpen`, the tab closed by the user (`browserFinished`)
  no answer, though only after a moment (1.5 s): Android may tell the tab
  closed before it hands the app the redirect that closed it, and that
  redirect wins; a tab that cannot open ends the sign-in, nothing left
  listening. The intent filter names no host: the redirect is one slash,
  `io.github.astroreen.astrotime:/oauth`, the form Google asks of Android
  clients, so the app checks the address again before it takes it
  (`apps/mobile/src/oauth.ts`). **The desktop:** a loopback
  server of the main process on `127.0.0.1` and a free port, for one
  request to `/oauth` that carries the sign-in's own `state` (an error
  with it too; anything else a `400`, the server waiting on), its page a
  check mark under `default-src 'none'`
  (the app says the words), closed once the browser has that page (its
  `finish`), a cancel, or 15 minutes (`apps/desktop/src/main/oauth.ts`, the `oauth*` channels).
  **The web:** the page in a window of its own, the answer at
  `oauth.html`, whose script (`oauth.js`, allowed as the app's own by its
  policy) posts its address to the app's tab over the origin's
  `BroadcastChannel` and closes, so the app's tab keeps its state
  (`apps/web/src/oauth.ts`). The window is opened empty in the click
  itself, before anything is awaited (`begin` is called there), so no
  popup blocker holds it, its `opener` cut before it goes anywhere so the
  service's page cannot reach back into the app, and sent to the service once the URL is
  made; a window the browser refused is `PopupBlockedError`, with the
  service's page for a link the user opens. The app does not watch that
  window: `open` ends with the answer or `cancel`, which closes it, and
  the sign-in offers its Cancel while it waits. And from the review of the groundwork: a
  refresh refused for good (`invalid_grant`, `invalid_scope`) signs the
  account out; the app's own client refused (`invalid_client`,
  `unauthorized_client`: a deployment's registration changed), which
  signing in again would not mend, is tried again later as a busy service,
  the sync's back-off holding it (foundation D128); a `429`
  or a `4xx` that is no OAuth answer is tried again later
  (`ServerBusyError`); a client's `extra` goes first, so it cannot stand
  in for the sign-in's state, challenge or redirect; a token for an
  address in clear is `InClearError` (`@astrotime/caldav/bearer`, loaded
  with the first OAuth request). The first load grows by 85 bytes
  (127 264 to 127 349 on main `87faa6c`).

### Weight and privacy

- **D255. A provider loads only with an account of its kind.** The sync
  engine opens an account's provider through a registry keyed by
  `Account.provider`, each entry a dynamic `import()` of the provider's
  package (`connectCalDav` stays the CalDAV entry). The first load holds
  the registry and no provider; CalDAV, already on it, moves to a lazy
  chunk when a PR needs its room ([D145](foundation.md#D145)'s Deferred,
  "the sync stack with its first use"). The sign-in
  dialog's new choices (the known services' table, the subscription form,
  the OAuth buttons) load with the sign-in dialog, never before. Each PR
  measures the first load before and after; none may add more than 0.1
  KiB to it, net. The registry (P4) is not exempt: the room it needs is
  made in the same PR by moving something off the first load first (the
  sign-in dialog, which is on it today, is the first candidate), and the
  PR says what moved and both numbers.
  _Built, the room:_ the sign-in dialog loads with its first opening, as
  the edit dialog does ([D145](foundation.md#D145)'s `deferred`, in
  `components/lazy.tsx`), its forms and Base UI's tabs in a chunk of 5.4
  KiB; the buttons every dialog shares moved to `components/buttons.ts`
  so the others need not load it. AstroTime's own first load went from
  133 193 to 131 170 bytes (130.1, over the budget after #126 and #135, to 128.1 KiB), the room P4's registry
  and subscriptions come into. The `SignIn` steps (`accounts/sign-in.ts`)
  stay, as the accounts' context takes up a held approval with them.

- **D256. What is not built, and why.**
  - **Proton Calendar** has no API and no CalDAV, and Proton's Bridge
    carries mail only. A Proton calendar shared "with anyone by link"
    can be subscribed to ([D251](#D251)), read-only; nothing more is
    possible without Proton's own client.
  - **Tuta** keeps calendars end-to-end encrypted with no API; it exports
    ICS files only, which an import could read (Deferred).
  - **Exchange on premises** speaks EWS (Microsoft began retiring EWS
    for Exchange Online on 1 October 2026, so Graph is the only way to
    Exchange Online now); an on-premises Exchange is Deferred until
    someone asks.
  - **EteSync** speaks its own end-to-end protocol (Etebase); Deferred.
  - **Android's system calendars** stay foundation's
    [Deferred](foundation.md#deferred) item.

- **D257. What the owner makes for Google, step by step** (when the
  OAuth PR is ready for it; nothing is needed before):
  1. At console.cloud.google.com, a project "AstroTime"; in its API
     library enable three APIs: "CalDAV API" (the events, [D252](#D252)),
     "Google Tasks API" (the tasks) and "Google Calendar API" (the
     calendars' list and colours, if P5's recording needs it; enabling
     it costs nothing).
  2. The OAuth consent screen: External; the app's name, the owner's
     support address, the scopes
     `https://www.googleapis.com/auth/calendar` and
     `https://www.googleapis.com/auth/tasks`; while it is "Testing", test
     users are the accounts listed there (up to 100), and their refresh
     tokens last 7 days. Publishing it ("In production") with these
     scopes, which Google calls sensitive, needs Google's verification
     (a privacy policy at a public URL, a short video of the consent),
     which ends the 7-day limit and the unverified-app warning.
  3. OAuth clients: **Android** (package `io.github.astroreen.astrotime`,
     the SHA-1 of the debug and of the release signing keys, "Enable
     custom URI scheme" in its advanced settings); **Desktop app**; and
     for the owner's own web deployment a **Web application** client
     with that deployment's origin and `http://localhost:5180` as authorized
     JavaScript origins and `<origin>/oauth` as redirect URIs.
  4. A Google account for the tests only (not the owner's own), a test user of
     the consent screen, with a refresh token for the cloud run made by
     `scripts/record-google.ts`; the client ids as repository variables
     (`ASTROTIME_GOOGLE_*_CLIENT_ID`), the desktop and web secrets and the
     test account's refresh token as repository secrets.

- **D258. What the owner makes for Microsoft, step by step** (when the
  Microsoft PR is ready for it):
  1. At entra.microsoft.com (free with a personal Microsoft account), an
     app registration "AstroTime", "Accounts in any organizational
     directory and personal Microsoft accounts".
  2. Platforms: **Single-page application** with the owner's deployment's
     `<origin>/oauth` and `http://localhost:5180/oauth`; **Mobile and
     desktop applications** with `io.github.astroreen.astrotime:/oauth`
     (the one form every platform and both services use, [D254](#D254))
     and `http://localhost`; "Allow public client flows" on.
  3. API permissions, delegated: `Calendars.ReadWrite`,
     `Tasks.ReadWrite`, `offline_access`, `User.Read`. A work account's
     organisation may ask its admin to consent; "publisher verification"
     (a Microsoft Partner Network id) removes the "unverified" mark.
  4. An Outlook.com account for the tests only, its refresh token as a
     repository secret, the client id as a repository variable
     (`ASTROTIME_MICROSOFT_CLIENT_ID`).

- **D259. Privacy: what each service gets.** A provider sends a service
  only what syncing the user's own account there needs, with the user's
  own credentials, from the device (or through the web's stateless
  proxy); AstroTime has no server that sees it ([D3](foundation.md#D3)).
  A subscription's server sees the device's address and a conditional
  `GET` once an hour at most. Google and Microsoft see what their own
  clients would; the web image, when it exchanges Google's codes
  ([D254](#D254)), passes them through and keeps nothing. No service is
  told about another, and none is reached unless the user added an
  account there.

### Decided while building

- **D260. Digest, when a server asks for it.** The interop run's first
  finding: Baïkal authenticates with HTTP Digest by default (its
  `dav_auth_type`), and AstroTime sent Basic only, so a Baïkal of
  default settings refused every sign-in as a wrong password. The CalDAV
  provider now sends Basic first over https and to this device, as every
  other server takes it, and a `401` whose `WWW-Authenticate` offers
  Digest (RFC 7616: MD5, SHA-256 and their `-sess` forms, `qop=auth` or
  none) is answered once; the account's provider then stays on Digest. A
  stale nonce (`stale=true`), or a new nonce given without saying so (as
  nginx's Digest does), is taken up and the request sent again; a refusal
  of the very challenge a request answered is the credentials refused,
  never a loop (`Authorization`, `auth.ts`). The header is read as RFC
  9110 §11.6.1 writes it: several challenges in one header, quoted values
  read whole, a comma, `=` or "Digest" inside one too (`challengesOf`).
  **Over plain http to another host** the first request goes without
  credentials, to learn the scheme, then Basic or Digest as the server
  asks: a first Basic there would put the password on the wire in clear
  to a server that may only take Digest. The price is one request more per
  sync on such a server (none over https, where Basic first saves that
  round trip, nor on this device). **A server that takes Basic only, over
  plain http, still gets the password in clear**, from its second
  request on: nothing on the client can protect it there, and the user
  chose it by typing an `http://` address; the sign-in dialog says so
  under such an address (on another host than this device), to be built
  with the next change to the dialog once it loads lazily (D255). Requests
  in flight together are each judged by what they were signed with: one
  sent with Basic, or with an older challenge, before another's `401`
  taught the current one, is sent again with it, not taken as a wrong
  password. A Digest answer's count (`nc`) is taken as it is signed,
  before anything is awaited, so no two share one; they may reach the
  server out of order, which a nonce's count allows (sabre/dav does not
  order them). It
  costs a Digest server one request more per sync (the first, refused);
  remembering the scheme with the account would save it, when a budget
  test on a Digest server asks ([Deferred](#deferred)). The web proxy
  passes the challenge as `x-astrotime-www-authenticate`, since a
  `WWW-Authenticate` on the app's own origin would make the browser ask
  for a password itself ([D39](foundation.md#D39)). MD5, which Web Crypto
  lacks, and the challenge's parsing are a chunk of their own
  (`digest.ts`, 1.4 KiB), loaded at a server's first `401`. **The room on
  the first load** ([D255](#D255)) came from Nextcloud's Login Flow v2:
  `startLoginFlow` and `resumeLoginFlow` load with the first sign-in
  (`@astrotime/caldav/login-flow`), `revokeAppPassword`, which removing
  an account needs, staying (`app-password.ts`); the flow imports the
  core's `provider.ts` alone, not its index, so its chunk splits nothing
  else off the first load. With all of the above AstroTime's own first
  load went from 132 492 to 132 468 bytes (129.4 KiB both), measured on
  main `688c51a` with #134 rebased on it.

- **D261. The interop matrix, as built.** `packages/sync/test/interop/`:
  `compose.yaml` pins each server, `servers.ts` names where each listens
  (the address a user would type) and makes the tests' calendars where
  discovery finds the home, so nothing in it knows a server's paths;
  `servers.test.ts` adds the server `ASTROTIME_INTEROP` names to Radicale
  (and Nextcloud, nightly). What joined, and what each taught:
  - **Baïkal 0.10.1, with Digest and with Basic** (`ckulka/baikal`),
    configured without its install wizard: `baikal/setup.sh` writes the
    `baikal.yaml` the wizard would, its SQLite database from its own
    schema and the user. Its nginx answers `.well-known/caldav` with an
    absolute redirect naming the port nginx listens on, so a deployment
    whose public port differs (a container mapped `8080:80`) redirects to
    a port that does not answer: there AstroTime is offline on Android and
    the desktop and told "another server" on the web, and the user signs
    in with the `…/dav.php/` address instead. The setup listens on the
    mapped port, as a deployment that redirects correctly does.
  - **Xandikos 0.4.10**, as its documentation deploys it: authentication
    is its reverse proxy's (its own `--htpasswd` needs TLS), so it takes
    any credentials.
  - **DAViCal** on PostgreSQL 16 (`tuxnvape/davical-standalone`, pinned
    by digest: it has no version tags), its administrator as the user.
    Its `.well-known/caldav` answers `405`; discovery goes on from the
    address, `…/caldav.php/`, as D2's fallback does.

  On each the whole suite passes (discovery, both ways between two
  devices, series split, deletion, `sync-collection`, offline edits,
  merges and conflicts, the web proxy, the round trip of every property).
  What did not join is in [Deferred](#deferred).

- **D262. The sign-in dialog says when an address is in clear.** Under
  the server's address, as soon as it is typed, an `http://` address of
  another host than this device ([D260](#D260)'s `inClear`: not https,
  not `localhost`, `*.localhost`, a literal IPv4 of 127.0.0.0/8 or
  `[::1]`; `127.evil.example.com` is another host) gets one line in the
  danger colour: "This address is not encrypted: your password could be
  read on the way. Use https:// if the server offers it." It is the
  field's description for a screen reader. It shows on both tabs, the
  field being one: over Nextcloud's Login Flow the user types the
  password on Nextcloud's own page at that address, and the app password
  it gives comes back the same way, both in clear. It warns, it does not refuse:
  a server on the user's own network, or behind a VPN such as a tailnet,
  may serve only http, and that is the user's choice. The words load with
  the dialog (`i18n/sign-in.ts`, a catalog of their own), so the first
  load grows by 35 bytes (on main `02a577c`), `inClear` alone.

- **D263. Subscriptions, as built.** `@astrotime/ics` (`IcsProvider`):
  one GET a sync, conditional (`If-None-Match`, `If-Modified-Since`)
  while the store holds what the validators validate; the calendar's
  `syncToken` is the validators with the hash of the text, so a server
  that gives none still reads as unchanged only when the file is
  ([D127](foundation.md#D127)). The file is split by
  `@astrotime/core/split` ([import D267](import.md#D267)'s splitter, one
  for both); a body that is no `VCALENDAR` throws `NotCalendarError`
  before anything is written, and `VJOURNAL`s are left out. The calendar's
  own address in the store is `ics:` and 28 hex digits of the address's
  fingerprint (two cyrb53 hashes, 106 bits: an id, not a guard, so no Web
  Crypto, which a page over plain http lacks), an object's `<that>#<UID>`,
  its ETag and the file's version fingerprints too; the account's `serverUrl` is the
  address's origin alone; the address itself is the secret
  (`{"subscription", "apply"}`). **The held removal** is a calendar's
  `HeldRemovalError`, reported by the engine as the problem
  `held-removal` with how many would go and the file's version
  (`SyncReport.errors[].held`); the account's problems say "The
  calendar's file would remove N items" with "Remove them", which writes
  that version into the secret as `apply` and syncs: that file, and only
  it, goes through, and once: the sync after it clears `apply`
  (`settle`, which reads the secret again and clears only the version
  that sync used, so a "Remove them" pressed meanwhile stays), so the same
  drop later asks again. What a removal weighs is counted among the
  items the calendar shows (the store's events and tasks), never the
  file's journals. **Reading at most hourly** (or the file's
  `REFRESH-INTERVAL`, if longer) is kept per store in memory
  (`@astrotime/sync/subscriptions`, `recent`), the last result said again
  meanwhile; only after a clean sync: one that failed, or said a problem
  (a held removal), is read again at the next chance; the user's "Sync
  now" reads at once. **The registry**
  ([D255](#D255)), half of it: `syncAll` opens a subscription with
  `@astrotime/sync/subscriptions`, imported when such an account syncs
  (`SyncContext.http` for it); a CalDAV account still with the
  platform's `connect`, CalDAV's code staying on the first load, as the
  sign-in and the files use it: P4's "imported only when a CalDAV account
  exists" moves to [Deferred](#deferred), with foundation's "the sync
  stack with its first use"; the
  sign-in dialog's third tab, "Subscribe", reads the file once before
  anything is kept, so a page or a refusal is said there. Its words, and
  the held removal's, load in a catalog of their own
  (`i18n/subscribe.ts`). **The web proxy logs no address**
  (`logProxyFailure`): a failure names the method and the server's
  origin, any address in the error's words read as a URL and cut to its
  scheme and host (a user name and password in it, `https://user:token@…`,
  never reach the log either)
  ([D39](foundation.md#D39)). The first load grows by 649 bytes (126 501 to 127 150 on
  main `0ae0dc1`), into the room [D255](#D255)'s note gave it (#136's 2.1
  KiB, and #144's 4.6).

## Deferred

- **Google wired in** ([D252](#D252)) — the provider is built; the sign-in
  (the `google` account, its tokens in the secret store, the home found
  on Google's CalDAV), `syncAll`'s entry for it and the dialog's button
  wait for the owner's OAuth clients ([D257](#D257)), Google's CalDAV
  recorded then too.

- **Microsoft wired in** ([D253](#D253)) — the provider is built; the
  sign-in (the `microsoft` account, its tokens in the secret store),
  `syncAll`'s entry and the dialog's button wait for the owner's client
  ([D258](#D258)). Then Graph is recorded, and from what it shows:
  `events/delta` and `tasks/delta` in place of the full listings, an
  exception's own change and a cancelled occurrence (`EXDATE`) read, and
  an occurrence's edit and deletion written to its own event. An event
  made here takes Graph's `iCalUId` (Graph sets it, read-only) once
  Graph's version comes down; keeping the UID made here (an extended
  property read back as `UID`) is decided then too.

- **More servers in the interop run** ([D261](#D261)): **Stalwart** 1.0
  starts in a bootstrap mode whose setup is its web wizard, writing a
  JSON configuration; an unattended one is to be written from its
  documentation. **Cyrus IMAP**, **SOGo** (with its database and
  users) and **Davis** (sabre/dav, as Baïkal) were not tried this round.
- **The scheme remembered with the account** ([D260](#D260)) — a Digest
  server's first request of each sync is a refused Basic one (or, over
  plain http elsewhere, one without credentials).
- **Revoking an app password over plain http** ([D260](#D260)) —
  `revokeAppPassword` (Nextcloud's OCS, not CalDAV) still sends Basic at
  once; Nextcloud takes Basic only, and an app password over plain http
  was already in clear when Login Flow gave it.

- **Import of an ICS file** — a file from the device (Tuta's export, an
  invitation) read into a calendar once ([D256](#D256)); a subscription
  is the kept, read-only kind.
- **Exchange on premises (EWS) and EteSync** ([D256](#D256)).
- **iCloud's Reminders** — upgraded lists are not on CalDAV; Apple gives
  no other API ([D245](#D245)).
- **CalDAV loaded with its first account** ([D255](#D255), [D263](#D263))
  — P4 made the subscriptions lazy; CalDAV's provider, discovery and XML
  parser are still on the first load, used by the sign-in and the files
  too. Moving them behind the registry is one change with foundation's
  "the sync stack with its first use".
- **A subscription's own colour and name, changed here** — the file's
  are shown; renaming or recolouring a subscription waits for the
  calendars' own settings to keep local names ([D263](#D263)).
- **A subscription that is not public** — an ICS address behind a
  password (some schools') works only when the password is in the URL;
  Basic on a subscription comes when someone asks.

## PR plan

Each PR is based on `main`, measures the first load before and after
([D255](#D255)), and lands its D-numbers' "built" note here.

### PR P1 — This plan

D245–D259 as decisions; `docs/README.md` lists the plan.

Done when: `scripts/docs.test.ts` passes (every route leads somewhere,
the plan is reached from `AGENTS.md`).

### PR P2 — The interop matrix

`interop.yml`, `packages/sync/test/interop/` (the compose file and each
server's start: its user, its calendar home), `servers.test.ts` run
against every server there; Dependabot's `docker-compose` entry; what
breaks on a server fixed in the provider, each fix a commit of its own
with its test, or recorded in Deferred. D248.

Done when: `servers.test.ts` passes against each listed server in its
own job of `interop.yml`, and a server made to fail (a wrong password in
a run by hand) fails its own job only; the workflow runs on a PR that
changes `packages/caldav/**` and not on one that changes only
`packages/ui/**`; Dependabot's config names the compose file; each
server that could not join is in Deferred with the reason; `docs/map.md`
names `packages/sync/test/interop/`.

_Built:_ [D260](#D260) (Digest, the first finding) and
[D261](#D261) (Baïkal with Digest and with Basic, Xandikos, DAViCal).

### PR P3 — Known services

The services' table, the sign-in dialog's list, the help texts in English
and Russian, each service's recording or interop proof. D247, D250.

Done when: choosing a service fills its address and shows its help, in
English and Russian, on a phone and a wide screen (screenshots); a unit
test replays each listed service's recording through discovery and a
first sync; a service without a recording is not listed; the first load
grows by at most 0.1 KiB.

### PR P4 — Subscriptions

`@astrotime/ics`, the provider registry ([D255](#D255)), the sign-in
dialog's "Subscribe to a calendar", the store's provider `ics`. D251,
D255.

Done when: tests show that a `304` changes nothing in the store; a `200`
adds a new UID's object, changes a changed one's and removes one whose
UID left the file; a series keeps its exceptions in one object; a `200`
that is an HTML page, empty, truncated or unparsable changes nothing and
reports a failure; a file that would remove every object, or more than
half of 20 or more, is held until the user applies it; hrefs are
`<address>#<UID>`; nothing is ever written to the server; a failed
request to a secret address logs nothing of its path; the URL's secret is in the secret store,
not the account's row; the CalDAV provider is imported only when a
CalDAV account exists (a test of the registry); the first load grows by
at most 0.1 KiB net; `docs/map.md` names `@astrotime/ics` and the
registry.

_Built:_ [D263](#D263); the room on the first load in #136 and #144.
Of the criteria above, two are met otherwise, as D263 says: hrefs are
`ics:<fingerprint>#<UID>`, not the address (which may hold a secret),
and the first load grew by 649 bytes, into the room #136 and #144 made
for it, not by 0.1 KiB net. One is not met and is
[Deferred](#deferred): the CalDAV provider is still on the first load
(the registry is built for subscriptions only).

### PR P5 — OAuth and Google

`@astrotime/oauth`, the bearer credentials of the CalDAV provider, the
redirect on each platform, the composite `google` provider (CalDAV
events, Tasks API task lists); against a fake OAuth server
and recordings until the owner's clients exist ([D257](#D257)). D252,
D254.

Done when: against a fake OAuth server, a sign-in on each platform's
redirect ends with a refresh token in the secret store, an expired access
token is refreshed once, and a refused refresh signs the account out;
Google's CalDAV recording (series and exceptions included) replays
through a sync, and a Tasks recording maps to `VTODO`s and back with a
`PATCH` of the changed fields only; one Google account in the store holds
both its calendars and its task lists, each call routed by URL; the owner's steps (D257) are sent to
the orchestrator, and once the owner has made them the cloud run passes
on the test account; `docs/map.md` names `@astrotime/oauth` and
the `google` provider.

### PR P6 — Microsoft

The `microsoft` provider, on P5's OAuth. D253, D258.

Done when: Graph recordings of events (a series master with a changed
and a cancelled occurrence, read through `events/delta` and `instances`) and of To Do tasks replay through a sync into iCalendar; an
edit sends a `PATCH` of the changed fields only, and a field the store
does not hold is never sent; the owner's steps (D258) are sent to the
orchestrator, and once made the cloud run passes on the test account;
`docs/map.md` names the provider.
