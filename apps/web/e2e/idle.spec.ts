// An idle app does no work (docs/plans/foundation.md#D181). The owner's Month
// tab once spent a core for hours: the calendar on this device, holding an
// item beside a server's calendars, was asked to step aside on every store
// change; it stayed, the store said it changed anyway, and the views read
// and drew again, forever. Here the tab is counted in React commits, across a
// change another tab makes: one change, one round of drawing, not a stream.
import { expect, test, type Page } from "@playwright/test";

import { openApp, WIDE } from "./support.ts";

test.use({ viewport: WIDE });

/** Counts the page's React commits, through the hook React DevTools would install. */
async function countCommits(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const counted = globalThis as unknown as { commits: number };
    counted.commits = 0;
    Object.defineProperty(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      value: {
        supportsFiber: true,
        renderers: new Map(),
        inject() {
          return 1;
        },
        onCommitFiberRoot() {
          counted.commits++;
        },
        onCommitFiberUnmount() {},
        onPostCommitFiberRoot() {},
        checkDCE() {},
      },
    });
  });
  return () => page.evaluate(() => (globalThis as unknown as { commits: number }).commits);
}

/** Creates an event on a day of the demo's month with room to show it. */
async function createEvent(page: Page, title: string, date: string): Promise<void> {
  await page.getByRole("button", { name: "Create" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByRole("textbox", { name: "Title" }).fill(title);
  await dialog.getByLabel("Start date").fill(date);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
}

test("the Month view beside a calendar on this device that stays draws once per change", async ({
  page,
  context,
}) => {
  const commits = await countCommits(page);
  // The calendar on this device holds an item, so it stays beside the demo's.
  await openApp(page);
  await createEvent(page, "Kept here", "2026-11-14");
  await page.evaluate(() => localStorage.setItem("astrotime.view", "month"));
  await page.goto("/?demo");
  const kept = page.getByRole("listitem", { name: /^Kept here/ });
  await expect(kept).toBeVisible();
  await expect(page.getByRole("region", { name: "On this device" })).toBeVisible();

  // Another tab makes one change; this one shows it.
  const before = await commits();
  const other = await context.newPage();
  await openApp(other);
  await createEvent(other, "Plumber", "2026-11-21");
  await expect(page.getByRole("listitem", { name: /^Plumber/ })).toBeVisible();
  const drawn = (await commits()) - before;
  // Drawn, a handful of times; looping, it drew some 175 times a second.
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThan(10);
});
