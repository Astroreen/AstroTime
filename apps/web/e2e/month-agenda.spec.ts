// The Month and Agenda views on the demo data, with the clock frozen on
// Wednesday, November 4, 2026, 10:40 in Vilnius (design D86–D88).
import { expect, test, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

const day = (page: Page, name: string) => page.getByRole("list", { name, exact: true });
const header = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });
const dayButton = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test.describe("Month", () => {
  test.use({ viewport: PHONE });

  test("six weeks of tiles: chips in their colours, spans over days, today marked, +N on a full day (D86)", async ({
    page,
  }) => {
    await openDemo(page, "month");
    await expect(page.getByRole("main", { name: "November" })).toBeVisible();
    // An en-US month: weeks from Sunday, November 1, to Saturday, December 12.
    await expect(dayButton(page, "Sunday, November 1")).toBeVisible();
    await expect(dayButton(page, "Saturday, December 12")).toBeVisible();
    await expect(page.getByText("Week 45")).toBeAttached();
    await expect(dayButton(page, "Wednesday, November 4")).toHaveAttribute("aria-current", "date");
    await expect(
      day(page, "Thursday, November 5").getByRole("listitem", {
        name: "Developer conference, All day",
      }),
    ).toBeVisible();
    await expect(
      day(page, "Monday, November 2").getByRole("listitem", { name: /^Stand-up, 9:00/ }),
    ).toBeVisible();
    const today = day(page, "Wednesday, November 4");
    await expect(today.getByRole("button", { name: "3 undone tasks" })).toBeVisible();
    await expect(
      today.getByRole("listitem", { name: "Completed task: Pay the rent, All day" }),
    ).toBeVisible();
    // Rolled over to today's chip, no longer on the day it was due (D51).
    await expect(
      day(page, "Monday, November 2").getByRole("listitem", { name: /Reply to Olga/ }),
    ).toHaveCount(0);
    // More than the tile fits: "+N" opens the day.
    await today.getByRole("button", { name: "6 more items on Wednesday, November 4" }).click();
    await expect(header(page, "Wednesday, November 4")).toBeVisible();
    await expect(page.getByRole("list", { name: "All day" })).toBeVisible();
  });

  test("a tap on a day opens it in the Day view; a tap on an item its details", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await openDemo(page, "month");
    await dayButton(page, "Friday, November 13").click();
    await expect(header(page, "Friday, November 13")).toBeVisible();
    await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );

    await page.getByRole("button", { name: "Month", exact: true }).click();
    const conference = day(page, "Thursday, November 5").getByRole("listitem", {
      name: "Developer conference, All day",
    });
    // The span covers Thursday to Saturday; anywhere on it, it is the item (PR 6).
    const box = (await conference.boundingBox())!;
    await conference.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.getByRole("dialog", { name: "Developer conference" })).toBeVisible();
  });

  test.describe("on a touch screen", () => {
    test.use({ hasTouch: true });

    test("a tap anywhere on a day opens it, on an item, +N or the undone chip too (D86, D119)", async ({
      page,
    }) => {
      await openDemo(page, "month");
      const thursday = day(page, "Thursday, November 5");
      const conference = thursday.getByRole("listitem", { name: "Developer conference, All day" });
      await expect(conference).toBeVisible();
      // No chip is a button of its own: the day is the target.
      await expect(page.locator('[data-view="month"] [role="listitem"] button')).toHaveCount(0);
      await conference.tap();
      await expect(header(page, "Thursday, November 5")).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await page.locator("body").press("m");
      const today = day(page, "Wednesday, November 4");
      await today.getByRole("listitem", { name: "6 more items on Wednesday, November 4" }).tap();
      await expect(header(page, "Wednesday, November 4")).toBeVisible();

      await page.locator("body").press("m");
      await today.getByText(/undone task/).tap();
      await expect(header(page, "Wednesday, November 4")).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  });

  test("previous, next, today and the month picker move by month", async ({ page }) => {
    await page.setViewportSize(WIDE);
    await openDemo(page, "month");
    await page.getByRole("button", { name: "Next month" }).click();
    await expect(page.getByRole("main", { name: "December" })).toBeVisible();
    await expect(dayButton(page, "Thursday, December 31")).toBeVisible();
    await page.keyboard.press("p");
    await page.keyboard.press("k");
    await expect(page.getByRole("main", { name: "October" })).toBeVisible();
    await page.keyboard.press("t");
    await expect(page.getByRole("main", { name: "November" })).toBeVisible();

    await page.getByRole("button", { name: "November, choose a date" }).click();
    const picker = page.getByRole("dialog");
    await picker.getByRole("button", { name: "Next month" }).click();
    await picker.getByRole("button", { name: "Next month" }).click();
    await picker.getByRole("button", { name: "Tuesday, January 12" }).click();
    await expect(picker).toHaveCount(0);
    await expect(page.getByRole("main", { name: "January 2027" })).toBeVisible();
    await expect(dayButton(page, "Tuesday, January 12")).toBeVisible();
  });
});

test.describe("Agenda", () => {
  test.use({ viewport: PHONE });

  test("opens at today, headed by the undone tasks chip; items in time order, empty days left out (D87)", async ({
    page,
  }) => {
    await openDemo(page, "agenda");
    const todayHeader = header(page, "Wednesday, November 4");
    await expect(todayHeader).toHaveAttribute("aria-current", "date");
    await expect(todayHeader).toBeInViewport();
    const today = day(page, "Wednesday, November 4");
    await expect(today.getByRole("listitem").first()).toContainText("3 undone tasks");
    const top = async (name: RegExp) =>
      (await today.getByRole("listitem", { name }).boundingBox())!.y;
    expect(await top(/^Mom's birthday, All day/)).toBeLessThan(await top(/^Stand-up, /));
    expect(await top(/^Stand-up, /)).toBeLessThan(await top(/^Design review, /));
    expect(await top(/^Design review, /)).toBeLessThan(await top(/^Task: Send the report, /));
    // An item over several days is on each of them.
    for (const [name, part] of [
      ["Thursday, November 5", "Day 1 of 3"],
      ["Friday, November 6", "Day 2 of 3"],
      ["Saturday, November 7", "Day 3 of 3"],
    ] as const) {
      await expect(
        day(page, name).getByRole("listitem", { name: `Developer conference, ${part}` }),
      ).toBeAttached();
    }
    await expect(day(page, "Saturday, November 14")).toHaveCount(0);
    await expect(
      day(page, "Sunday, November 15").getByRole("listitem", {
        name: "Task: Take out the recycling, All day",
      }),
    ).toBeAttached();
  });

  test("scrolling reads further days both ways and keeps the list still; the top bar follows", async ({
    page,
  }) => {
    await openDemo(page, "agenda");
    await expect(header(page, "Wednesday, November 4")).toBeInViewport();
    // Read at first: four weeks back, eight ahead. January comes as the end nears.
    await expect(day(page, "Monday, January 4")).toHaveCount(0);
    await page.mouse.move(200, 500);
    await page.mouse.wheel(0, 100_000);
    await expect(day(page, "Monday, January 4")).toBeAttached();
    await expect(page.getByRole("main", { name: "December" })).toBeVisible();

    // Back to today, then to the start: the weeks before are read, and the
    // day that was on top stays where it was.
    await page.keyboard.press("t");
    await expect(header(page, "Wednesday, November 4")).toBeInViewport();
    await expect(page.getByRole("main", { name: "November" })).toBeVisible();
    await expect(day(page, "Sunday, September 20")).toHaveCount(0);
    await page.mouse.wheel(0, -100_000);
    await expect(
      day(page, "Sunday, September 20").getByRole("listitem", { name: /^Photo exhibition, / }),
    ).toBeAttached();
    await expect(header(page, "Wednesday, October 21")).toBeInViewport();
    // Read above the day on top: the list did not jump to its new start.
    await expect(page.getByRole("button", { name: "Show earlier" })).not.toBeInViewport();
  });

  test("next and previous go to a month's first days; the button at the top reads earlier", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await openDemo(page, "agenda");
    await page.getByRole("button", { name: "Next month" }).click();
    await expect(page.getByRole("main", { name: "December" })).toBeVisible();
    await expect(header(page, "Tuesday, December 1")).toBeInViewport();
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(page.getByRole("main", { name: "November" })).toBeVisible();
    // November 1 has nothing left on it (its task rolled over to today): the next day with something.
    await expect(header(page, "Monday, November 2")).toBeInViewport();
    await page.getByRole("button", { name: "Show earlier" }).click();
    await expect(day(page, "Sunday, September 20")).toBeAttached();
    await expect(header(page, "Wednesday, October 21")).toBeInViewport();
    // Read above the day on top: the list did not jump to its new start.
    await expect(page.getByRole("button", { name: "Show earlier" })).not.toBeInViewport();
  });
});

test("the drawer and the keys switch to every view (D88)", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(header(page, "Wednesday, November 4")).toBeInViewport();
  await page.keyboard.press("m");
  await expect(dayButton(page, "Wednesday, November 4")).toBeVisible();
  await page.keyboard.press("d");
  await expect(header(page, "Thursday, November 5")).toHaveCount(0);
  await expect(header(page, "Wednesday, November 4")).toBeVisible();
  await page.keyboard.press("x");
  await expect(header(page, "Friday, November 6")).toBeVisible();
  await page.keyboard.press("w");
  await expect(header(page, "Sunday, November 1")).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.getByRole("button", { name: "Agenda", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  ); // The same key on a Russian layout types ь, and still means Month.
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ь", code: "KeyM" })),
  );
  await expect(dayButton(page, "Wednesday, November 4")).toBeVisible();
  // On Dvorak the key in QWERTY's d place types e: the letter wins, not the place.
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", code: "KeyE" })),
  );
  await expect(header(page, "Thursday, November 5")).toHaveCount(0);
});

test.describe("in Russian", () => {
  test.use({ locale: "ru-RU", viewport: PHONE });

  test("the month from Monday, its +N in Russian plurals; the Agenda's days (D17, D45)", async ({
    page,
  }) => {
    await openDemo(page, "month");
    await expect(page.getByRole("main", { name: "Ноябрь" })).toBeVisible();
    await expect(dayButton(page, "понедельник, 26 октября")).toBeVisible();
    await expect(dayButton(page, "воскресенье, 6 декабря")).toBeVisible();
    await expect(
      day(page, "среда, 4 ноября").getByRole("button", { name: "Ещё 6 записей, среда, 4 ноября" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Главное меню" }).click();
    await page.getByRole("button", { name: "Расписание" }).click();
    await expect(header(page, "среда, 4 ноября")).toBeInViewport();
    await expect(
      day(page, "четверг, 5 ноября").getByRole("listitem", {
        name: "Конференция разработчиков, День 1 из 3",
      }),
    ).toBeVisible();
    await expect(
      day(page, "среда, 4 ноября").getByRole("button", { name: "3 невыполненные задачи" }),
    ).toBeVisible();
  });
});
