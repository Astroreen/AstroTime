// A phone drawn edge to edge (docs/plans/android.md#D68): the shell injects
// the system bars' room as `--safe-area-inset-*` (Capacitor's SystemBars, on
// a WebView of Chromium 140 or newer), and the UI keeps clear of it.
import { expect, test, type Locator, type Page } from "@playwright/test";

import { addAccount, openDemo, PHONE } from "./support.ts";

const STATUS_BAR = 24;
const NAVIGATION_BAR = 48;

/** As SystemBars does once the page has loaded: the insets in CSS pixels, on the root element. */
async function systemBars(
  page: Page,
  { top = STATUS_BAR, right = 0, bottom = NAVIGATION_BAR } = {},
) {
  await page.evaluate(
    (insets) => {
      const root = document.documentElement.style;
      for (const [side, size] of Object.entries(insets)) {
        root.setProperty(`--safe-area-inset-${side}`, `${size}px`);
      }
    },
    { top, right, bottom },
  );
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not drawn");
  return { top: found.y, bottom: found.y + found.height, right: found.x + found.width };
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
  // Settings, a screen of its own on a phone (design D131), clear of both bars.
  await drawer.getByRole("button", { name: "Settings" }).click();
  await expect(drawer).toBeHidden();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await clear(settings.getByRole("button", { name: "Close settings" }));
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  const tasks = page.getByRole("region", { name: "Tasks" });
  await clear(tasks.getByRole("button", { name: "Back to the calendar" }));
  await clear(tasks.getByRole("button", { name: "Create" }));
});

// The owner's 1 and 2 (round 5): the dialogs' bars were under the status bar (design D235).
test("the details and the edit dialog clear the system bars on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "week");
  await systemBars(page);
  const clear = async (locator: Locator) => {
    const { top, bottom } = await box(locator);
    expect(top).toBeGreaterThanOrEqual(STATUS_BAR);
    expect(bottom).toBeLessThanOrEqual(PHONE.height - NAVIGATION_BAR);
  };

  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Design review, / })
    .click();
  const details = page.getByRole("dialog", { name: "Design review" });
  await clear(details.getByRole("button", { name: "Close", exact: true }));
  await clear(details.getByRole("button", { name: "Edit" }));

  await details.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  await clear(edit.getByRole("button", { name: "Close without saving" }));
  await clear(edit.getByRole("button", { name: "Save" }));
  // The form scrolls above the gesture bar, not under it.
  await clear(edit.locator("form"));
});

test("on a phone turned sideways a card and a centred dialog stay in the room the bars leave", async ({
  page,
}) => {
  const LANDSCAPE = { width: PHONE.height, height: PHONE.width };
  // The navigation bar at the side, as three-button navigation puts it.
  const insets = { top: STATUS_BAR, right: NAVIGATION_BAR, bottom: 0 };
  await page.setViewportSize(LANDSCAPE);
  await openDemo(page, "week");
  await systemBars(page, insets);
  const inRoom = async (locator: Locator) => {
    const { top, bottom, right } = await box(locator);
    expect(top).toBeGreaterThanOrEqual(insets.top);
    expect(bottom).toBeLessThanOrEqual(LANDSCAPE.height);
    expect(right).toBeLessThanOrEqual(LANDSCAPE.width - insets.right);
  };

  await page.getByRole("button", { name: "Create" }).click();
  const edit = page.getByRole("dialog", { name: "New event" });
  await inRoom(edit);
  await page.keyboard.press("Escape");
  await expect(edit).toBeHidden();

  const signIn = await addAccount(page);
  await inRoom(signIn);
});

test("without insets (a browser, a desktop) nothing moves", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "week");
  const bar = await box(page.getByRole("button", { name: "Main menu" }));
  // The top bar is 56px high, its button 40px, centred.
  expect(bar.top).toBe(8);
});
