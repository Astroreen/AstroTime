// Moving from one period to the next (design D154): what animates is read
// from the calls to `Element.animate`, logged as the page makes them, so
// nothing here waits for an animation to run or end.
import { expect, test, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

const header = (page: Page, name: string) => page.getByRole("heading", { name });

/** Logs every `animate` call: where (the period shown, the track, the Agenda's list) and its keyframes. */
async function logAnimations(page: Page) {
  await page.addInitScript(() => {
    const calls: { where: string; frames: string }[] = [];
    Object.assign(window, { animations: calls });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      const where = this.hasAttribute("data-current")
        ? "current"
        : this.hasAttribute("data-track")
          ? "track"
          : this.closest("[data-agenda]")
            ? "agenda"
            : "other";
      calls.push({ where, frames: JSON.stringify(frames) });
      return animate.call(this, frames, options);
    };
  });
  /** The calls since the last look. */
  return () =>
    page.evaluate(() =>
      (window as unknown as { animations: { where: string; frames: string }[] }).animations.splice(
        0,
      ),
    );
}

test.describe("on a wide screen", () => {
  test.use({ viewport: WIDE });

  test("next slides the new week in from the right, previous from the left, a new view fades in", async ({
    page,
  }) => {
    const taken = await logAnimations(page);
    await openDemo(page, "week");
    await expect(header(page, "Wednesday, November 4")).toBeVisible();
    // Opened: nothing moved.
    expect(await taken()).toEqual([]);
    await page.getByRole("button", { name: "Next week" }).click();
    await expect(header(page, "Wednesday, November 11")).toBeVisible();
    expect(await taken()).toEqual([
      {
        where: "current",
        frames: JSON.stringify([
          { transform: "translateX(40px)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ]),
      },
    ]);
    await page.locator("body").press("p");
    await expect(header(page, "Wednesday, November 4")).toBeVisible();
    expect((await taken()).map(({ frames }) => JSON.parse(frames)[0].transform)).toEqual([
      "translateX(-40px)",
    ]);
    await page.locator("body").press("m");
    await expect(page.locator('[data-view="month"]')).toBeVisible();
    expect(await taken()).toEqual([
      { where: "current", frames: JSON.stringify([{ opacity: 0 }, { opacity: 1 }]) },
    ]);
  });

  test("the Agenda slides a picked day in from the side of time it lies on", async ({ page }) => {
    const taken = await logAnimations(page);
    await openDemo(page, "agenda");
    await expect(page.getByRole("list", { name: "Wednesday, November 4" })).toBeVisible();
    expect(await taken()).toEqual([]);
    await page.getByRole("button", { name: "November, choose a date" }).click();
    await page.getByRole("button", { name: "Monday, November 23" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const later = await taken();
    expect(
      later
        .filter(({ where }) => where === "agenda")
        .map(({ frames }) => JSON.parse(frames)[0].transform),
    ).toEqual(["translateY(24px)"]);
    // Back to an earlier day: from above.
    await page.getByRole("button", { name: "November, choose a date" }).click();
    await page.getByRole("button", { name: "Monday, November 2", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const earlier = await taken();
    expect(
      earlier
        .filter(({ where }) => where === "agenda")
        .map(({ frames }) => JSON.parse(frames)[0].transform),
    ).toEqual(["translateY(-24px)"]);
    // Scrolled on, the same day picked again slides in again.
    await page.locator("[data-agenda]").evaluate((list) => {
      const scroller = list.parentElement!;
      scroller.scrollTop += 2000;
      scroller.dispatchEvent(new Event("scroll"));
    });
    await expect(page.getByRole("main", { name: /December|November/ })).toBeVisible();
    await page.getByRole("button", { name: /, choose a date$/ }).click();
    await page.getByRole("button", { name: "Monday, November 2", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      (await taken())
        .filter(({ where }) => where === "agenda")
        .map(({ frames }) => JSON.parse(frames)[0].transform),
    ).toEqual(["translateY(-24px)"]);
  });

  test.describe("with reduced motion", () => {
    test("periods and views swap at once", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const taken = await logAnimations(page);
      await openDemo(page, "week");
      await expect(header(page, "Wednesday, November 4")).toBeVisible();
      await page.getByRole("button", { name: "Next week" }).click();
      await expect(header(page, "Wednesday, November 11")).toBeVisible();
      await page.locator("body").press("m");
      await expect(page.locator('[data-view="month"]')).toBeVisible();
      expect((await taken()).filter(({ where }) => where !== "other")).toEqual([]);
    });
  });
});

test.describe("on a touch screen", () => {
  test.use({ viewport: PHONE, hasTouch: true });

  /** A finger through Chromium's touch input, its moves 50 ms apart by their own times. */
  async function finger(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    let time = Date.now() / 1000;
    return (type: "touchStart" | "touchMove" | "touchEnd", x?: number, y = 500) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: x === undefined ? [] : [{ x, y }],
        timestamp: (time += 0.05),
      });
  }
  const track = (page: Page) => page.locator("[data-track]");

  test("the period follows the finger with the next one beside it, and settles on it", async ({
    page,
  }) => {
    const taken = await logAnimations(page);
    await openDemo(page, "3days");
    await expect(header(page, "Wednesday, November 4")).toBeVisible();
    // The days before and after are drawn beside it, hidden from a screen reader.
    await expect(track(page).locator(":scope > [inert][aria-hidden=true]")).toHaveCount(2);
    const touch = await finger(page);
    await touch("touchStart", 330);
    for (let step = 1; step <= 10; step++) await touch("touchMove", 330 - step * 18);
    // Under the finger, moved by the finger alone.
    await expect(track(page)).toHaveAttribute("style", /translateX\(-180px\)/);
    await touch("touchEnd");
    await expect(header(page, "Saturday, November 7")).toBeVisible();
    await expect(track(page)).not.toHaveAttribute("style", /translateX/);
    const settled = (await taken()).filter(({ where }) => where === "track");
    expect(settled.map(({ frames }) => JSON.parse(frames).at(-1).transform)).toEqual([
      "translateX(-412px)",
    ]);
  });

  test("a swipe let go short and slow goes back", async ({ page }) => {
    const taken = await logAnimations(page);
    await openDemo(page, "3days");
    await expect(header(page, "Wednesday, November 4")).toBeVisible();
    const touch = await finger(page);
    await touch("touchStart", 330);
    for (let step = 1; step <= 5; step++) await touch("touchMove", 330 - step * 10);
    for (let step = 0; step < 4; step++) await touch("touchMove", 280);
    await touch("touchEnd");
    const back = (await taken()).filter(({ where }) => where === "track");
    expect(back.map(({ frames }) => JSON.parse(frames).at(-1).transform)).toEqual([
      "translateX(0px)",
    ]);
    await expect(track(page)).not.toHaveAttribute("style", /translateX/);
    await expect(header(page, "Wednesday, November 4")).toBeVisible();
  });

  test("a vertical scroll of the grid moves no period", async ({ page }) => {
    await openDemo(page, "3days");
    await expect(header(page, "Wednesday, November 4")).toBeVisible();
    const touch = await finger(page);
    await touch("touchStart", 200, 700);
    for (let step = 1; step <= 8; step++) await touch("touchMove", 200 + step * 4, 700 - step * 40);
    await touch("touchEnd");
    await expect(track(page)).not.toHaveAttribute("style", /translateX/);
    await expect(header(page, "Wednesday, November 4")).toBeVisible();
  });
});

test.describe("an item saved, the strip opened (design D193)", () => {
  test.use({ viewport: WIDE });

  test("the item the dialog saved lands where it goes; only it, once", async ({ page }) => {
    await openDemo(page, "week");
    // The landing held where it starts, so its mark is read before it ends.
    await page.addStyleTag({
      content: "[data-landed] { animation-play-state: paused !important; }",
    });
    await page.getByRole("button", { name: "Create" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByRole("textbox", { name: "Title" }).fill("Call the plumber");
    await dialog.getByRole("button", { name: "Save" }).click();
    const saved = page
      .getByRole("list", { name: "Wednesday, November 4" })
      .getByRole("listitem", { name: /^Call the plumber, / });
    await expect(saved).toHaveAttribute("data-landed", "true");
    await expect(saved).toHaveCSS("animation-name", "item-land");
    await expect(page.locator("main [data-landed]")).toHaveCount(1);
    // Let go, it runs and ends: then it is a plain item, and a week away
    // and back draws it again without landing again.
    await page.addStyleTag({
      content: "[data-landed] { animation-play-state: running !important; }",
    });
    await expect(saved).not.toHaveAttribute("data-landed");
    await page.getByRole("button", { name: "Next week" }).click();
    await expect(header(page, "Sunday, November 8")).toBeVisible();
    await page.getByRole("button", { name: "Previous week" }).click();
    await expect(saved).toBeVisible();
    await expect(page.locator("main [data-landed]")).toHaveCount(0);
  });

  test("a new series lands where its form put it, not on each of its days", async ({ page }) => {
    // A landing that lasts, so its mark is there to read.
    await page.addInitScript(() =>
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "[data-landed] { animation-duration: 600s !important; }";
        document.head.append(style);
      }),
    );
    await openDemo(page, "month");
    await expect(page.locator('[data-view="month"]')).toBeVisible();
    await page.getByRole("button", { name: "Create" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByRole("textbox", { name: "Title" }).fill("Swimming");
    await dialog.getByLabel("Start date").fill("2026-11-10");
    await dialog.getByRole("combobox", { name: "Repeat" }).click();
    await page
      .getByRole("option", { name: /^Every week/ })
      .first()
      .click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    const swims = page.locator('main [role=listitem][aria-label^="Swimming"]');
    // Every Tuesday the month shows, from the 10th on.
    await expect(swims).toHaveCount(5);
    await expect(page.locator("main [data-landed]")).toHaveCount(1);
    await expect(
      page.getByRole("list", { name: "Tuesday, November 10" }).locator("[data-landed]"),
    ).toHaveCount(1);
  });

  test("opening the strip fades its new rows in; on the next period, opened already, they are just there", async ({
    page,
  }) => {
    await openDemo(page, "week");
    const strip = page.getByRole("list", { name: "All day" });
    await page.getByRole("button", { name: "Show all all-day items" }).click();
    const rent = strip.getByRole("listitem", { name: "Completed task: Pay the rent, All day" });
    await expect(rent.locator("xpath=..")).toHaveCSS("animation-name", "row-in");
    // The first rows were there: they do not move.
    const birthday = strip.getByRole("listitem", { name: "Mom's birthday, All day" });
    await expect(birthday.locator("xpath=..")).toHaveCSS("animation-name", "none");
    await page.getByRole("button", { name: "Next week" }).click();
    await expect(header(page, "Sunday, November 8")).toBeVisible();
    await expect(strip.locator(".animate-row-in")).toHaveCount(0);
    // Back on the week it was opened on: its rows are just there too.
    await page.getByRole("button", { name: "Previous week" }).click();
    await expect(rent).toBeVisible();
    await expect(strip.locator(".animate-row-in")).toHaveCount(0);
  });

  test("an item saved on a period not drawn lands nowhere later", async ({ page }) => {
    await openDemo(page, "week");
    await page.addStyleTag({
      content: "[data-landed] { animation-play-state: paused !important; }",
    });
    await page.getByRole("button", { name: "Create" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByRole("textbox", { name: "Title" }).fill("Renew the lease");
    await dialog.getByLabel("Start date").fill("2026-11-18");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    // Two weeks on, it is drawn plainly: the step to another period dropped it.
    await page.getByRole("button", { name: "Next week" }).click();
    await page.getByRole("button", { name: "Next week" }).click();
    const lease = page
      .getByRole("list", { name: "Wednesday, November 18" })
      .getByRole("listitem", { name: /^Renew the lease, / });
    await expect(lease).toBeVisible();
    await expect(lease).not.toHaveAttribute("data-landed");
  });
});
