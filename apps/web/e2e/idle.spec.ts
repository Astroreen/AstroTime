// An idle app does no work (docs/plans/foundation.md#D181). The owner's Month
// tab once spent a core for hours: the calendar on this device, holding an
// item beside a server's calendars, was asked to step aside on every store
// change; it stayed, the store said it changed anyway, and the views read
// and drew again, forever. Here the tab is counted in React commits, across a
// change another tab makes: one change, one round of drawing, not a stream.
import { expect, test, type Page } from "@playwright/test";

import { NOW, openApp, WIDE } from "./support.ts";

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

/**
 * Hides or shows the page as the browser tells it when another tab comes to
 * the front: `visibilityState`, `hidden` and `visibilitychange`, faked, as
 * Playwright has no real hidden tab to give. What the page does with them is
 * what is tested, not the browser's throttling of a hidden tab.
 */
async function setShown(page: Page, shown: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", {
      value: value ? "visible" : "hidden",
      configurable: true,
    });
    Object.defineProperty(document, "hidden", { value: !value, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, shown);
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

/**
 * Counts the page's reads of a range of days (`Store.objectsBetween`, a
 * view's), as its store's driver sends them to the leader (D98).
 */
async function countRangeReads(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const counted = globalThis as unknown as { rangeReads: number };
    counted.rangeReads = 0;
    const post = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (message: unknown) {
      const request = message as { type?: string; sql?: string };
      if (request.type === "query" && /"start_ms" <=/.test(request.sql ?? "")) counted.rangeReads++;
      return post.call(this, message);
    };
  });
  return () => page.evaluate(() => (globalThis as unknown as { rangeReads: number }).rangeReads);
}

test("a hidden tab draws another tab's change once it is shown again (D182)", async ({
  page,
  context,
}) => {
  const commits = await countCommits(page);
  const rangeReads = await countRangeReads(page);
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => localStorage.setItem("astrotime.view", "month"));
  await page.goto("/?demo");
  await expect(page.getByRole("listitem", { name: /^Stand-up/ }).first()).toBeVisible();
  const other = await context.newPage();
  await openApp(other);
  // The other tab's store is open, and has read: its next commit is the event.
  await expect(other.getByRole("listitem", { name: /^Stand-up/ }).first()).toBeVisible();

  await setShown(page, false);
  const [hiddenCommits, hiddenReads] = [await commits(), await rangeReads()];
  // Heard on a channel made after the store's, so after the store's own
  // driver heard it, and after everything that ran at once on it: a view
  // that followed the store would have sent its read by then. The HTML
  // standard's `BroadcastChannel` `postMessage` steps sort the destinations
  // "in creation order, oldest first" and queue each one's message event in
  // that order (https://html.spec.whatwg.org/multipage/web-messaging.html#dom-broadcastchannel-postmessage).
  await page.evaluate(() => {
    const heard = new BroadcastChannel("astrotime-store:astrotime");
    (globalThis as unknown as { heard: Promise<void> }).heard = new Promise<void>((resolve) =>
      heard.addEventListener("message", (event: MessageEvent<{ type: string }>) => {
        if (event.data.type !== "changed") return;
        heard.close();
        resolve();
      }),
    );
  });
  await createEvent(other, "Plumber", "2026-11-21");
  await page.evaluate(() => (globalThis as unknown as { heard: Promise<void> }).heard);
  // Hidden, the tab heard the change, and neither read nor drew it.
  expect(await rangeReads()).toBe(hiddenReads);
  expect(await commits()).toBe(hiddenCommits);
  await expect(page.getByRole("listitem", { name: /^Plumber/ })).toHaveCount(0);

  await setShown(page, true);
  await expect(page.getByRole("listitem", { name: /^Plumber/ })).toBeVisible();
  expect(await rangeReads()).toBeGreaterThan(hiddenReads);
});

test("a hidden tab's clock stands still, and shows the time at once when shown (D182)", async ({
  page,
}) => {
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => localStorage.setItem("astrotime.view", "day"));
  await page.goto("/?demo");
  const line = page.locator("[data-now]");
  await expect(line).toBeVisible();
  const at = await line.getAttribute("style");
  await setShown(page, false);
  // Ten minutes of timers: none of the clock's ran.
  await page.clock.runFor("10:00");
  expect(await line.getAttribute("style")).toBe(at);
  await setShown(page, true);
  await expect(line).not.toHaveAttribute("style", at!);
});
