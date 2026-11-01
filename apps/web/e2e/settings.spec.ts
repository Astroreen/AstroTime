// Settings (design D53, D131): a dialog from the top bar's button on a wide
// screen, a screen from the drawer on a phone; each setting applies at once
// and is kept.
import { expect, test, type Locator, type Page } from "@playwright/test";

import { openApp, openDemo, PHONE, WIDE } from "./support.ts";

const header = (page: Page, name: string) => page.getByRole("heading", { name });
const day = (page: Page, name: string) => page.getByRole("list", { name });

/** Opens Settings from the top bar, does what `change` does in it, and closes it. */
async function inSettings(page: Page, change: (settings: Locator) => Promise<void>) {
  await page
    .getByRole("banner")
    .getByRole("button", { name: /^(Settings|Настройки)$/ })
    .click();
  const settings = page.getByRole("dialog", { name: /^(Settings|Настройки)$/ });
  await change(settings);
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
}

test("theme, week start, clock, hide completed and language apply at once and are kept", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  const body = page.locator("body");
  await expect(body).toHaveCSS("background-color", "rgb(27, 29, 35)");

  // The theme overrides the system's (D44, D58), at once, under the dialog too.
  await inSettings(page, async (settings) => {
    await settings.getByLabel("Theme").selectOption({ label: "Light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(body).toHaveCSS("background-color", "rgb(238, 240, 244)");
  });

  // The week starts on Monday instead of the locale's Sunday (D45).
  await expect(header(page, "Sunday, November 1")).toBeVisible();
  await inSettings(page, (settings) =>
    settings
      .getByLabel("Start of the week")
      .selectOption({ label: "Monday" })
      .then(() => {}),
  );
  await expect(header(page, "Sunday, November 1")).toHaveCount(0);
  await expect(header(page, "Monday, November 2")).toBeVisible();
  await expect(header(page, "Sunday, November 8")).toBeVisible();

  // The clock: 24 hours instead of the locale's 12.
  const report = day(page, "Wednesday, November 4").getByRole("listitem", {
    name: /^Task: Send the report/,
  });
  await expect(report).toHaveAccessibleName("Task: Send the report, 3:00 PM");
  await inSettings(page, (settings) =>
    settings
      .getByLabel("Clock")
      .selectOption({ label: "24-hour" })
      .then(() => {}),
  );
  await expect(report).toHaveAccessibleName("Task: Send the report, 15:00");

  // Hide completed: completed tasks' chips go from every view; the undone chip stays (D51).
  const strip = page.getByRole("list", { name: "All day" });
  const desk = strip.getByRole("listitem", { name: "Completed task: Tidy the desk, All day" });
  await expect(desk).toBeVisible();
  await inSettings(page, (settings) =>
    settings.getByRole("switch", { name: "Hide completed tasks" }).click(),
  );
  await expect(desk).toHaveCount(0);
  await expect(strip.getByRole("button", { name: "3 undone tasks" })).toBeVisible();

  // A calendar hidden in Settings is hidden in the drawer too: one setting (D131).
  await inSettings(page, (settings) => settings.getByRole("checkbox", { name: "Work" }).click());
  await expect(
    page.getByRole("navigation", { name: "Main menu" }).getByRole("checkbox", { name: "Work" }),
  ).not.toBeChecked();
  await expect(
    day(page, "Wednesday, November 4").getByRole("listitem", { name: /Design review/ }),
  ).toHaveCount(0);

  // The language: Russian, with the week start and clock still as chosen.
  await inSettings(page, (settings) =>
    settings
      .getByLabel("Language")
      .selectOption({ label: "Русский" })
      .then(() => {}),
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("main", { name: "Ноябрь" })).toBeVisible();
  await expect(header(page, "понедельник, 2 ноября")).toBeVisible();

  // Kept on this device.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(header(page, "понедельник, 2 ноября")).toBeVisible();
  await inSettings(page, async (settings) => {
    await expect(settings.getByLabel("Тема")).toHaveValue("light");
    await expect(
      settings.getByRole("switch", { name: "Скрывать выполненные задачи" }),
    ).toBeChecked();
  });
  // The demo data is titled in the browser's language; the UI speaks the chosen one.
  await expect(
    day(page, "среда, 4 ноября").getByRole("listitem", { name: "Задача: Send the report, 15:00" }),
  ).toBeVisible();
});

test("on a phone, Settings is the drawer's last row and a screen of its own", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "day");
  // No settings in the drawer itself, only the way to them (D131).
  await page.getByRole("button", { name: "Main menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Main menu" });
  await expect(drawer.getByLabel("Theme")).toHaveCount(0);
  await drawer.getByRole("button", { name: "Settings" }).click();
  await expect(drawer).toBeHidden();
  const settings = page.getByRole("dialog", { name: "Settings" });
  // The whole screen.
  const box = (await settings.boundingBox())!;
  expect(box.width).toBe(PHONE.width);
  expect(box.height).toBe(PHONE.height);
  await settings.getByLabel("Theme").selectOption({ label: "Dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settings.getByRole("button", { name: "Close settings" }).click();
  await expect(settings).toBeHidden();
  await expect(page.getByRole("button", { name: "Main menu" })).toBeFocused();
});

test("Settings lists the accounts, each with how it syncs, its menu and its calendars (design D137)", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const accounts = settings.getByRole("region", { name: "Accounts" });
  const demo = accounts.getByRole("region", { name: "Demo" });
  // Its sync line is text: the accounts' live region is one at a time, not one per row.
  await expect(demo.getByText("Demo data, on this device only")).toBeVisible();
  await expect(demo.getByRole("status")).toHaveCount(0);
  await expect(demo.getByRole("button", { name: "Options for Demo" })).toBeVisible();
  // The drawer's calendar row, the same checkbox in the same place.
  for (const name of ["Holidays", "Personal", "Tasks", "Work"]) {
    await expect(demo.getByRole("checkbox", { name })).toBeChecked();
  }
  // "Add account" closes Settings and opens adding one.
  await accounts.getByRole("button", { name: "Add account" }).click();
  await expect(settings).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Add an account" })).toBeVisible();
});

test("the calendar on this device is named so in Settings (design D137)", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await openApp(page);
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  const accounts = page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("region", { name: "Accounts" });
  await expect(accounts.getByRole("region", { name: "On this device" })).toBeVisible();
});
