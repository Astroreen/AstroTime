# Providers plan

Status: **in progress** — the survey, the order and the testing policy are
decided; nothing of them is built yet. This plan owns which calendar and
task services AstroTime syncs with beyond Nextcloud, how each is reached,
and how each is tested against the real thing. Foundation owns the
provider interface and the sync engine: [D2](foundation.md#D2) (generic
CalDAV), [D4](foundation.md#D4) (providers behind one interface),
[D5](foundation.md#D5) (offline-first), [D7](foundation.md#D7) (nothing
lost), [D19](foundation.md#D19) (signing in), [D20](foundation.md#D20) and
[D39](foundation.md#D39) (the web proxy), [D126](foundation.md#D126) (what
a sync costs a server) and [D145](foundation.md#D145) (the first load's
budget); this plan builds on them and does not repeat them. Decisions are
D245–D264.

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
     recordings and a fake server; finished when he has made them.
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
     accounts the owner makes, their credentials only in GitHub secrets he
     creates ([D249](#D249)). By hand, and monthly; a provider's PR that
     changes its cloud code may run it by hand. A service without its
     secrets is skipped, said so in the job's summary, not failed. Never
     on a PR from a fork (secrets do not reach one anyway).

  **Why not every time.** Seven containers, each a few minutes to start
  (SOGo and Cyrus the slowest), would more than double CI's time on PRs
  that touch only the UI, which is most of them; and a server's behaviour
  changes when its release or AstroTime's protocol code changes, which
  the filters and the weekly run catch. Cloud services also cost the
  services something and can lock an account that signs in too often
  (Cloudflare limited the owner's own host once), so they are recorded
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
  one read-only calendar ([NO_RIGHTS](foundation.md#D37)), its name from
  the file's `X-WR-CALNAME` (or the address's host), its colour from
  `X-APPLE-CALENDAR-COLOR` or `COLOR` (RFC 7986) if the file has one.
  `webcal://` is read as `https://`. A sync is one conditional `GET`
  (`If-None-Match` with the last `ETag`, `If-Modified-Since` with the
  last `Last-Modified`): a `304` changes nothing; a `200` is split into
  one calendar object per `UID` (a series with its exceptions together,
  with the file's `VTIMEZONE`s each needs), each kept as its own object
  in the store with an href made from its UID, and objects whose UID is
  gone are removed. It syncs with the others, at most hourly unless the
  user asks ("Sync now"), or as the file's `REFRESH-INTERVAL` (RFC 7986)
  or `X-PUBLISHED-TTL` asks, if longer. Nothing is ever written back. A
  secret in the URL (Google's "secret address", Outlook's published
  calendar) is a credential: it is kept in the secret store, not the
  account's row, and shown in the UI with its path cut. On the web it
  goes through the proxy like any server, so it must be on its allowlist;
  Android and the desktop reach it directly.

### OAuth providers

- **D252. Google: events over Google's CalDAV, tasks over the Tasks API.**
  Google Calendar's CalDAV endpoint takes an OAuth 2 bearer token, not a
  password, and speaks the CalDAV the provider already speaks, so events
  stay iCalendar end to end ([D7](foundation.md#D7)) and reuse every test
  of it. Google Tasks has no CalDAV: a provider `google-tasks` maps the
  Tasks API (`tasklists`, `tasks`: title, notes, due as a date, status,
  completed, parent, position, links) to `VTODO`s in the store and back,
  each task list a calendar of `VTODO`s. A write sends only what the user
  changed (`PATCH` of the fields an edit touched), so whatever Google
  keeps that iCalendar cannot say (a task's `position`, `links`, assigned
  Docs) is never overwritten: D7's promise kept on the server's side.
  What a `VTODO` says that Google Tasks cannot keep (a time on the due,
  a start, priority, categories, reminders, recurrence) is not offered by
  the edit dialog for such a list, as a read-only field is not
  ([design D159](design.md#D159) shows what a task has). One sign-in adds
  both: one Google account, with its calendars and its task lists.
  Changes are found with CalDAV's `sync-collection` for events and the
  Tasks API's `updatedMin` with `showDeleted` for tasks. Google's APIs
  answer CORS, its CalDAV does not: on the web events go through the
  proxy, which must allow `https://apidata.googleusercontent.com`.

- **D253. Microsoft: Graph, events and To Do.** Outlook's calendars and
  Microsoft To Do have no CalDAV; Microsoft Graph carries both
  (`/me/calendars/{id}/events`, `/me/todo/lists/{id}/tasks`) and answers
  CORS. A provider `microsoft` maps Graph's events and tasks to
  iCalendar in the store and back, with Graph's `delta` queries
  (`calendarView/delta`, `tasks/delta`) for changes, and writes only
  what changed (`PATCH`), as [D252](#D252) does for Google Tasks. Each
  item keeps the JSON Graph served in the store beside its iCalendar, so
  what iCalendar cannot say is still there to compare and never sent back
  changed. A series is read with its exceptions (`instances`), and an
  edit of one occurrence writes that occurrence's own event, as Outlook
  does. It comes after Google ([D246](#D246)).

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
    the app's id, as Google asks of Android clients), through a Custom
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

### Weight and privacy

- **D255. A provider loads only with an account of its kind.** The sync
  engine opens an account's provider through a registry keyed by
  `Account.provider`, each entry a dynamic `import()` of the provider's
  package (`connectCalDav` stays the CalDAV entry). The first load holds
  the registry and no provider; CalDAV, already on it, moves to a lazy
  chunk when a PR needs its room ([D145](foundation.md#D145)'s Deferred,
  "the sync stack and signing in with their first use"). The sign-in
  dialog's new choices (the known services' table, the subscription form,
  the OAuth buttons) load with the sign-in dialog, never before. Each PR
  measures the first load before and after; none may add more than 0.1
  KiB to it.

- **D256. What is not built, and why.**
  - **Proton Calendar** has no API and no CalDAV, and Proton's Bridge
    carries mail only. A Proton calendar shared "with anyone by link"
    can be subscribed to ([D251](#D251)), read-only; nothing more is
    possible without Proton's own client.
  - **Tuta** keeps calendars end-to-end encrypted with no API; it exports
    ICS files only, which an import could read (Deferred).
  - **Exchange on premises** speaks EWS (and Microsoft retires EWS for
    Exchange Online in 2026); an on-premises Exchange is Deferred until
    someone asks.
  - **EteSync** speaks its own end-to-end protocol (Etebase); Deferred.
  - **Android's system calendars** stay foundation's
    [Deferred](foundation.md#deferred) item.

- **D257. What the owner makes for Google, step by step** (when the
  OAuth PR is ready for it; nothing is needed before):
  1. At console.cloud.google.com, a project "AstroTime"; enable "Google
     Calendar API" and "Google Tasks API" (CalDAV's endpoint is part of
     the Calendar API: "CalDAV API" enabled too).
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
     for his own web deployment a **Web application** client with his
     deployment's origin and `http://localhost:5180` as authorized
     JavaScript origins and `<origin>/oauth` as redirect URIs.
  4. A Google account for the tests only (not his own), a test user of
     the consent screen, with a refresh token for the cloud run made by
     `scripts/record-google.ts`; the client ids as repository variables
     (`ASTROTIME_GOOGLE_*_CLIENT_ID`), the desktop and web secrets and the
     test account's refresh token as repository secrets.

- **D258. What the owner makes for Microsoft, step by step** (when the
  Microsoft PR is ready for it):
  1. At entra.microsoft.com (free with a personal Microsoft account), an
     app registration "AstroTime", "Accounts in any organizational
     directory and personal Microsoft accounts".
  2. Platforms: **Single-page application** with his deployment's
     `<origin>/oauth` and `http://localhost:5180/oauth`; **Mobile and
     desktop applications** with `io.github.astroreen.astrotime://oauth`
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

## Deferred

- **Import of an ICS file** — a file from the device (Tuta's export, an
  invitation) read into a calendar once ([D256](#D256)); a subscription
  is the kept, read-only kind.
- **Exchange on premises (EWS) and EteSync** ([D256](#D256)).
- **iCloud's Reminders** — upgraded lists are not on CalDAV; Apple gives
  no other API ([D245](#D245)).
- **A subscription that is not public** — an ICS address behind a
  password (some schools') works only when the password is in the URL;
  Basic on a subscription comes when someone asks.

## PR plan

Each PR is based on `main`, measures the first load before and after
([D255](#D255)), and lands its D-numbers' "built" note here.

### PR P1 — This plan

D245–D259 as decisions; `docs/README.md` lists the plan.

### PR P2 — The interop matrix

`interop.yml`, `packages/sync/test/interop/` (the compose file and each
server's start: its user, its calendar home), `servers.test.ts` run
against every server there; Dependabot's `docker-compose` entry; what
breaks on a server fixed in the provider, each fix a commit of its own
with its test, or recorded in Deferred. D248.

### PR P3 — Known services

The services' table, the sign-in dialog's list, the help texts in English
and Russian, each service's recording or interop proof. D247, D250.

### PR P4 — Subscriptions

`@astrotime/ics`, the provider registry ([D255](#D255)), the sign-in
dialog's "Subscribe to a calendar", the store's provider `ics`. D251,
D255.

### PR P5 — OAuth and Google

`@astrotime/oauth`, the bearer credentials of the CalDAV provider, the
redirect on each platform, `google-tasks`; against a fake OAuth server
and recordings until the owner's clients exist ([D257](#D257)). D252,
D254.

### PR P6 — Microsoft

The `microsoft` provider, on P5's OAuth. D253, D258.
