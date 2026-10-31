# AstroTime — AGENTS.md

## What AstroTime is

AstroTime is one open-source client for calendars and tasks together: events
and tasks from your own CalDAV server (Nextcloud first) on one time grid, on
the web, Android and Linux. It has no backend of its own. Google Calendar,
Google Tasks and Nextcloud's clients are the references for behaviour.

## Find your way

This file is the trailhead. It does not hold the answers; it points to them.

1. `docs/map.md` — everything AstroTime already has, one line each. Read it
   before building anything, so you extend what exists instead of building
   it twice.
2. `docs/README.md` — the context library: which page knows what, how
   knowledge is addressed, and how much to trust it.
3. `GLOSSARY.md` — the vocabulary. Use exactly these words.
4. The plan that owns your area (`docs/plans/`, listed in `docs/README.md`),
   and its PR plan to check whether a PR already builds it.
5. `docs/lore/` — short stories of how agents go wrong. Read them on arrival
   and again after a compaction. In review a name is enough: "moonbase".

Read only the section you need (`docs/plans/foundation.md#deferred`), not
whole files. If something you need is not reachable from here, add the route
in your PR.

## Architecture rules

1. **The core is isomorphic.** `@astrotime/core` and `@astrotime/caldav` run
   unchanged in the browser, Capacitor and Electron: no Node or DOM imports,
   no `window`, `localStorage` or `process`. Platform APIs (HTTP, storage,
   secrets, notifications) are injected. oxlint and `types: []` enforce it.
2. **Never lose a property.** Everything read from a server is written back
   unchanged unless the user changed it, including properties AstroTime does
   not understand (`X-*`, other clients' extensions). See
   `docs/plans/foundation.md#D7`.
3. **The local store is the UI's source of truth.** The UI reads and writes
   the store; only the sync engine talks to servers (`docs/plans/foundation.md#D5`).
4. **Providers behind one interface.** CalDAV is the first provider; nothing
   outside `@astrotime/caldav` knows about WebDAV.
5. **No strings in code.** Every UI string goes through i18n, English and
   Russian from the first screen.

## Verifying your work

Work is done only when it is proven. Prefer the smallest proof:

- run only the affected tests, files and packages locally:
  `vp test run <files>`, `vp check <files>`,
  `vp run --filter <package> typecheck`;
- leave the full run to CI unless you changed shared config.

The dev shell (`devenv`, entered by direnv) provides Node 24, pnpm and
Playwright's Chromium from nixpkgs; without nix,
`pnpm exec playwright install chromium` is enough.

Tests:

- **No `sleep`, polling or timeouts in tests.** Wait for a concrete event or
  a persisted record. A test that needs a timeout to pass is wrong. (A
  raised ceiling for a suite against a slow real server, such as Nextcloud,
  is not a wait: nothing in the test depends on time passing.)
- Protocol code is tested against recorded fixtures from real servers and
  clients, and against a real CalDAV server in CI.
- UI: Playwright with role and accessibility-tree locators.

Pull requests:

- One branch per PR, never push to `main` directly.
- The PR description lists the decisions (D-numbers) it implements and
  concrete evidence: commands run with their output, screenshots for UI.
  "Tests pass" alone is not evidence.

## Rules

1. Everything in English: code, comments, docs, commit messages.
2. Conventional Commits.
3. Anything deferred goes into the "Deferred" section of the relevant plan,
   never silently dropped.
4. Knowledge has one source of truth: link to it, never copy it. A new
   package, app or module gets its line in `docs/map.md`, a new word goes in
   `GLOSSARY.md`, and a decision goes in the plan that owns the area
   (`docs/README.md#adding-knowledge`). Files, headings and decision numbers
   others link to are addresses: do not rename them.
5. The owner's word wins. When the owner asks for something a decision
   forbids, say which decision once, then do what the owner said and update
   the decision in the same change.
