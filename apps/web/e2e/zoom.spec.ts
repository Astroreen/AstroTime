// Pinching the time grid (design D192): Ctrl and a wheel (what a trackpad's
// pinch sends), two fingers, and the keys change the hour's height to any
// value from 24 to 240 px, the time under the pointer kept where it is; the
// height is kept on the device. Nothing here waits for time to pass: each
// step waits for what it draws.
import { expect, test, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE, expand } from "./support.ts";

const grid = (page: Page) => page.locator("main [data-current] [data-scroller]");
const standUp = (page: Page) =>
  page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("listitem", { name: /^Stand-up, 9:00/ });
const lunch = (page: Page) =>
  page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("listitem", { name: "Lunch with Marta, 1:00 – 2:00 PM" });
const main = (page: Page) => page.locator("main");
/**
 * Ready to zoom: the pinch's code loaded (`data-zoomable`), which may be
 * before the period is drawn, and the grid it zooms drawn.
 */
async function zoomable(page: Page) {
  await expect(main(page)).toHaveAttribute("data-zoomable", "");
  await expect(grid(page)).toBeVisible();
}

test.describe("on a wide screen", () => {
  test.use({ viewport: WIDE });

  test("Ctrl and a wheel zoom the grid about the pointer, and the height is kept", async ({
    page,
  }) => {
    // 3 days: its columns are wide enough for a block's time line.
    await openDemo(page, "3days");
    await expect(standUp(page)).toBeVisible();
    // A 30-minute block at 56 px an hour has no room for its time line.
    await expect(standUp(page).getByText("9:00 – 9:30 AM")).toHaveCount(0);
    // The pinch's code, loaded once the view is drawn.
    await zoomable(page);
    const before = (await lunch(page).boundingBox())!;
    // On 1:00 PM itself, the line Lunch's top is drawn a pixel under.
    await page.mouse.move(before.x + 10, before.y - 1);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    // Larger: e^(100 / 200) times, 92.3 px once kept; then the blocks'
    // text is fitted again, and the stand-up has room for its time line.
    await expect(main(page)).toHaveCSS("--hour", "92.3px");
    await expect(standUp(page).getByText("9:00 – 9:30 AM")).toBeVisible();
    // Lunch's top stays under the pointer, to the scroll's whole pixel.
    const after = (await lunch(page).boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThan(1.5);
    // Kept on this device.
    await page.reload();
    await expect(main(page)).toHaveCSS("--hour", "92.3px");
    await expect(standUp(page).getByText("9:00 – 9:30 AM")).toBeVisible();
  });

  test("the keys step it, never past 240 px, and 0 brings the usual height back", async ({
    page,
  }) => {
    await openDemo(page, "week");
    await zoomable(page);
    await page.keyboard.press("+");
    await expect(main(page)).toHaveCSS("--hour", "70px");
    for (let step = 0; step < 12; step++) await page.keyboard.press("+");
    await expect(main(page)).toHaveCSS("--hour", "240px");
    await page.keyboard.press("0");
    await expect(main(page)).toHaveCSS("--hour", "56px");
    for (let step = 0; step < 12; step++) await page.keyboard.press("-");
    await expect(main(page)).toHaveCSS("--hour", "24px");
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("two fingers spread zoom the grid, keep the time between them, and swipe nothing", async ({
    page,
  }) => {
    await openDemo(page, "3days");
    await zoomable(page);
    const box = (await grid(page).boundingBox())!;
    const x = box.x + box.width / 2;
    const middle = box.y + box.height / 2;
    // The time between the fingers, in hours from midnight, before.
    const hoursAt = () =>
      grid(page).evaluate(
        (element, y) =>
          (element.scrollTop + y - element.getBoundingClientRect().top) /
          Number.parseFloat(getComputedStyle(element).getPropertyValue("--hour")),
        middle,
      );
    const before = await hoursAt();
    const cdp = await page.context().newCDPSession(page);
    // Side by side, so the first finger goes sideways fast: the way a
    // swipe to the next days starts (design D152), which a pinch is not.
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", spread: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd"
            ? []
            : [
                { x: x - spread / 2, y: middle, id: 0 },
                { x: x + spread / 2, y: middle, id: 1 },
              ],
      });
    await touch("touchStart", 100);
    for (const spread of [125, 150, 175, 200]) await touch("touchMove", spread);
    await touch("touchEnd", 200);
    // Twice as far apart: twice the height, kept once the fingers go.
    await expect(main(page)).toHaveCSS("--hour", "112px");
    expect(Math.abs((await hoursAt()) - before)).toBeLessThan(0.02);
    await expect(page.getByRole("heading", { name: "Wednesday, November 4" })).toBeVisible();
  });

  test("two fingers closing shrink it, never under 24 px; the Day view's grid follows", async ({
    page,
  }) => {
    await openDemo(page, "day");
    await zoomable(page);
    const box = (await grid(page).boundingBox())!;
    const x = box.x + box.width / 2;
    const middle = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", spread: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd"
            ? []
            : [
                { x, y: middle - spread / 2, id: 0 },
                { x, y: middle + spread / 2, id: 1 },
              ],
      });
    await touch("touchStart", 300);
    for (const spread of [250, 200, 150, 100, 60, 30]) await touch("touchMove", spread);
    await touch("touchEnd", 30);
    // A tenth as far apart would be 5.6 px: held at 24, the whole day 576 px tall.
    await expect(main(page)).toHaveCSS("--hour", "24px");
    const day = (await page.getByRole("list", { name: "Wednesday, November 4" }).boundingBox())!;
    expect(Math.round(day.height)).toBe(24 * 24);
  });
});

test.describe("a pinch begun sideways (design D192)", () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test("a first finger that moves sideways, then a second, pinch: no swipe to other days", async ({
    page,
  }) => {
    await openDemo(page, "3days");
    await zoomable(page);
    const box = (await grid(page).boundingBox())!;
    const y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    // Chromium's touch input, its moves 50 ms apart by their own times.
    let time = Date.now() / 1000;
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd",
      points: { x: number; y: number }[],
    ) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((point, id) => ({ ...point, id })),
        timestamp: (time += 0.05),
      });
    // The first finger alone, sideways: a swipe to the next days begins.
    await touch("touchStart", [{ x: 330, y }]);
    for (let step = 1; step <= 6; step++) await touch("touchMove", [{ x: 330 - step * 18, y }]);
    await expect(page.locator("[data-track]")).toHaveAttribute("style", /translateX/);
    // A second finger lands, and the two spread apart.
    for (const spread of [40, 80, 120, 160, 200]) {
      await touch(spread === 40 ? "touchStart" : "touchMove", [
        { x: 222, y: y - spread / 2 },
        { x: 222, y: y + spread / 2 },
      ]);
    }
    await touch("touchEnd", []);
    // Zoomed, on the same days, the swipe gone back.
    await expect(main(page)).not.toHaveCSS("--hour", "56px");
    await expect(page.getByRole("heading", { name: "Wednesday, November 4" })).toBeVisible();
    await expect(page.locator("[data-track]")).not.toHaveAttribute("style", /translateX/);
    await expect(page.getByRole("heading", { name: "Saturday, November 7" })).toHaveCount(0);
  });
});

test.describe("what is no zoom, and what ends one (design D192)", () => {
  test.use({ viewport: WIDE });

  test("keys a dialog has, and Ctrl and +, zoom nothing; wheels one after another compound", async ({
    page,
  }) => {
    await openDemo(page, "3days");
    await zoomable(page);
    await page.getByRole("button", { name: "Create" }).click();
    await expand(page);
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByRole("textbox", { name: "Title" }).press("+");
    await dialog.getByRole("radio", { name: "Task" }).press("-");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // Ctrl and + is the browser's page zoom (WCAG 1.4.4), not the grid's.
    await page.keyboard.press("Control+=");
    await expect(main(page)).toHaveCSS("--hour", "56px");
    // Three turns of a wheel with Ctrl: e^0.2 each, kept to a tenth each time.
    const box = (await grid(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    for (let turn = 0; turn < 3; turn++) await page.mouse.wheel(0, -40);
    await page.keyboard.up("Control");
    await expect(main(page)).toHaveCSS("--hour", "102px");
  });
});

/** Two or more fingers on the grid as `TouchEvent`s, cancelable or not, as the browser sends them. */
async function fingers(
  page: Page,
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  points: readonly { x: number; y: number }[],
  cancelable = true,
) {
  await grid(page).evaluate(
    (element, sent) => {
      const touches = sent.points.map(
        ({ x, y }, identifier) =>
          new Touch({ identifier, target: element, clientX: x, clientY: y }),
      );
      element.dispatchEvent(
        new TouchEvent(sent.type, {
          touches,
          targetTouches: touches,
          bubbles: true,
          cancelable: sent.cancelable,
        }),
      );
    },
    { type, points, cancelable },
  );
}

test.describe("fingers on a phone (design D192)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  async function setUp(page: Page) {
    await openDemo(page, "3days");
    await zoomable(page);
    const box = (await grid(page).boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    return (spread: number, third = false) => [
      { x, y: y - spread / 2 },
      { x, y: y + spread / 2 },
      ...(third ? [{ x: x + 60, y }] : []),
    ];
  }

  test("a second finger on a grid the browser is already scrolling is no pinch", async ({
    page,
  }) => {
    const apart = await setUp(page);
    await fingers(page, "touchstart", apart(100));
    // The browser has made the touch its scroll: its moves cannot be cancelled.
    await fingers(page, "touchmove", apart(200), false);
    await fingers(page, "touchend", []);
    await expect(main(page)).toHaveCSS("--hour", "56px");
  });

  test("a pinch the browser cancels keeps the height it reached", async ({ page }) => {
    const apart = await setUp(page);
    await fingers(page, "touchstart", apart(100));
    await fingers(page, "touchmove", apart(200));
    await fingers(page, "touchcancel", []);
    await expect(main(page)).toHaveCSS("--hour", "112px");
    await page.reload();
    await expect(main(page)).toHaveCSS("--hour", "112px");
  });

  test("a third finger ends the pinch; the two left begin anew from there", async ({ page }) => {
    const apart = await setUp(page);
    await fingers(page, "touchstart", apart(100));
    await fingers(page, "touchmove", apart(150));
    // 84 px, then a third finger: the pinch ends at 84.
    await fingers(page, "touchstart", apart(150, true));
    await expect(main(page)).toHaveCSS("--hour", "84px");
    // It lifts; the two left, now 300 apart, are the new start: twice that is twice 84.
    await fingers(page, "touchend", apart(300));
    await fingers(page, "touchmove", apart(600));
    await fingers(page, "touchend", []);
    await expect(main(page)).toHaveCSS("--hour", "168px");
  });
});
