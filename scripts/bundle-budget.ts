// The built web app's budget (docs/plans/foundation.md#D145): the
// JavaScript a first visit fetches before the calendar can draw (the entry
// and every chunk it preloads, gzipped; the web image serves brotli where it
// can, a little smaller), and AstroTime's own chunk among them. The store's
// worker and SQLite's wasm load beside it, as sqlite-wasm ships them. CI
// runs it after the web build; a change that passes a budget either earns
// its bytes, and raises the budget in the same PR with the reason, or loads
// them later.
//
//   vp run --filter @astrotime/web build && node scripts/bundle-budget.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** Gzipped kilobytes (1024 bytes). */
const BUDGET = {
  /** Everything the page loads at once: 318 KiB at D145. */
  initial: 340,
  /** AstroTime's own code at once: 120 KiB at D145. */
  app: 130,
};

const dist = fileURLToPath(new URL("../apps/web/dist/", import.meta.url));
const html = readFileSync(join(dist, "index.html"), "utf8");
const initial = [
  ...html.matchAll(/<script[^>]+type="module"[^>]+src="\/([^"]+\.js)"/g),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/([^"]+\.js)"/g),
].map((match) => match[1]!);
if (!initial.some((file) => /^assets\/index-[\w-]+\.js$/.test(file))) {
  throw new Error("dist/index.html loads no index chunk: was the web app built?");
}

const kib = (file: string) => gzipSync(readFileSync(join(dist, file))).length / 1024;
const sizes = new Map(initial.map((file) => [file, kib(file)]));
const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
// The libraries' chunks are named by their groups in apps/web/vite.config.ts;
// the rest are AstroTime's own, in as many chunks as the bundler shares out.
const LIBRARIES = /^assets\/(react|base-ui|ical|drizzle|i18n|vendor|rolldown-runtime)-[\w-]+\.js$/;
const app = [...sizes]
  .filter(([file]) => !LIBRARIES.test(file))
  .reduce((sum, [, size]) => sum + size, 0);
const later = readdirSync(join(dist, "assets")).filter(
  (file) => file.endsWith(".js") && !initial.includes(`assets/${file}`),
);

for (const [file, size] of [...sizes].toSorted((a, b) => b[1] - a[1])) {
  console.log(`${size.toFixed(1).padStart(7)} KiB  ${file}`);
}
console.log(`${total.toFixed(1).padStart(7)} KiB  at once (budget ${BUDGET.initial} KiB)`);
console.log(
  `${app.toFixed(1).padStart(7)} KiB  AstroTime's own at once (budget ${BUDGET.app} KiB)`,
);
console.log(`Loaded later or in a worker: ${later.join(", ")}`);

const over = [
  total > BUDGET.initial && `the page loads ${total.toFixed(1)} KiB at once`,
  app > BUDGET.app && `AstroTime's own code at once is ${app.toFixed(1)} KiB`,
].filter(Boolean);
if (over.length > 0) {
  console.error(`Over budget: ${over.join("; ")} (docs/plans/foundation.md#D145).`);
  process.exitCode = 1;
}
