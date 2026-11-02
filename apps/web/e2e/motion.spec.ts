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
