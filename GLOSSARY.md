# Glossary

One word per concept. Use these terms in code, docs, commits and UI.

## The product

- **Account** — one sign-in to one server through one provider (a Nextcloud
  user, for example). Holds its credentials and its calendars. Named
  `user@host` in the UI.
- **Calendar home** — the collection that holds an account's calendars on
  a CalDAV server, found by discovery (RFC 6764) and kept with the account
  (`homeUrl`).
- **Provider** — the code that brings an account's calendars in and writes
  changes back. CalDAV is the first; Google and system calendars come later.
- **Calendar** — one collection on a server (a CalDAV calendar). It may hold
  events, tasks or both (`supported-calendar-component-set`).
- **Event** — a `VEVENT`: something that happens at a time.
- **Task** — a `VTODO`: something to do, possibly with a due time. Never
  "todo" or "reminder" in code or UI.
- **Item** — an event or a task, when it does not matter which.
- **Calendar object** — one resource on a CalDAV server: a `VCALENDAR` with
  the components of one UID (a master and its exceptions) and their time
  zones. `CalendarObject` in code.
- **Master** — the component of a calendar object without `RECURRENCE-ID`;
  the series itself, or the only item when it does not recur.
- **Series** — an item with a recurrence rule (`RRULE`, `RDATE`).
- **Occurrence** — one instance of a series at one time; an occurrence that
  was changed on its own is an **exception** (`RECURRENCE-ID`).
- **Floating time** — a wall-clock time with no zone, shown at the same
  hour everywhere. A **zoned time** names its IANA zone and an instant.
- **Subtask** — a task whose `RELATED-TO` names a parent task.
- **Reminder** — a `VALARM` of an event or a task: the notification it asks
  for before it starts or is due (foundation D9). A task itself is never a
  reminder. In code a `Reminder` is one time an alarm fires (each
  occurrence and each repeat its own); the reminders a platform is handed,
  7 days ahead and at most 100, are the **reminder set** (foundation D100).
- **Due** — a task's `DUE`. A task is **overdue** when its due has passed
  and it is not completed.

## The screen

- **Time grid** — the column of hours of a day, where timed items sit.
- **All-day strip** — the band pinned above the time grid with all-day
  items; it does not scroll away.
- **Chip** — a small item, of two kinds: in the all-day strip, any item one
  line high (a **span** in the week's strip, D42), and in the Month view
  every item; in the time grid, a task with only a due (or start) time,
  30 minutes tall (`shape: "chip"` in `layoutDay`).
- **Block** — a timed item with a length, drawn from its start to its end
  in the time grid. `shape: "block"` in the layout.
- **Span** — a chip drawn as one bar over every day the item covers, in
  the all-day strip of a week and in each week of the Month view (where
  timed items are spans too); a one-day item is a span of one day.
- **Cluster** — timed items that overlap, directly or through others; they
  share the column's width (D15).
- **Tasks screen** — the task lists, as in Google Tasks: a screen on a
  phone, a panel beside the calendar on a wide screen (design D52).
- **Task list** — a calendar that holds tasks (its components include
  `VTODO`), a tab of the tasks screen. Never "todo list".
- **Star** — a task marked as important on the tasks screen,
  `X-ASTROTIME-STARRED:TRUE` (design D52); it is not `PRIORITY`.
- **Settings** — the drawer's choices for this device: theme, language,
  week start, clock, "hide completed" (design D96).
- **Top bar**, **drawer**, **floating button** — the app shell: the bar
  with the month, search, "today" and the tasks toggle; the side menu with
  views, calendars and settings (a sidebar on a wide screen); the "+" button
  that creates an item (design D46).
- **View** — Day, 3 days, Week, Month or Agenda.
- **Period** — the days a view shows: one, three, the locale's week, or a
  month's six weeks; previous and next move by one period (by month in the
  Month view and the Agenda).
- **Undone tasks chip** — the one chip on today that stands for every
  undone task due before today, "N undone tasks" (design D51).
- **Agenda** — the view that lists items in time order, day by day,
  instead of a grid ("Расписание" in Russian, as Google's).
- **Account button** — the avatar at the end of the top bar; it opens the
  **accounts dialog**: each account with its sync status and menu, "Sync
  now", "Add account" (foundation D92).
- **First-run screen** — what an app with no account (and no demo data)
  shows instead of the calendar: the ways to add one.

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
  changed there first, on the same field. Kept in the **Conflicts** list.
- **Proxy** — the stateless web proxy that lets the web app reach CalDAV
  servers despite CORS: in the dev server now, in the web app's Docker image
  later (`proxyHandler`).

## Platforms

- **Shell** — an app that wraps the shared UI for one platform and hands it
  that platform's adapters: `apps/web`, `apps/mobile` (Capacitor),
  `apps/desktop` (Electron). Shells hold no product logic (foundation D22).
- **Platform interfaces** — what the shared code needs from a platform and
  cannot do itself: HTTP, SQLite, secrets, reminders, sync triggers; named
  once in android plan D60. A shell's implementation of one is an
  **adapter**; all of them together are the shell's **Platform** (the
  `Platform` object it hands the UI's root).
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
  not open (Android's WorkManager, android plan D67).

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
