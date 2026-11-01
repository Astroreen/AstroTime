// Reminders as notifications in the web app (docs/plans/foundation.md#D101):
// the demo data, a clock the test moves (`page.clock`: no time passes unless
// the test says), the permission granted by the browser context, and the
// page's `Notification` wrapped so the test sees what the app shows.
// Headless Chromium shows no notification of its own; the wrapper draws each
// one in the page as a button that taps it, so the test waits for it as for
// any element, and the evidence can show it.
import { expect, test, type Page } from "@playwright/test";

import { captureNotifications, NOW, PHONE } from "./support.ts";

test.use({ viewport: PHONE });

/**
 * The demo in the Day view, on a fake clock installed at `NOW`. It goes on at
 * the real pace (the drawer's animation needs its frames), seconds in all,
 * and jumps when the test moves it.
 */
async function openDemo(page: Page, permission?: NotificationPermission): Promise<void> {
  await captureNotifications(page, permission);
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => localStorage.setItem("astrotime.view", "day"));
  await page.goto("/?demo");
  await expect(
    page.getByRole("list", { name: "Wednesday, November 4" }).getByRole("listitem").first(),
  ).toBeVisible();
}

/** Turns reminders on in the drawer, the browser letting the site notify, and closes it. */
async function turnOn(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Main menu" }).click();
  const toggle = page.getByRole("switch", { name: "Reminders" });
  // Nothing was asked at start.
  await expect(toggle).not.toBeChecked();
  await page.context().grantPermissions(["notifications"]);
  await toggle.click();
  await expect(toggle).toBeChecked();
  // The set is with the platform: the setting names its first reminder.
  await expect(page.getByText(/^Next: Call with Anna, Wed, Nov 4, 11:00\sAM\.$/)).toBeVisible();
  await expect(page.getByText("Reminders show while AstroTime is open in a tab.")).toBeVisible();
  await page.keyboard.press("Escape");
}

const notifications = (page: Page) => page.getByRole("region", { name: "Notifications" });

test("a reminder shows at its time, with what it is about and how soon", async ({ page }) => {
  await openDemo(page);
  await turnOn(page);
  // 10:59: nothing yet.
  await page.clock.runFor("19:00");
  await expect(notifications(page)).toHaveCount(0);
  // 11:00, fifteen minutes before the call at 11:15.
  await page.clock.runFor("01:00");
  await expect(notifications(page).getByRole("button")).toHaveCount(1);
  await expect(
    notifications(page).getByRole("button", {
      name: /^Call with Anna 11:15\s–\s11:45\sAM · in 15 minutes$/,
    }),
  ).toBeVisible();
});

test("after the laptop slept past them, only a reminder still due shows; a tap opens its day and its details", async ({
  page,
}) => {
  await openDemo(page);
  await turnOn(page);
  // The lid shut from 10:40 to 14:00 tomorrow: the call and the proposal are
  // long past and stay quiet; the dentist, an hour ahead, shows.
  await page.clock.fastForward("27:20:00");
  const dentist = notifications(page).getByRole("button", {
    name: /^Dentist 3:00\s–\s4:00\sPM · in 1 hour$/,
  });
  await expect(dentist).toBeVisible();
  await expect(notifications(page).getByRole("button")).toHaveCount(1);
  await dentist.click();
  await expect(dentist).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Thursday, November 5" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Dentist" })).toBeVisible();
});

test("where the browser already lets the site notify, reminders are on; turned off, they stop", async ({
  page,
}) => {
  await page.context().grantPermissions(["notifications"]);
  await openDemo(page, "granted");
  await page.getByRole("button", { name: "Main menu" }).click();
  const toggle = page.getByRole("switch", { name: "Reminders" });
  await expect(toggle).toBeChecked();
  await expect(page.getByText(/^Next: Call with Anna, Wed, Nov 4, 11:00\sAM\.$/)).toBeVisible();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText(/^Next: /)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.clock.runFor("20:00");
  await expect(notifications(page)).toHaveCount(0);
});
