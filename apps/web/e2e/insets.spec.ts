// A phone drawn edge to edge (docs/plans/android.md#D68): the shell injects
// the system bars' room as `--safe-area-inset-*` (Capacitor's SystemBars, on
// a WebView of Chromium 140 or newer), and the UI keeps clear of it.
import { expect, test, type Locator, type Page } from "@playwright/test";

import { addAccount, openDemo, PHONE } from "./support.ts";

const STATUS_BAR = 24;
const NAVIGATION_BAR = 48;

type Insets = { top: number; right: number; bottom: number; left: number };

/** As SystemBars does once the page has loaded: the insets in CSS pixels, on the root element. */
async function systemBars(
  page: Page,
  { top = STATUS_BAR, right = 0, bottom = NAVIGATION_BAR, left = 0 }: Partial<Insets> = {},
) {
  await page.evaluate(
    (insets) => {
      const root = document.documentElement.style;
      for (const [side, size] of Object.entries(insets)) {
        root.setProperty(`--safe-area-inset-${side}`, `${size}px`);
      }
    },
    { top, right, bottom, left },
  );
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not drawn");
  return {
    top: found.y,
    bottom: found.y + found.height,
    left: found.x,
    right: found.x + found.width,
  };
}

/** Whether `locator` is drawn inside the room the bars leave, on all four sides. */
async function inRoom(
  locator: Locator,
  insets: Insets,
  viewport: { width: number; height: number },
) {
  // Measured where the dialog ends, not mid-way through its opening scale:
  // its starting style gone, then its transitions finished.
  const dialog = locator.page().getByRole("dialog").filter({ has: locator }).last();
  const popup = (await dialog.count()) > 0 ? dialog : locator;
  await expect(popup).not.toHaveAttribute("data-starting-style");
  await popup.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const { top, bottom, left, right } = await box(locator);
  expect(top).toBeGreaterThanOrEqual(insets.top);
  expect(bottom).toBeLessThanOrEqual(viewport.height - insets.bottom);
  expect(left).toBeGreaterThanOrEqual(insets.left);
  expect(right).toBeLessThanOrEqual(viewport.width - insets.right);
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

// A phone on its side: the status bar on top, a camera cutout at the left,
// three-button navigation at the right.
const SIDEWAYS: Insets = { top: STATUS_BAR, right: NAVIGATION_BAR, bottom: 0, left: 32 };

test("on a phone turned sideways a card, the dialog beside its draft and a centred dialog stay in the room the bars leave", async ({
  page,
}) => {
  // Wide enough for the card (design D235): the edit dialog stands beside its draft.
  const LANDSCAPE = { width: PHONE.height, height: PHONE.width };
  await page.setViewportSize(LANDSCAPE);
  await openDemo(page, "week");
  await systemBars(page, SIDEWAYS);
  // The aside reads the side bars as `--inset-*` resolves them (draft-aside.ts).
  expect(
    await page.evaluate(() =>
      ["left", "right"].map((side) =>
        getComputedStyle(document.documentElement).getPropertyValue(`--inset-${side}`),
      ),
    ),
  ).toEqual(["32px", "48px"]);

  await page.getByRole("button", { name: "Create" }).click();
  const edit = page.getByRole("dialog", { name: "New event" });
  await expect(edit).toHaveAttribute("data-aside", /^(left|right)$/);
  await inRoom(edit, SIDEWAYS, LANDSCAPE);
  // Narrower by the bar on its side, it does not cover the draft.
  const draft = await box(page.locator("main [data-draft]").first());
  const dialog = await box(edit);
  expect(dialog.right <= draft.left || dialog.left >= draft.right).toBe(true);
  // Its outer edge 24 px from the bar on its side: the aside reads `--inset-*`.
  const side = await edit.getAttribute("data-aside");
  if (side === "right") expect(LANDSCAPE.width - dialog.right).toBeCloseTo(24 + SIDEWAYS.right, 0);
  else expect(dialog.left).toBeCloseTo(24 + SIDEWAYS.left, 0);
  await page.keyboard.press("Escape");
  await expect(edit).toBeHidden();

  await inRoom(await addAccount(page), SIDEWAYS, LANDSCAPE);
});

test("on a small phone turned sideways the sheets cover the screen with their content clear of the bars on all four sides", async ({
  page,
}) => {
  // Narrower than the card's 640 px: every sheet is the whole screen.
  const SMALL = { width: 480, height: 320 };
  await page.setViewportSize(SMALL);
  await openDemo(page, "day");
  await systemBars(page, SIDEWAYS);

  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Design review, / })
    .click();
  const details = page.getByRole("dialog", { name: "Design review" });
  await inRoom(details.getByRole("button", { name: "Close", exact: true }), SIDEWAYS, SMALL);
  await inRoom(details.getByRole("button", { name: "More actions" }), SIDEWAYS, SMALL);

  await details.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  await inRoom(edit.getByRole("button", { name: "Close without saving" }), SIDEWAYS, SMALL);
  await inRoom(edit.getByRole("button", { name: "Save" }), SIDEWAYS, SMALL);
  await inRoom(edit.locator("form"), SIDEWAYS, SMALL);
  await page.keyboard.press("Escape");
  await expect(edit).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();

  await page.getByRole("button", { name: "Main menu" }).click();
  await page
    .getByRole("dialog", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await inRoom(settings.getByRole("button", { name: "Close settings" }), SIDEWAYS, SMALL);
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // A centred dialog narrower than its own width, by the bars at its sides.
  await inRoom(await addAccount(page), SIDEWAYS, SMALL);
});

test("without insets (a browser, a desktop) nothing moves", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "week");
  const bar = await box(page.getByRole("button", { name: "Main menu" }));
  // The top bar is 56px high, its button 40px, centred.
  expect(bar.top).toBe(8);
});
