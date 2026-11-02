// Moving between task lists (design D199), as periods move (D154): what
// animates is read from the calls to `Element.animate`, logged as the page
// makes them, so nothing here waits for an animation to run or end.
import { expect, test, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

/** Logs the frames of every `animate` call on the list shown (the Pager's current page) and its track. */
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
          : "other";
      calls.push({ where, frames: JSON.stringify(frames) });
      return animate.call(this, frames, options);
    };
  });
  return async () =>
    (
      await page.evaluate(() =>
        (
          window as unknown as { animations: { where: string; frames: string }[] }
        ).animations.splice(0),
      )
    ).filter((call) => call.where !== "other");
}

const tasks = (page: Page) => page.getByRole("region", { name: "Tasks" });

test.describe("with a mouse", () => {
  test.use({ viewport: WIDE });

  test("a list chosen to the right slides in from the right, one to the left from the left", async ({
    page,
  }) => {
    const taken = await logAnimations(page);
    await openDemo(page, "week");
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    const panel = tasks(page);
    await expect(panel.getByRole("tab", { name: /^Personal/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await taken();
    await panel.getByRole("tab", { name: /^Tasks/ }).click();
    await expect(panel.getByRole("list", { name: "Tasks", exact: true })).toBeVisible();
    expect(await taken()).toEqual([
      {
        where: "current",
        frames: JSON.stringify([
          { transform: "translateX(40px)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ]),
      },
    ]);
    // By the keyboard too, back to the left.
    await panel.getByRole("tab", { name: /^Tasks/ }).press("ArrowLeft");
    await expect(panel.getByRole("tab", { name: /^Personal/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(panel.getByRole("tab", { name: /^Personal/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect((await taken()).map(({ frames }) => JSON.parse(frames)[0].transform)).toEqual([
      "translateX(-40px)",
    ]);
    // No list beside it is drawn without a touch screen.
    await expect(panel.locator("[data-track] > [inert]")).toHaveCount(0);
  });
});

test.describe("on a touch screen", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

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

  test("a sideways swipe carries the lists under the finger and settles on the next", async ({
    page,
  }) => {
    await openDemo(page, "day");
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    const panel = tasks(page);
    const track = panel.locator("[data-track]");
    // The list after it is drawn beside it, out of reach; there is none before the first.
    await expect(track.locator(":scope > [inert][aria-hidden=true]")).toHaveCount(1);
    const touch = await finger(page);
    await touch("touchStart", 330);
    for (let step = 1; step <= 10; step++) await touch("touchMove", 330 - step * 18);
    await expect(track).toHaveAttribute("style", /translateX\(-180px\)/);
    await touch("touchEnd");
    await expect(panel.getByRole("tab", { name: /^Tasks/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panel.getByRole("list", { name: "Tasks", exact: true })).toBeVisible();
    await expect(track).not.toHaveAttribute("style", /translateX/);
    // Now with a list on either side.
    await expect(track.locator(":scope > [inert][aria-hidden=true]")).toHaveCount(1);
  });

  test("a vertical scroll of a list moves to no other list", async ({ page }) => {
    await openDemo(page, "day");
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    const panel = tasks(page);
    const touch = await finger(page);
    await touch("touchStart", 200, 700);
    for (let step = 1; step <= 8; step++) await touch("touchMove", 200 + step * 4, 700 - step * 40);
    await touch("touchEnd");
    await expect(panel.locator("[data-track]")).not.toHaveAttribute("style", /translateX/);
    await expect(panel.getByRole("tab", { name: /^Personal/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

test("asked for less motion, a list chosen is shown at once", async ({ page }) => {
  const taken = await logAnimations(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  const panel = tasks(page);
  await panel.getByRole("tab", { name: /^Tasks/ }).click();
  await expect(panel.getByRole("list", { name: "Tasks", exact: true })).toBeVisible();
  expect(await taken()).toEqual([]);
});
