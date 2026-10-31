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
  → `plans/foundation.md#D22`

## Packages

None yet. `core`, `caldav`, `storage` and `ui` are created by the PRs that
first need them (`plans/foundation.md#D23`, `plans/foundation.md#pr-plan`).

## Apps

- `apps/web` (`@astrotime/web`) — the web app, the first platform; a
  placeholder screen for now. → `plans/foundation.md#D12`

## Tooling

- `vite.config.ts` — Vite+ config: tests, format, lint (with the isomorphic
  rule for the core). → `plans/foundation.md#D21`
- `scripts/docs.test.ts` — checks the context library's routes.
  → `README.md#how-knowledge-is-arranged`
- `.github/workflows/` — CI, Claude review, `@claude`.
  → `plans/foundation.md#D27`
