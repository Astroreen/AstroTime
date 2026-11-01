// A phone drawn edge to edge (docs/plans/android.md#D68): the shell injects
// the system bars' room as `--safe-area-inset-*` (Capacitor's SystemBars, on
// a WebView of Chromium 140 or newer), and the UI keeps clear of it.
import { expect, test, type Locator, type Page } from "@playwright/test";

import { openDemo, PHONE } from "./support.ts";

const STATUS_BAR = 24;
const NAVIGATION_BAR = 48;

/** As SystemBars does once the page has loaded: the insets in CSS pixels, on the root element. */
async function systemBars(page: Page) {
  await page.evaluate(
    ([top, bottom]) => {
      const root = document.documentElement.style;
      root.setProperty("--safe-area-inset-top", `${top}px`);
      root.setProperty("--safe-area-inset-bottom", `${bottom}px`);
    },
    [STATUS_BAR, NAVIGATION_BAR],
  );
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not drawn");
  return { top: found.y, bottom: found.y + found.height };
}

test("the top bar, the drawer, the tasks screen and the floating buttons clear the system bars", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "week");
  await systemBars(page);
  const clear = async (locator: Locator) => {
    const { top, bottom } = await box(locator);
    expect(top).toBeGreaterThanOrEqual(STATUS_BAR);
    expect(bottom).toBeLessThanOrEqual(PHONE.height - NAVIGATION_BAR);
  };

  const menu = page.getByRole("button", { name: "Main menu" });
  await clear(menu);
  await clear(page.getByRole("button", { name: "Create" }));

  await menu.click();
  const drawer = page.getByRole("dialog", { name: "Main menu" });
  await clear(drawer.getByText("AstroTime", { exact: true }));
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  const tasks = page.getByRole("region", { name: "Tasks" });
  await clear(tasks.getByRole("button", { name: "Back to the calendar" }));
  await clear(tasks.getByRole("button", { name: "Create" }));
});

test("without insets (a browser, a desktop) nothing moves", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "week");
  const bar = await box(page.getByRole("button", { name: "Main menu" }));
  // The top bar is 56px high, its button 40px, centred.
  expect(bar.top).toBe(8);
});
