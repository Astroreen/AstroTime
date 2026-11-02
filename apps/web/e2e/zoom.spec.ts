// Pinching the time grid (design D192): Ctrl and a wheel (what a trackpad's
// pinch sends), two fingers, and the keys change the hour's height to any
// value from 24 to 240 px, the time under the pointer kept where it is; the
// height is kept on the device. Nothing here waits for time to pass: each
// step waits for what it draws.
import { expect, test, type Page } from "@playwright/test";

import { openDemo, WIDE } from "./support.ts";

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
    await expect(main(page)).toHaveAttribute("data-zoomable", "");
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
    await expect(main(page)).toHaveAttribute("data-zoomable", "");
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
    await expect(main(page)).toHaveAttribute("data-zoomable", "");
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
    await expect(main(page)).toHaveAttribute("data-zoomable", "");
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
