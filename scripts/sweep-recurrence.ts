// The hand-run sweep behind D118 (docs/plans/foundation.md#D118): the
// generated series of packages/core/test/recurrence.test.ts for other seeds,
// ten times as many as each CI run tests, with an oracle that searches every
// rule at one time of the day its whole 400-year cycle, so `neverMeets` is
// checked against ical.js too. Each seed takes a few minutes:
//
//   node scripts/sweep-recurrence.ts 9118 19118 39118
import { spawnSync } from "node:child_process";

const seeds = process.argv.slice(2);
if (seeds.length === 0 || seeds.some((seed) => !/^\d+$/.test(seed))) {
  console.error("Usage: node scripts/sweep-recurrence.ts <seed>…");
  process.exit(2);
}

let failed = 0;
for (const seed of seeds) {
  console.log(`\nSeed ${seed}:`);
  const run = spawnSync(
    "pnpm",
    ["exec", "vp", "test", "run", "packages/core/test/recurrence.test.ts"],
    {
      cwd: new URL("..", import.meta.url),
      stdio: "inherit",
      env: { ...process.env, ASTROTIME_RECURRENCE_SEED: seed, ASTROTIME_RECURRENCE_SCALE: "10" },
    },
  );
  if (run.status !== 0) failed++;
}
process.exit(failed === 0 ? 0 : 1);
