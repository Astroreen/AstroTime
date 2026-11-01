// Dragging and resizing end to end on the demo data with the clock frozen on
// Wednesday, November 4, 2026, 10:40 in Vilnius (docs/plans/foundation.md#D14,
// D16; design D111, D112): an event to another time and day, seen in Week and
// the Agenda; a block's end; a task's chip; an occurrence of a series in a
// scope; Escape; a read-only calendar's item; the all-day strip and the Month;
// a press sized into a new event; a finger's long press; and the keys that
// move a focused item.
import { expect, test, type Locator, type Page } from "@playwright/test";

import { NOW, openDemo, WIDE } from "./support.ts";

test.use({ viewport: WIDE });

const HOUR = 56;

const day = (page: Page, name: string) => page.getByRole("list", { name });
const item = (page: Page, dayName: string, name: string | RegExp) =>
  day(page, dayName).getByRole("listitem", { name });
const announced = (page: Page) => page.getByRole("main").getByRole("status");

/** A point on a day's column: `x` across it (0–1), at `hours` past its midnight. */
async function pointOn(page: Page, dayName: string, hours: number, x = 0.5) {
  const box = (await day(page, dayName).boundingBox())!;
  return { x: box.x + box.width * x, y: box.y + hours * HOUR };
}

/**
 * A point in what a locator shows: across its middle, 10 pixels below its
 * top (the first slot of a block, clear of the slots' edges).
 */
async function pointIn(locator: Locator, dy = 10) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + dy };
}

/** Presses at `from`, moves to `to` in steps, as a mouse does; releases unless told not to. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  release = true,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  if (release) await page.mouse.up();
}

test("an event dragged to another time and day shows there in Week and the Agenda", async ({
  page,
}) => {
  await openDemo(page, "week");
  const lunch = item(page, "Wednesday, November 4", "Lunch with Marta, 1:00 – 2:00 PM");
  // Held in its first slot, 1:00; let go on Thursday's 3:00: a day and two hours on.
  await drag(page, await pointIn(lunch), await pointOn(page, "Thursday, November 5", 15.1), false);
  await expect(page.getByText("3:00 – 4:00 PM", { exact: true })).toBeVisible();
  await page.mouse.up();
  await expect(
    item(page, "Thursday, November 5", "Lunch with Marta, 3:00 – 4:00 PM"),
  ).toBeVisible();
  await expect(item(page, "Wednesday, November 4", /^Lunch with Marta/)).toHaveCount(0);
  await expect(announced(page)).toHaveText(
    "Moved: Lunch with Marta. Thursday, November 5 · 3:00 – 4:00 PM",
  );
  // The drop opened nothing.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("a");
  await expect(
    item(page, "Thursday, November 5", "Lunch with Marta, 3:00 – 4:00 PM"),
  ).toBeAttached();
});

test("locator.dragTo moves an event onto another day's slot", async ({ page }) => {
  await openDemo(page, "week");
  const cinema = item(page, "Tuesday, November 3", "Cinema, 6:00 – 8:30 PM");
  const monday = day(page, "Monday, November 2");
  const box = (await monday.boundingBox())!;
  // Held in its middle, 7:15 PM; dropped on Monday's 6:20 PM, it starts an hour earlier.
  await cinema.dragTo(monday, { targetPosition: { x: box.width / 2, y: 18.35 * HOUR } });
  await expect(item(page, "Monday, November 2", "Cinema, 5:00 – 7:30 PM")).toBeVisible();
});

test("a block's bottom edge resizes its end; its top edge its start", async ({ page }) => {
  await openDemo(page, "week");
  const lunch = item(page, "Wednesday, November 4", "Lunch with Marta, 1:00 – 2:00 PM");
  const box = (await lunch.boundingBox())!;
  // The bottom edge, held at 1:55, let go at 3:25: the end moves an hour and a half on.
  await drag(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height - 2 },
    await pointOn(page, "Wednesday, November 4", 15.4),
  );
  const longer = item(page, "Wednesday, November 4", "Lunch with Marta, 1:00 – 3:30 PM");
  await expect(longer).toBeVisible();
  // The top edge, held at 1:00, let go at 12:30.
  const top = (await longer.boundingBox())!;
  await drag(
    page,
    { x: top.x + top.width / 2, y: top.y + 2 },
    await pointOn(page, "Wednesday, November 4", 12.55),
  );
  await expect(
    item(page, "Wednesday, November 4", "Lunch with Marta, 12:30 – 3:30 PM"),
  ).toBeVisible();
});

test("a task's chip drags its due", async ({ page }) => {
  await openDemo(page, "week");
  const report = item(page, "Wednesday, November 4", "Task: Send the report, 3:00 PM");
  await drag(page, await pointIn(report), await pointOn(page, "Wednesday, November 4", 17.1));
  await expect(item(page, "Wednesday, November 4", "Task: Send the report, 5:00 PM")).toBeVisible();
  await page.getByRole("button", { name: "Task: Send the report, 5:00 PM" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Send the report" })
      .getByText("Due Wednesday, November 4, 5:00 PM"),
  ).toBeVisible();
});

test("an occurrence of a series asks the scope; this occurrence moves it alone", async ({
  page,
}) => {
  await openDemo(page, "week");
  const standUp = item(page, "Thursday, November 5", "Stand-up, 9:00 – 9:30 AM");
  await drag(page, await pointIn(standUp, 6), await pointOn(page, "Thursday, November 5", 10.1));
  const scope = page.getByRole("alertdialog", { name: "Edit recurring event" });
  // A new time on the same day: all three, the first chosen (design D108).
  await expect(scope.getByRole("radio")).toHaveCount(3);
  await expect(scope.getByRole("radio", { name: "This occurrence" })).toBeChecked();
  await scope.getByRole("button", { name: "OK" }).click();
  await expect(item(page, "Thursday, November 5", "Stand-up, 10:00 – 10:30 AM")).toBeVisible();
  await expect(announced(page)).toHaveText(
    "Moved: Stand-up. Thursday, November 5 · 10:00 – 10:30 AM",
  );
  await expect(item(page, "Friday, November 6", "Stand-up, 9:00 – 9:30 AM")).toBeVisible();
  await expect(item(page, "Wednesday, November 4", "Stand-up, 9:00 – 9:30 AM")).toBeVisible();
});

test("a drop on another day offers no all occurrences; cancelling leaves the series as it was", async ({
  page,
}) => {
  await openDemo(page, "week");
  const standUp = item(page, "Thursday, November 5", "Stand-up, 9:00 – 9:30 AM");
  await drag(page, await pointIn(standUp, 6), await pointOn(page, "Saturday, November 7", 9.1));
  const scope = page.getByRole("alertdialog", { name: "Edit recurring event" });
  await expect(scope.getByRole("radio")).toHaveCount(2);
  await expect(scope.getByRole("radio", { name: "All occurrences" })).toHaveCount(0);
  await scope.getByRole("button", { name: "Cancel" }).click();
  await expect(announced(page)).toHaveText("Move cancelled");
  await expect(item(page, "Thursday, November 5", "Stand-up, 9:00 – 9:30 AM")).toBeVisible();
  await expect(item(page, "Saturday, November 7", /^Stand-up/)).toHaveCount(0);
});

test("Escape cancels a drag: the item stays, nothing opens", async ({ page }) => {
  await openDemo(page, "week");
  const lunch = item(page, "Wednesday, November 4", "Lunch with Marta, 1:00 – 2:00 PM");
  await drag(page, await pointIn(lunch), await pointOn(page, "Friday, November 6", 16.1), false);
  await expect(page.getByText("4:00 – 5:00 PM", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("4:00 – 5:00 PM", { exact: true })).toHaveCount(0);
  await page.mouse.up();
  await expect(announced(page)).toHaveText("Move cancelled");
  await expect(
    item(page, "Wednesday, November 4", "Lunch with Marta, 1:00 – 2:00 PM"),
  ).toBeVisible();
  await expect(item(page, "Friday, November 6", /^Lunch with Marta/)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a read-only calendar's item does not drag, by pointer or keys", async ({ page }) => {
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Next week" }).click();
  const strip = page.getByRole("list", { name: "All day" });
  const festival = strip.getByRole("listitem", { name: "Town festival, All day" });
  const from = await pointIn(festival);
  await drag(page, from, { x: from.x + 400, y: from.y }, false);
  await expect(page.locator("[data-ghost]")).toHaveCount(0);
  await page.mouse.up();
  const opener = strip.getByRole("button", { name: "Town festival, All day" });
  await expect(opener).not.toHaveAttribute("aria-keyshortcuts");
  await opener.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await opener.click();
  await expect(
    page.getByRole("dialog", { name: "Town festival" }).getByText("Monday, November 9"),
  ).toBeVisible();
});

test("an all-day item drags to another day in the strip, keeping its length", async ({ page }) => {
  await openDemo(page, "week");
  const strip = page.getByRole("list", { name: "All day" });
  const conference = strip.getByRole("listitem", { name: "Developer conference, All day" });
  // Held on its first day, Thursday; let go on Monday.
  const from = await pointIn(conference, 8);
  const box = (await conference.boundingBox())!;
  const monday = await pointOn(page, "Monday, November 2", 0);
  await drag(page, { x: box.x + 20, y: from.y }, { x: monday.x, y: from.y });
  await strip.getByRole("button", { name: "Developer conference, All day" }).click();
  await expect(
    page.getByRole("dialog", { name: "Developer conference" }).getByText("November 2 – 4"),
  ).toBeVisible();
});

test("from the grid into the strip an event is all day; from the strip onto the grid an hour", async ({
  page,
}) => {
  await openDemo(page, "week");
  // The whole strip, so a new item in it shows.
  await page.getByRole("button", { name: "Show all all-day items" }).click();
  const strip = page.getByRole("list", { name: "All day" });
  const lunch = item(page, "Wednesday, November 4", "Lunch with Marta, 1:00 – 2:00 PM");
  const birthday = await pointIn(
    strip.getByRole("listitem", { name: "Mom's birthday, All day" }),
    8,
  );
  await drag(page, await pointIn(lunch), birthday);
  const allDay = strip.getByRole("listitem", { name: "Lunch with Marta, All day" });
  await expect(allDay).toBeVisible();
  await drag(page, await pointIn(allDay, 8), await pointOn(page, "Thursday, November 5", 18.6));
  await expect(
    item(page, "Thursday, November 5", "Lunch with Marta, 6:30 – 7:30 PM"),
  ).toBeVisible();
});

test("in the Month an item drags to another day, keeping its time", async ({ page }) => {
  await openDemo(page, "month");
  const saturday = page.getByRole("list", { name: "Saturday, November 7" });
  const concert = saturday.getByRole("listitem", {
    name: "Concert at the philharmonic, 7:00 – 9:00 PM",
  });
  const target = (await page.getByRole("button", { name: "Thursday, November 12" }).boundingBox())!;
  await drag(page, await pointIn(concert, 6), { x: target.x, y: target.y + 40 });
  await expect(
    page
      .getByRole("list", { name: "Thursday, November 12" })
      .getByRole("listitem", { name: "Concert at the philharmonic, 7:00 – 9:00 PM" }),
  ).toBeVisible();
  // The drop opened neither the day nor the item.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Thursday, November 12" })).toBeVisible();
});

test("a press dragged over an empty slot sizes a new event", async ({ page }) => {
  await openDemo(page, "week");
  await drag(
    page,
    await pointOn(page, "Saturday, November 7", 14.1),
    await pointOn(page, "Saturday, November 7", 16.4),
    false,
  );
  await expect(page.getByText("2:00 – 4:30 PM", { exact: true })).toBeVisible();
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await expect(dialog.getByLabel("Start date")).toHaveValue("2026-11-07");
  await expect(dialog.getByLabel("Start time")).toHaveValue("14:00");
  await expect(dialog.getByLabel("End time")).toHaveValue("16:30");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Cancelled by Escape, its release in the same column makes nothing.
  await drag(
    page,
    await pointOn(page, "Saturday, November 7", 14.1),
    await pointOn(page, "Saturday, November 7", 15.1),
    false,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(announced(page)).toHaveText("Move cancelled");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("keys move a focused item and say where it went; Shift moves its end", async ({ page }) => {
  await openDemo(page, "week");
  const opener = day(page, "Wednesday, November 4").getByRole("button", {
    name: "Lunch with Marta, 1:00 – 2:00 PM",
  });
  await expect(opener).toHaveAttribute("aria-keyshortcuts", /Alt\+ArrowDown/);
  await expect(opener).toHaveAccessibleDescription(
    /Alt with the up or down arrow moves it by 15 minutes/,
  );
  await opener.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(announced(page)).toHaveText(
    "Moved: Lunch with Marta. Wednesday, November 4 · 1:15 – 2:15 PM",
  );
  await page.keyboard.press("Alt+ArrowRight");
  const moved = day(page, "Thursday, November 5").getByRole("button", {
    name: "Lunch with Marta, 1:15 – 2:15 PM",
  });
  // The focus follows it to its new day.
  await expect(moved).toBeFocused();
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await expect(
    day(page, "Thursday, November 5").getByRole("button", {
      name: "Lunch with Marta, 1:15 – 2:30 PM",
    }),
  ).toBeFocused();
  await expect(announced(page)).toHaveText(
    "Resized: Lunch with Marta. Thursday, November 5 · 1:15 – 2:30 PM",
  );
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  /** The demo with its clock installed, so a long press is the clock run on, not a wait. */
  async function openTouch(page: Page) {
    await page.clock.install({ time: NOW });
    await page.addInitScript(() => localStorage.setItem("astrotime.view", "week"));
    await page.goto("/?demo");
    // A finger, as Chromium's touch input sends it.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: at ? [at] : [] });
    return {
      touch,
      async slide(from: { x: number; y: number }, to: { x: number; y: number }) {
        for (let step = 1; step <= 8; step++) {
          await touch("touchMove", {
            x: from.x + ((to.x - from.x) * step) / 8,
            y: from.y + ((to.y - from.y) * step) / 8,
          });
        }
      },
    };
  }

  test("a long press drags an item; let go, it is where the finger went", async ({ page }) => {
    const { touch, slide } = await openTouch(page);
    const lunch = item(page, "Wednesday, November 4", "Lunch with Marta, 1:00 – 2:00 PM");
    const from = await pointIn(lunch);
    const to = await pointOn(page, "Thursday, November 5", 15.1);
    await touch("touchStart", from);
    await page.clock.runFor(500);
    await slide(from, to);
    await touch("touchEnd");
    await expect(
      item(page, "Thursday, November 5", "Lunch with Marta, 3:00 – 4:00 PM"),
    ).toBeVisible();
  });

  test("a finger that moves before the long press scrolls; the item stays", async ({ page }) => {
    const { touch, slide } = await openTouch(page);
    const lunch = item(page, "Wednesday, November 4", "Lunch with Marta, 1:00 – 2:00 PM");
    const from = await pointIn(lunch);
    await touch("touchStart", from);
    await slide(from, { x: from.x + 150, y: from.y - 120 });
    await page.clock.runFor(500);
    await touch("touchEnd");
    await expect(page.locator("[data-ghost]")).toHaveCount(0);
    await expect(lunch).toBeVisible();
    await expect(item(page, "Thursday, November 5", /^Lunch with Marta/)).toHaveCount(0);
  });
});
