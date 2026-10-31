# Glossary

One word per concept. Use these terms in code, docs, commits and UI.

## The product

- **Account** — one sign-in to one server through one provider (a Nextcloud
  user, for example). Holds its credentials and its calendars.
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
- **Due** — a task's `DUE`. A task is **overdue** when its due has passed
  and it is not completed.

## The screen

- **Time grid** — the column of hours of a day, where timed items sit.
- **All-day strip** — the band pinned above the time grid with all-day
  items; it does not scroll away.
- **Task chip** — a task with only a due time (or only a start time), drawn
  small at that time. `shape: "chip"` in the layout.
- **Block** — a timed item with a length, drawn from its start to its end
  in the time grid. `shape: "block"` in the layout.
- **Span** — an all-day item drawn as one bar over the days it covers in
  the all-day strip of a week or a month.
- **Cluster** — timed items that overlap, directly or through others; they
  share the column's width (D15).
- **Task panel** — the side panel with the tasks that have no date.
- **View** — Day, Week, Month or Agenda.
- **Agenda** — the view that lists items in time order instead of a grid.

## Sync

- **Local store** — the SQLite database on the device; the UI's source of
  truth.
- **Sync engine** — `syncAccount` in `@astrotime/sync`, which reconciles
  the local store with a provider (D37).
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
