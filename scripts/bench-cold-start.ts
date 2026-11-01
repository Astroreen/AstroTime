// How fast the built web app opens on a big calendar: the production build,
// precompressed and served by the web image's own server, its store filled
// with `big-calendar.ts`'s 12 230 objects. For each run a new tab opens the
// app; it prints when the first paint came, when the week's first event was
// drawn, how long the main thread was blocked until then, and the bytes the
// page fetched. Like `bench-big-calendar.ts` it prints numbers and passes or
// fails nothing (AGENTS.md: no timeouts in tests). Run it by hand, before and
// after a change to what the app loads or does on start:
//
//   node scripts/bench-cold-start.ts
//
// "Cold" runs clear the HTTP cache first, as on a first visit after an
// update (the store stays, as it does); "warm" runs reuse it. With
// `ASTROTIME_BENCH_SLOW=1` the network is throttled as Chrome DevTools'
// "Fast 4G" and the CPU slowed four times, about a mid-range phone.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { chromium, type CDPSession, type Page } from "playwright";

import { compress } from "../apps/proxy/src/compress.ts";
import { createAppServer } from "../apps/proxy/src/server.ts";

const RUNS = 5;
const slow = process.env["ASTROTIME_BENCH_SLOW"] === "1";
const web = fileURLToPath(new URL("../apps/web/", import.meta.url));
const dist = `${web}dist`;

execFileSync("vp", ["build"], { cwd: web, stdio: "ignore" });
// The page that fills the store, beside the app on its origin.
execFileSync(
  "vp",
  [
    "build",
    "scripts/bench-seed",
    "--base",
    "/bench/",
    "--outDir",
    `${dist}/bench`,
    "--emptyOutDir",
  ],
  { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "ignore" },
);
await compress(dist);

const server = createAppServer({ root: dist, allow: [] });
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
const context = await browser.newContext({
  locale: "en-US",
  timezoneId: "Europe/Vilnius",
  viewport: { width: 1440, height: 900 },
});
// The app opens in the Week.
await context.addInitScript(() => localStorage.setItem("astrotime.view", "week"));

const seed = await context.newPage();
await seed.goto(`${origin}/bench/index.html`);
await seed.waitForFunction(() => document.title === "filled", null, { timeout: 0 });
await seed.close();

interface Run {
  fcp: number;
  drawn: number;
  blocked: number;
  bytes: number;
  heap: number;
}

/** Records, in the page, when an event of the calendar is first in the DOM, and the long tasks. */
function watch() {
  const marks = { drawn: 0, blocked: 0 };
  (globalThis as unknown as { astrotimeBench: typeof marks }).astrotimeBench = marks;
  new PerformanceObserver((list) => {
    for (const task of list.getEntries()) if (!marks.drawn) marks.blocked += task.duration - 50;
  }).observe({ type: "longtask", buffered: true });
  new MutationObserver((_, observer) => {
    if (document.querySelector('[aria-label^="Event "], [aria-label^="Series "]')) {
      marks.drawn = performance.now();
      observer.disconnect();
    }
  }).observe(document, { childList: true, subtree: true });
}

async function open(page: Page, cdp: CDPSession): Promise<Run> {
  let fetched = 0;
  cdp.on("Network.loadingFinished", (event) => (fetched += event.encodedDataLength));
  await page.goto(origin);
  await page.waitForFunction(
    () => (globalThis as unknown as { astrotimeBench: { drawn: number } }).astrotimeBench.drawn > 0,
    null,
    { timeout: 0 },
  );
  return page.evaluate((bytes) => {
    const marks = (globalThis as unknown as { astrotimeBench: { drawn: number; blocked: number } })
      .astrotimeBench;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? NaN;
    const heap = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory
      .usedJSHeapSize;
    return { fcp, drawn: marks.drawn, blocked: marks.blocked, bytes, heap };
  }, fetched);
}

async function measure(label: string, cold: boolean) {
  const runs: Run[] = [];
  for (let run = 0; run < RUNS; run++) {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    if (cold) await cdp.send("Network.clearBrowserCache");
    if (slow) {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: (9 * 1024 * 1024) / 8,
        uploadThroughput: (1.5 * 1024 * 1024) / 8,
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    await page.addInitScript(watch);
    runs.push(await open(page, cdp));
    await page.close();
  }
  const median = (pick: (run: Run) => number) =>
    runs.map(pick).toSorted((a, b) => a - b)[RUNS >> 1]!;
  const ms = (value: number) => `${Math.round(value)} ms`.padStart(8);
  console.log(
    `${label.padEnd(6)} first paint ${ms(median((r) => r.fcp))}   week drawn ${ms(median((r) => r.drawn))}` +
      `   blocked ${ms(median((r) => r.blocked))}   fetched ${(median((r) => r.bytes) / 1024).toFixed(0).padStart(5)} KiB` +
      `   heap ${(median((r) => r.heap) / 1024 / 1024).toFixed(1)} MiB`,
  );
}

console.log(
  `The built app on 12 230 objects${slow ? ", Fast 4G and a 4× slower CPU" : ""}; the median of ${RUNS} runs:\n`,
);
await measure("cold", true);
await measure("warm", false);

await browser.close();
server.close();
rmSync(`${dist}/bench`, { recursive: true, force: true });
