<!-- For the owner, who reads this page before the code. Short: at most 300 words outside
<details>, code and links (the "PR description" check counts them). Plain words; name a
decision in brackets (D297), a rule in words ("a property is never lost"). Say each fact once:
no repeating the problem in "What changed" or the change in "How to check". -->

<!-- First lines, no heading: the problem in one or two sentences — who meets it, what goes
wrong — and what is different now. Then the plan's PR it builds and its decisions, e.g.
"Builds PR L2 of docs/plans/design.md (D296, D297)". -->

## What changed

<!-- One line per change a user will notice, the change in bold, at most one more sentence.
Visible change: its before/after pair right under its line, light and dark, English and Russian
where they differ (scripts/pr-images.sh <pr> <files…> uploads them and prints the Markdown; a
path on your disk shows nothing). Nothing visible: say before → now in the line itself.
Anything deferred: one line, and the plan's Deferred section that now holds it. -->

1. **…**

   | Before | After |
   | ------ | ----- |
   |        |       |

## Risk

<!-- One or two lines: Low / Medium / High — what could break, for whom. Undo: revert the PR,
and what a revert does NOT undo (data written to a user's server, a migrated local store, a
published release). High is always: writing to servers, the local store's schema, secrets, CI. -->

**Low** — could break: … Undo: revert the PR.

## How to check

<!-- At most 5 steps, one line each: where to go, what to click, what you should see. -->

1.

<details><summary>Proof</summary>

<!-- That the problem is solved: each test or check with what it proves, in a few words;
command output in a code block (vp check, typecheck, vp test run, Playwright); how the
screenshots were taken (ASTROTIME_SCREENSHOTS=… spec); the docs this PR updated. -->

-

</details>

Closes #

<!-- Last line: the model and harness, e.g. "Done by Claude Opus 5.5 in Claude Code (T3 Code)". -->
