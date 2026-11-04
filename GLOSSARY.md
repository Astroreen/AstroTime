# Glossary

One word per concept. Use these terms in code, docs, commits and UI.

## The product

- **Account** — one sign-in to one service through one provider (a
  Nextcloud user, a Google account), whatever APIs the provider uses
  there. Holds its credentials and its calendars. Named `user@host` in the
  UI.
- **Calendar home** — the collection that holds an account's calendars on
  a CalDAV server, found by discovery (RFC 6764) and kept with the account
  (`homeUrl`).
- **Provider** — the code that brings an account's calendars in and writes
  changes back, one per kind of account (`Account.provider`): `caldav` (any
  CalDAV server and the known services), and planned `ics` (subscriptions),
  `google` (Google's CalDAV and Tasks API in one) and `microsoft` (Graph)
  (providers D245–D253). System calendars are deferred (foundation D4).
- **Calendar** — one collection on a server (a CalDAV calendar). It may hold
  events, tasks or both (`supported-calendar-component-set`).
- **Rights** — what the user may do to a calendar's items: create, edit,
  delete (`CalendarRights`, foundation D37). A **read-only** calendar
  grants none.
- **Event** — a `VEVENT`: something that happens at a time.
- **Task** — a `VTODO`: something to do at its **start** (a day, or a day
  and a time), possibly with a due (design D159). Never "todo" or
  "reminder" in code or UI.
- **Item** — an event or a task, when it does not matter which.
- **Calendar object** — one resource on a CalDAV server: a `VCALENDAR` with
  the components of one UID (a master and its exceptions) and their time
  zones. `CalendarObject` in code.
- **Master** — the component of a calendar object without `RECURRENCE-ID`;
  the series itself, or the only item when it does not recur.
- **Series** — an item with a recurrence rule (`RRULE`, `RDATE`).
- **Occurrence** — one instance of a series at one time; an occurrence that
  was changed on its own is an **exception** (`RECURRENCE-ID`).
- **Scope** — which occurrences of a series an edit or a deletion of one
  covers: this occurrence, this and following (the series is **split**: it
  ends before the occurrence and a new series starts there), or all
  occurrences (foundation D11, D105). `Scope` in code.
- **Floating time** — a wall-clock time with no zone, shown at the same
  hour everywhere. A **zoned time** names its IANA zone and an instant.
- **Subtask** — a task whose `RELATED-TO` names a parent task.
- **Reminder** — a `VALARM` of an event or a task: the notification it asks
  for before it starts or is due (foundation D9). A task itself is never a
  reminder. In code a `Reminder` is one time an alarm fires (each
  occurrence and each repeat its own); the reminders a platform is handed,
  7 days ahead and at most 100, are the **reminder set** (foundation D100).
  The **reminder tally** counts, on this device, the reminders the user
  added, which the edit dialog offers first (`AlarmTally`, design D206).
- **Mention** — a person named in a description with "@", written as a
  Markdown link to their e-mail (`[@Anna Berg](mailto:anna@example.com)`)
  and drawn as a chip; it invites no one (design D208).
- **Place** — an item's `LOCATION` picked on the map: its text ("name,
  address") with its **point** (`GEO`, and Apple's structured location).
  Text typed and not picked is a location with no point (foundation D176).
  `Place` in code; `Item.geo` is the point.
- **Attachment** — an item's `ATTACH`: a link to a file (on the account's
  server, as Nextcloud writes its users' files, or anywhere on the web) or
  a file inline in the object, with its name, kind and size where its
  client wrote them (foundation D229, design D230). Never "file" alone: a
  file is what an attachment points to or holds.
- **Due** — a task's `DUE`, the time it must be done by; optional. A task
  is **overdue** when its due has passed (its start, without a due) and it
  is not completed (design D161).

## The screen

- **Time grid** — the column of hours of a day, where timed items sit.
- **All-day strip** — the band pinned above the time grid with all-day
  items; it does not scroll away.
- **Chip** — a small item, of two kinds: in the all-day strip, any item one
  line high (a **span** in the week's strip, D42), and in the Month view
  every item; in the time grid, a task at its start's time (its due's
  without a start), 30 minutes tall whatever its due (`shape: "chip"` in
  `layoutDay`, design D159).
- **Block** — a timed item with a length, drawn from its start to its end
  in the time grid. `shape: "block"` in the layout.
- **Span** — a chip drawn as one bar over every day the item covers, in
  the all-day strip of a week and in each week of the Month view (where
  timed items are spans too); a one-day item is a span of one day.
- **Draft** — the item the edit dialog makes or edits, drawn in the views
  behind it as its form says now (design D155).
- **Ghost** — what a drag draws where the item would go, with its new
  time, while the item stays dimmed where it was until the drop is saved
  (design D111).
- **Cluster** — timed items that overlap, directly or through others; they
  share the column's width (D15).
- **Title room** — the minutes at the top of a timed item two lines of its
  title need (45); no item is drawn over them (design D153).
- **Tasks screen** — the task lists, as in Google Tasks: a screen over the
  calendar on a phone, in the view's place on a wide screen, from the top
  bar's calendar | tasks switch (design D52, D227).
- **Task list** — a calendar that holds tasks (its components include
  `VTODO`), a tab of the tasks screen. Never "todo list".
- **Star** — a task marked as important on the tasks screen,
  `X-ASTROTIME-STARRED:TRUE` (design D52); it is not `PRIORITY`.
- **Settings** — the screen (a dialog on a wide screen) of this device's
  choices, in groups: theme and language; week start, clock and "hide
  completed"; each account's calendars shown or hidden; reminders; on the
  desktop "keep running". Reached by the top bar's gear on a wide screen and
  by the drawer's last row on a phone (design D131, D96).
- **Top bar**, **drawer**, **floating button** — the app shell: the bar
  with the period, search, "today", the tasks toggle and the account (on a
  wide screen in Google's web order with Settings, design D133); the side
  menu with the views and calendars (a sidebar on a wide screen, headed by
  **Create**); the "+" button that creates an item where no sidebar holds
  Create (design D46, D132).
- **View** — Day, 3 days, Week, Month or Agenda.
- **Period** — the days a view shows: one, three, the locale's week, or a
  month's six weeks; previous and next move by one period (by month in the
  Month view and the Agenda).
- **Undone tasks chip** — the one chip on today that stands for every
  overdue task, "N undone tasks" (design D51, D161).
- **Dropdown** — a button that opens a list under it to choose from:
  AstroTime's own (`Select`, `MenuButton`), never the browser's `<select>`
  (design D167).
- **Own colour** — a colour the user made in Settings, named from its
  colour until they name it (design D170, D173).
- **Details** — the dialog a tap on an item opens: when it is, how it
  repeats, where, its reminders and guests, with edit and delete (design
  D108).
- **Edit dialog** — where an item is created or changed (design D108).
- **Agenda** — the view that lists items in time order, day by day,
  instead of a grid ("Расписание" in Russian, as Google's).
- **Picture** — any image AstroTime draws behind an item or a month: an
  illustration or a month banner (design D215–D219). Not the **theme**,
  which is light, dark or the system's.
- **Subject** — what an item's title says it is about, by its words
  (lunch, a birthday, a flight): `subjectOf`, one of twelve, each drawn as
  an **illustration** (design D215). Never "theme" for this.
- **Illustration** — a subject's picture, drawn by AstroTime: the Agenda's
  card is drawn over it, the details under it (design D216).
- **Month banner** — the wide picture of a month's season over its first
  day in the Agenda (design D218).
- **Account button** — the avatar at the end of the top bar; it opens the
  **accounts dialog**: each account with its sync status and menu, "Sync
  now", "Add account" (foundation D92).
- **Calendar on this device** — the calendar a store with no account gets,
  of provider `local`: events and tasks with no server, never synced
  (foundation D122). It replaced the **first-run screen**, which asked for
  an account before showing the calendar.
- **Import** — events and tasks read from a file into a calendar, from
  Settings; each calendar or task list the file holds is a **source**,
  put where the user picks (import D265, D269). **Export** is the way back:
  a calendar as one `.ics` (import D274).
- **Preset** — the CalDAV server and user name a single-user deployment
  names for whoever opens it, so signing in asks for the password alone
  (foundation D123).
- **Known service** — a cloud CalDAV service the sign-in dialog offers by
  name (iCloud, Fastmail, Yandex…): its address filled in, the user gives
  their name and an app password. Its account is a CalDAV account, not a
  provider of its own (providers D247, D250).
- **Subscription** — a read-only calendar from an ICS address
  (`webcal://`, `https://…ics`), kept fresh by a conditional `GET`
  (providers D251).

## Sync

- **Local store** — the SQLite database on the device; the UI's source of
  truth.
- **Sync engine** — `syncAccount` in `@astrotime/sync`, which reconciles
  the local store with a provider (D37).
- **`syncAll`** — the one sync entry every shell calls: every account in
  turn, joining a sync already running (D90), after another tab's has ended
  (the **sync lock**, D91). The UI calls it on its
  **sync triggers** (start, back in front, a timer, the network back, a
  local change: D91).
- **Sync off** — an account the user stopped syncing in Settings: no
  request goes to its server, its calendars stay, its changes wait
  (D171).
- **Sync status** — how an account's last sync went, as the UI shows it:
  syncing, synced at a time, offline, signed out, refused, failed, with
  the items it could not handle.
- **Signed out** — an account whose server refused its credentials (or
  that has none saved); it syncs again once the user signs in again.
- **Leader tab** — the tab whose worker has the web store's database open
  and runs the statements of every tab; the others follow it. When it goes,
  the next tab leads: a **hand-over** (foundation D98).
- **In doubt** — a COMMIT whose answer went with the leader tab: the
  transaction may or may not have committed (`CommitInDoubtError`,
  foundation D99).
- **Live query** — a query of the local store that runs again whenever the
  store changes, so a view shows what a sync wrote (`liveQuery`, D54).
- **Sync token** — the server's marker of the last state we saw
  (RFC 6578); the next sync asks only for what changed since.
- **ETag** — the server's version of one item; writes send it so a newer
  version is never overwritten blindly.
- **Base** — the server's version of an object that a local change started
  from; the third side of the merge when the server refuses the change.
- **Pending change** — a local create, update or delete the server has not
  accepted yet.
- **Conflict** — a change of ours the server refused because the item
  changed there first, on the same field. Kept in the **Conflicts list**,
  which shows it beside the server's version: keep the server's, or apply
  mine again (foundation D107).
- **Proxy** — the stateless web proxy that lets the web app reach CalDAV
  servers despite CORS: in the dev server now, in the web app's Docker image
  later (`proxyHandler`).
- **Interop run** — the CalDAV tests against every self-hostable server
  in a container, run when the code that talks to servers or a server's
  pinned version changes, weekly and by hand (providers D248); the
  **cloud run** is the same against cloud services' test accounts.
- **Recording** — a service's requests and answers, captured once from a
  test account with every personal value replaced, that unit tests replay
  (providers D249).
- **AstroTime server** — the web image in **server mode**: it serves
  CalDAV itself under `/dav/` from its own database (`@astrotime/server`),
  so AstroTime needs no other server (server D279–D282).
- **Mesh** — AstroTime **peers** (devices and server images) that sync with
  each other with no server; on each peer an account of provider `mesh`
  (server D283). A peer passing on what another sent is a **relay**.
- **Version** — one change to a mesh item or calendar, with its HLC
  timestamp and its peer's sequence number; the newest wins. A peer's
  **version vector** says which versions it has (server D284).
- **Invite** — the text (and QR code) that joins a device to a mesh: its
  id, its secret and the addresses that listen (server D287).

## Platforms

- **Shell** — an app that wraps the shared UI for one platform and hands it
  that platform's adapters: `apps/web`, `apps/mobile` (Capacitor),
  `apps/desktop` (Electron). Shells hold no product logic (foundation D22).
- **Platform interfaces** — what the shared code needs from a platform and
  cannot do itself: HTTP, SQLite, secrets, reminders, sync triggers; named
  once in android plan D60. A shell's implementation of one is an
  **adapter**; all of them together are the shell's **Platform** (the
  `Platform` object it hands the UI's root).
- **Service worker** — the web app's script that keeps the built app's
  files, so it starts with no network, and offers a newer version once one
  is installed (foundation D124).
- **Secret store** — where a platform keeps an account's credentials
  (`SecretStore`): IndexedDB on the web (foundation D89), the Keystore on
  Android, the keyring on the desktop. Never the local store.
- **Unprotected** — a password saved where no keyring protects it: on the
  desktop without one, only when the user chooses so over keeping it until
  the app quits (desktop plan D74).
- **Store's process** — the desktop's Electron utility process that owns
  the local store's database file and runs the page's statements on a
  port (desktop plan D73).
- **Background sync** — a sync the operating system starts while the app is
  not on the screen: on Android a WorkManager job that runs a page of the
  app in a **headless WebView** (one with no activity or window) on the
  app's origin (android plan D67).
- **Keep running** — the desktop app living on with its window closed: the
  window hides, the tray stays, syncs and reminders go on; off, closing the
  window quits (desktop plan D75).

## Development

- **Demo data** — invented calendars, events and tasks around today, in
  English or Russian (`@astrotime/ui/demo`); `?demo` loads them in the dev
  server (D57).
- **Tailnet** — the owner's private Tailscale network (100.64.0.0/10,
  fd7a:115c:a1e0::/48); with Tailscale up, tailnet devices reach the dev
  server over https, and only this machine and they get in
  (`scripts/t3/README.md`).

## The docs

- **Context library** — everything AstroTime knows about itself in `docs/`,
  plus `AGENTS.md` and this file, with routes between them.
- **Trailhead** — where an agent starts: `AGENTS.md`.
- **Map** — `docs/map.md`: everything that exists, one line each.
- **Route** — a link that makes a piece of knowledge reachable from the
  trailhead. Knowledge without a route does not exist for an agent.
- **Canon** — knowledge the project relies on: `AGENTS.md`, this file,
  implemented plans, the map.
- **Grilling session** — the owner and an agent walking a design tree
  question by question; recorded in `docs/grilling/`.
