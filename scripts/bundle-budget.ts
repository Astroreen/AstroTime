// The built web app's budget (docs/plans/foundation.md#D145): the
// JavaScript a first visit fetches before the calendar can draw (the entry
// and every chunk it imports, as Vite's manifest lists them, gzipped; the web
// image serves brotli where it can, a little smaller), and AstroTime's own
// code among it. The store's
// worker and SQLite's wasm load beside it, as sqlite-wasm ships them. CI
// runs it after the web build; a change that passes a budget either earns
// its bytes, and raises the budget in the same PR with the reason, or loads
// them later.
//
//   vp run --filter @astrotime/web build && node scripts/bundle-budget.ts
import { readFileSync } from "node:fs";
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

/** A chunk as Vite's manifest (`build.manifest`) lists it. */
interface Chunk {
  readonly file: string;
  readonly name?: string;
  readonly imports?: readonly string[];
  readonly dynamicImports?: readonly string[];
}
const manifest = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8")) as Record<
  string,
  Chunk
>;
const page = manifest["index.html"];
if (!page) throw new Error("Vite's manifest has no index.html: was the web app built?");

/** The chunks `keys` load, and every chunk they import statically, by manifest key. */
function closure(keys: readonly string[]): Set<string> {
  const found = new Set<string>();
  const visit = (key: string) => {
    if (found.has(key)) return;
    found.add(key);
    for (const next of manifest[key]?.imports ?? []) visit(next);
  };
  for (const key of keys) visit(key);
  return found;
}

const initial = closure(["index.html"]);
const later = closure([...initial].flatMap((key) => manifest[key]?.dynamicImports ?? []));
for (const key of initial) later.delete(key);

// The libraries' chunks are named by their groups in apps/web/vite.config.ts;
// the rest are AstroTime's own, in as many chunks as the bundler shares out.
const LIBRARIES = new Set([
  "react",
  "base-ui",
  "ical",
  "drizzle",
  "i18n",
  "vendor",
  "rolldown-runtime",
]);
const kib = (key: string) => gzipSync(readFileSync(join(dist, manifest[key]!.file))).length / 1024;
const sizes = new Map([...initial].map((key) => [key, kib(key)]));
const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
const app = [...sizes]
  .filter(([key]) => !LIBRARIES.has(manifest[key]!.name ?? ""))
  .reduce((sum, [, size]) => sum + size, 0);

for (const [key, size] of [...sizes].toSorted((a, b) => b[1] - a[1])) {
  console.log(`${size.toFixed(1).padStart(7)} KiB  ${manifest[key]!.file}`);
}
console.log(`${total.toFixed(1).padStart(7)} KiB  at once (budget ${BUDGET.initial} KiB)`);
console.log(
  `${app.toFixed(1).padStart(7)} KiB  AstroTime's own at once (budget ${BUDGET.app} KiB)`,
);
console.log(
  `Loaded later: ${[...later].map((key) => `${manifest[key]!.file} (${kib(key).toFixed(1)} KiB)`).join(", ")}`,
);

const over = [
  total > BUDGET.initial && `the page loads ${total.toFixed(1)} KiB at once`,
  app > BUDGET.app && `AstroTime's own code at once is ${app.toFixed(1)} KiB`,
].filter(Boolean);
if (over.length > 0) {
  console.error(`Over budget: ${over.join("; ")} (docs/plans/foundation.md#D145).`);
  process.exitCode = 1;
}
