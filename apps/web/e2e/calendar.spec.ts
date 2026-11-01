// The calendar views on the demo data, with the clock frozen on Wednesday,
// November 4, 2026, 10:40 in Vilnius (docs/plans/foundation.md#pr-5--calendar-grid).
import { expect, test, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

const day = (page: Page, name: string) => page.getByRole("list", { name });
const strip = (page: Page) => page.getByRole("list", { name: "All day" });
const header = (page: Page, name: string) => page.getByRole("heading", { name });

test.describe("each view draws the demo data", () => {
  test.use({ viewport: PHONE });

  test("Week: the locale's week, its all-day spans, timed items and task chips", async ({
    page,
  }) => {
    await openDemo(page, "week");
    // An en-US week starts on Sunday (design D45).
    await expect(header(page, "Sunday, November 1")).toBeVisible();
    await expect(header(page, "Saturday, November 7")).toBeVisible();
    await expect(header(page, "Wednesday, November 4")).toHaveAttribute("aria-current", "date");
    await expect(page.getByText("Week 45")).toBeAttached();
    await expect(
      day(page, "Wednesday, November 4").getByRole("listitem", { name: /^Design review, / }),
    ).toBeVisible();
    await expect(
      strip(page).getByRole("listitem", { name: "Developer conference, All day" }),
    ).toBeVisible();
    // A task with only a due time is a chip at the due; a completed one stays, struck through (D51).
    await expect(
      day(page, "Wednesday, November 4").getByRole("listitem", {
        name: "Task: Send the report, 3:00 PM",
      }),
    ).toBeVisible();
    await expect(
      day(page, "Tuesday, November 3").getByRole("listitem", {
        name: "Completed task: Book the tickets, 2:00 PM",
      }),
    ).toBeVisible();
    // The recurring stand-up, every weekday.
    for (const weekday of ["Monday, November 2", "Friday, November 6"]) {
      await expect(day(page, weekday).getByRole("listitem", { name: /^Stand-up, / })).toBeVisible();
    }
    await expect(
      day(page, "Saturday, November 7").getByRole("listitem", { name: /^Stand-up, / }),
    ).toHaveCount(0);
  });

  test("3 days: today and the two after it, a start–due task as a block", async ({ page }) => {
    await openDemo(page, "3days");
    await expect(header(page, "Wednesday, November 4")).toBeVisible();
    await expect(header(page, "Friday, November 6")).toBeVisible();
    await expect(header(page, "Tuesday, November 3")).toHaveCount(0);
    await expect(
      day(page, "Thursday, November 5").getByRole("listitem", {
        name: "Task: Write the proposal, 10:00 AM – 12:00 PM",
      }),
    ).toBeVisible();
    await expect(
      strip(page).getByRole("listitem", { name: "Developer conference, All day" }),
    ).toBeVisible();
  });

  test("Day: overlapping items cascade, and the current time is marked", async ({ page }) => {
    await openDemo(page, "day");
    const today = day(page, "Wednesday, November 4");
    const review = await today.getByRole("listitem", { name: /^Design review, / }).boundingBox();
    const budget = await today.getByRole("listitem", { name: /^Budget planning, / }).boundingBox();
    const call = await today.getByRole("listitem", { name: /^Call with Anna, / }).boundingBox();
    // Each later item over an earlier one is shifted right (D15).
    expect(budget!.x).toBeGreaterThan(review!.x);
    expect(call!.x).toBeGreaterThan(budget!.x);
    await expect(today.locator("[data-now]")).toBeVisible();
  });
});

test("previous, next and today move by the view's period, by button and by key", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await expect(page.getByRole("main", { name: "November" })).toBeVisible();
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(header(page, "Sunday, November 8")).toBeVisible();
  await page.getByRole("button", { name: "Previous week" }).click();
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect(header(page, "Sunday, October 25")).toBeVisible();
  await expect(page.getByRole("main", { name: "October" })).toBeVisible();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(header(page, "Sunday, November 1")).toBeVisible();

  await page.keyboard.press("n");
  await expect(header(page, "Sunday, November 8")).toBeVisible();
  await page.keyboard.press("t");
  await expect(header(page, "Sunday, November 1")).toBeVisible();

  await page.getByRole("button", { name: "Day", exact: true }).click();
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(header(page, "Thursday, November 5")).toBeVisible();
});

test("a swipe on a touch screen moves to the next period", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "3days");
  const grid = day(page, "Thursday, November 5");
  const touch = { pointerType: "touch", isPrimary: true, clientY: 500 };
  await grid.dispatchEvent("pointerdown", { ...touch, clientX: 300 });
  await grid.dispatchEvent("pointerup", { ...touch, clientX: 120 });
  await expect(header(page, "Saturday, November 7")).toBeVisible();
});

test("the time grid is drawn where it stays: the strip's items do not push it down as they arrive", async ({
  page,
}) => {
  // Every state of the page that can be painted, as the time grid is in it:
  // a mutation observer runs after each change, before the paint. Each
  // state says the grid's top and its first day, or that there is no grid.
  await page.addInitScript(() => {
    const states: { top: number; first: string }[] = [];
    Object.assign(window, { gridStates: states });
    new MutationObserver(() => {
      const column = document.querySelector('main [role="list"]:not([aria-label="All day"])');
      let element = column;
      while (element && getComputedStyle(element).overflowY !== "auto") {
        element = element.parentElement;
      }
      states.push(
        element
          ? { top: element.getBoundingClientRect().top, first: column!.getAttribute("aria-label")! }
          : { top: NaN, first: "" },
      );
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  let seen = 0;
  /** The grid's states since the last look. */
  const states = async () => {
    const all = await page.evaluate(
      () => (window as unknown as { gridStates: { top: number; first: string }[] }).gridStates,
    );
    const since = all.slice(seen);
    seen = all.length;
    return since;
  };

  // On open: no grid until the week is read, then the grid where it stays.
  await openDemo(page, "week");
  await expect(
    strip(page).getByRole("listitem", { name: "Developer conference, All day" }),
  ).toBeVisible();
  await expect(
    day(page, "Wednesday, November 4").getByRole("listitem", { name: /^Design review, / }),
  ).toBeVisible();
  const opened = (await states()).filter(({ first }) => first !== "");
  const top = opened.at(-1)!.top;
  expect(opened.length).toBeGreaterThan(0);
  expect(opened.filter((state) => state.top !== top)).toEqual([]);

  // To the next week and back: the week drawn stays where it was until the
  // next one is read, and the next one is drawn where it stays from its
  // first state, never with the old week's items on its days.
  await page.locator("body").press("n");
  await expect(day(page, "Wednesday, November 11").getByRole("listitem").first()).toBeVisible();
  const next = await states();
  const nextTop = next.at(-1)!.top;
  /** The states that show a week somewhere else than where it stays. */
  const astray = (list: typeof next) =>
    list.filter(
      (state) =>
        state.first === "" || state.top !== (state.first === "Sunday, November 8" ? nextTop : top),
    );
  expect(astray(next)).toEqual([]);
  await page.locator("body").press("p");
  await expect(
    strip(page).getByRole("listitem", { name: "Developer conference, All day" }),
  ).toBeVisible();
  expect(astray(await states())).toEqual([]);
});

test("the month picker jumps to the day picked", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "day");
  await page.getByRole("button", { name: "November, choose a date" }).click();
  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "Tuesday, December 15" }).click();
  await expect(header(page, "Tuesday, December 15")).toBeVisible();
  await expect(page.getByRole("main", { name: "December" })).toBeVisible();
});

test("the all-day strip folds past three rows to two and +N, and expands in place (D51)", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "day");
  await expect(
    strip(page).getByRole("listitem", { name: "Mom's birthday, All day" }),
  ).toBeVisible();
  const rent = strip(page).getByRole("listitem", { name: "Completed task: Pay the rent, All day" });
  await expect(rent).toHaveCount(0);
  await strip(page).getByRole("button", { name: "3 more on Wednesday, November 4" }).click();
  await expect(rent).toBeVisible();
  const collapse = page.getByRole("button", { name: "Show fewer all-day items" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.click();
  await expect(rent).toHaveCount(0);
});

test("undone tasks due before today leave their days for one chip on today (D51)", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  // Rolled over: no longer on the day it was due…
  await expect(
    day(page, "Monday, November 2").getByRole("listitem", { name: /Reply to Olga/ }),
  ).toHaveCount(0);
  // …while a completed task stays where it was.
  await expect(
    strip(page).getByRole("listitem", { name: "Completed task: Tidy the desk, All day" }),
  ).toBeVisible();
  await strip(page).getByRole("button", { name: "3 undone tasks" }).click();
  const undone = page.getByRole("dialog", { name: "Undone tasks" });
  for (const title of ["Renew the passport", "Reply to Olga", "Take out the recycling"]) {
    await expect(undone.getByText(title)).toBeVisible();
  }
  await page.keyboard.press("Escape");
  // Only today has the chip.
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(header(page, "Sunday, November 8")).toBeVisible();
  await expect(strip(page).getByRole("button", { name: /undone/ })).toHaveCount(0);
});

test("the theme follows the system; data-theme overrides it (D44)", async ({ page }) => {
  await openDemo(page, "week");
  const body = page.locator("body");
  await expect(body).toHaveCSS("background-color", "rgb(27, 29, 35)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(body).toHaveCSS("background-color", "rgb(238, 240, 244)");
  await page.evaluate(() => (document.documentElement.dataset["theme"] = "dark"));
  await expect(body).toHaveCSS("background-color", "rgb(27, 29, 35)");
});

test.describe("in Russian", () => {
  test.use({ locale: "ru-RU", viewport: PHONE });

  test("the UI speaks Russian, the week starts on Monday, the clock has 24 hours (D17, D45)", async ({
    page,
  }) => {
    await openDemo(page, "week");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(page.getByRole("main", { name: "Ноябрь" })).toBeVisible();
    await expect(header(page, "понедельник, 2 ноября")).toBeVisible();
    await expect(header(page, "воскресенье, 8 ноября")).toBeVisible();
    await expect(
      day(page, "среда, 4 ноября").getByRole("listitem", {
        name: "Задача: Отправить отчёт, 15:00",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Весь день" }).getByRole("button", {
        name: "3 невыполненные задачи",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Главное меню" }).click();
    await expect(page.getByRole("button", { name: "Неделя" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(page.getByRole("checkbox", { name: "Работа" })).toBeChecked();
  });
});

test("hiding a calendar in the drawer hides its items", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  const review = day(page, "Wednesday, November 4").getByRole("listitem", {
    name: /^Design review/,
  });
  await expect(review).toBeVisible();
  await page.getByRole("checkbox", { name: "Work" }).click();
  await expect(review).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Work" }).click();
  await expect(review).toBeVisible();
});

test.describe("the shell around the views (design D132, D133)", () => {
  const create = (scope: ReturnType<Page["getByRole"]>) =>
    scope.getByRole("button", { name: "Create", exact: true });

  test("on a wide screen Create heads the sidebar; with the sidebar closed it floats 24 px in", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await openDemo(page, "week");
    const sidebar = page.getByRole("navigation", { name: "Main menu" });
    const main = page.getByRole("main");
    await expect(create(sidebar)).toBeVisible();
    await expect(create(main)).toHaveCount(0);
    // It opens a new event, as the floating button does.
    await create(sidebar).click();
    await expect(page.getByRole("dialog", { name: "New event" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("banner").getByRole("button", { name: "Main menu" }).click();
    await expect(sidebar).toHaveCount(0);
    await expect(create(main)).toBeVisible();
    const fab = (await create(main).boundingBox())!;
    const area = (await main.boundingBox())!;
    expect(area.x + area.width - (fab.x + fab.width)).toBe(24);
    expect(area.y + area.height - (fab.y + fab.height)).toBe(24);
  });

  test('on a phone the floating "+" sits 16 px in', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openDemo(page, "day");
    const main = page.getByRole("main");
    const fab = (await create(main).boundingBox())!;
    const area = (await main.boundingBox())!;
    expect(area.x + area.width - (fab.x + fab.width)).toBe(16);
    expect(area.y + area.height - (fab.y + fab.height)).toBe(16);
  });

  test("the wide top bar: menu, Today, previous, next, the period, then search, Settings, tasks, the account", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await openDemo(page, "week");
    // The bar is drawn once the store is read.
    await expect(page.getByRole("banner").getByRole("button", { name: /^Accounts/ })).toBeVisible();
    const names = await page
      .getByRole("banner")
      .getByRole("button")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
    expect(names).toEqual([
      "Main menu",
      "Today, Wednesday, November 4",
      "Previous week",
      "Next week",
      "November, choose a date",
      "Search",
      "Settings",
      "Tasks",
      // With what it says about the accounts: the demo holds a conflict.
      expect.stringMatching(/^Accounts/),
    ]);
    // "Today" is a word on a wide screen, and brings the view back to today's week.
    const todayButton = page.getByRole("banner").getByRole("button", { name: /^Today/ });
    await expect(todayButton).toHaveText("Today");
    await page.getByRole("button", { name: "Next week" }).click();
    await expect(header(page, "Sunday, November 8")).toBeVisible();
    await todayButton.click();
    await expect(header(page, "Sunday, November 1")).toBeVisible();
  });
});
