// Every tab works on the one store (docs/plans/foundation.md#D98): real tabs
// of one browser context, the first one leading and the others following,
// until it closes and the next one leads.
import { fileURLToPath } from "node:url";

import type { SqlDriver } from "@astrotime/storage";
import { expect, test, type Page } from "@playwright/test";

import { NOW, openDemo, WIDE } from "./support.ts";

test.use({ viewport: WIDE });

const review = (page: Page, day = "Wednesday, November 4") =>
  page.getByRole("list", { name: day }).getByRole("listitem", { name: /^Design review, / });

/** Opens the app's week on whatever the store holds, with the clock frozen at `NOW`. */
async function openStore(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => localStorage.setItem("astrotime.view", "week"));
  await page.goto("/");
}

test("a second tab works on the same store, and shows at once what the other writes", async ({
  page,
}) => {
  // The first tab opens an empty store, and leads it: no account yet, so
  // the calendar on this device (docs/plans/foundation.md#D122).
  await openStore(page);
  await expect(page.getByRole("button", { name: /^Accounts/ })).toBeVisible();
  // The second tab writes the demo data through the first; both show it.
  const second = await page.context().newPage();
  await openDemo(second, "week");
  await expect(review(second)).toBeVisible();
  await expect(review(page)).toBeVisible();
});

test("closing the leading tab hands the store to the other, which keeps working", async ({
  page,
}) => {
  await openDemo(page, "week");
  await expect(review(page)).toBeVisible();
  const second = await page.context().newPage();
  await openStore(second);
  await expect(review(second)).toBeVisible();
  await page.close();
  // The second tab leads now: it reads, a calendar hidden and shown again...
  await second.getByRole("checkbox", { name: "Work" }).click();
  await expect(review(second)).toHaveCount(0);
  await second.getByRole("checkbox", { name: "Work" }).click();
  await expect(review(second)).toBeVisible();
  // ...and a third tab writes through it: the demo data a week later, which
  // the second tab shows at once.
  const third = await second.context().newPage();
  const later = new Date(NOW.getTime() + 7 * 86_400_000);
  await third.clock.setFixedTime(later);
  await third.addInitScript(() => localStorage.setItem("astrotime.view", "week"));
  await third.goto("/?demo");
  await expect(review(third, "Wednesday, November 11")).toBeVisible();
  await expect(review(second)).toHaveCount(0);
});

test("a write on its way when the leading tab closes fails, and runs once when sent again", async ({
  context,
}) => {
  // The driver itself, in two tabs of the dev server, on a database of its own.
  const module = `/@fs${fileURLToPath(new URL("../../../packages/storage/src/web/index.ts", import.meta.url))}`;
  type Tab = typeof globalThis & { driver: SqlDriver; onItsWay: Promise<string> };
  const [first, second] = [await context.newPage(), await context.newPage()];
  await first.goto("/");
  await second.goto("/");
  await first.evaluate(async (url) => {
    const { webDriver } = (await import(url)) as typeof import("@astrotime/storage/web");
    const driver = await webDriver("tabs");
    (globalThis as Tab).driver = driver;
    await driver.script("CREATE TABLE t (x);");
    // A transaction the leading tab never ends: the second tab's write waits behind it.
    await driver.script("BEGIN IMMEDIATE;");
    await driver.query("INSERT INTO t VALUES ('first')", []);
  }, module);
  await second.evaluate(async (url) => {
    const { webDriver } = (await import(url)) as typeof import("@astrotime/storage/web");
    const driver = await webDriver("tabs");
    (globalThis as Tab).driver = driver;
    (globalThis as Tab).onItsWay = driver.query("INSERT INTO t VALUES ('second')", []).then(
      () => "ran",
      (error: Error) => error.name,
    );
  }, module);
  await first.close();
  expect(await second.evaluate(() => (globalThis as Tab).onItsWay)).toBe("HandOverError");
  // Neither the failed write nor the closed tab's open transaction is in the
  // store; written again, it is there once.
  const rows = await second.evaluate(async () => {
    const { driver } = globalThis as Tab;
    const before = await driver.query("SELECT x FROM t", []);
    await driver.query("INSERT INTO t VALUES ('second')", []);
    return { before, after: await driver.query("SELECT x FROM t", []) };
  });
  expect(rows).toEqual({ before: [], after: [["second"]] });
});
