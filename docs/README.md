# The AstroTime context library

This is where everything AstroTime knows about itself lives, and the routes
to it. `AGENTS.md` is the trailhead: it sends every agent here. This page is
the map of maps; it does not repeat what the pages it points to say.

## Find your way

| You want to…                                       | Go to                                      |
| -------------------------------------------------- | ------------------------------------------ |
| know what already exists before building anything  | [`map.md`](map.md)                         |
| know what a word means                             | [`../GLOSSARY.md`](../GLOSSARY.md)         |
| know why something is the way it is                | the plan that owns it, see [Plans](#plans) |
| read how a set of decisions was reached            | [Grilling sessions](#grilling-sessions)    |
| learn the failure modes agents fall into, by story | [`lore/`](lore/README.md)                  |

If what you need is not on any map, say so in your PR and add the route
(see [Adding knowledge](#adding-knowledge)). Search is the fallback, not the
first move: you cannot search for something you do not know exists.

## Plans

A plan records decisions (numbered `D<n>`), what was left out on purpose,
what is deferred, and the PRs that land it. Plans are canon once implemented.

| Plan                                   | Owns                                                                   | Status      |
| -------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| [`foundation.md`](plans/foundation.md) | product scope, protocol, sync, platforms, stack, process, the MVP PRs  | in progress |
| [`design.md`](plans/design.md)         | how AstroTime looks and is laid out, from the owner's references       | in progress |
| [`android.md`](plans/android.md)       | the platform interfaces every shell implements; the Android app        | planned     |
| [`desktop.md`](plans/desktop.md)       | the Linux desktop app: its shell, platform adapters, build and release | planned     |

## Grilling sessions

A grilling session is the owner and an agent walking a design tree question
by question until nothing is assumed. The session is the record of _how_ the
decisions were reached; the decisions themselves live in the plan.

| Session                                                         | Fed                                          |
| --------------------------------------------------------------- | -------------------------------------------- |
| [`2026-10-31-foundation.md`](grilling/2026-10-31-foundation.md) | [`plans/foundation.md`](plans/foundation.md) |

## How knowledge is arranged

The library follows the world-building approach of Jhin's context library,
itself from OpenRig. An agent arrives knowing the world in general, not
AstroTime; the library is the diff.

- **Wide before deep.** [`map.md`](map.md) lists every package, app and
  module in one line each. Knowing that a thing exists costs a few tokens;
  not knowing it costs a parallel reimplementation
  ([reinvent the wheel](lore/reinvent-the-wheel.md)).
- **Routes, not piles.** Every page is reachable from the trailhead
  (`AGENTS.md` → here → the page). A fact nobody can reach does not help.
  `scripts/docs.test.ts` fails on pages no route reaches and on routes that
  lead nowhere.
- **One source of truth per fact.** Link to it instead of copying it. When it
  changes, it changes in one place and every link reads the new version.
- **Stories for lessons.** A rule covers one case; a story carries the lesson
  into cases nobody wrote down. Recurring lessons live in [`lore/`](lore/README.md)
  under a short name, so "moonbase" is enough to recall the whole story.

### Addresses

Knowledge has stable addresses:

- a file: `docs/plans/foundation.md`;
- a section: `docs/plans/foundation.md#deferred` (the heading's anchor) —
  read only that section, not the whole file;
- a decision: `plans/foundation.md#D7`, found by searching for `**D7.`;
- a story: `lore/doghouse-moonbase.md`, or its name, "moonbase".

Do not rename headings, files or decision numbers that others link to. Move
a section only with a link left at the old place.

### Maturity

Not everything written down deserves the same trust. From least to most:

| Level       | What it is                               | Where it lives                                          |
| ----------- | ---------------------------------------- | ------------------------------------------------------- |
| exhaust     | logs, scratch notes, session transcripts | never committed                                         |
| observation | something seen once, not yet understood  | a PR description or review comment                      |
| note        | an observation with a cause              | a plan's Deferred list, or a code comment               |
| insight     | a lesson that applies beyond one change  | `lore/`, `grilling/`                                    |
| canon       | what the project relies on               | `AGENTS.md`, `GLOSSARY.md`, implemented plans, `map.md` |

Canon is about how established something is, not how old. When canon and a
note disagree, canon wins until someone changes canon on purpose, in a PR
that says so. When canon and the code disagree, the code is the territory:
fix whichever is wrong and say which.

## Adding knowledge

- A new package, app or module → a line in [`map.md`](map.md).
- A new word → [`GLOSSARY.md`](../GLOSSARY.md).
- A decision → the plan that owns the area, with the next free `D<n>`.
- Something left out → that plan's Deferred section (AGENTS.md rule 3).
- A grilling session → a dated file in `grilling/` and a row in
  [Grilling sessions](#grilling-sessions); its decisions go into the plan.
- A failure that keeps coming back in new shapes → a story in
  [`lore/`](lore/README.md), not one more rule.
- A new kind of page → a row in [Find your way](#find-your-way), so it has a
  route.
