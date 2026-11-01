// Offline-first (docs/plans/foundation.md#D122): the app opens on the
// calendar with no account, on the calendar on this device; events and tasks
// are made there with no network at all, and stay after a reload. An account
// added later takes the place of the calendar on this device while it is
// unused, and stands beside it once it holds items.
import { expect, test, type Page } from "@playwright/test";

import { startRadicale } from "../../../packages/sync/test/servers.ts";
import { addAccount, openApp, WIDE } from "./support.ts";

test.use({ viewport: WIDE });

const wednesday = (page: Page) => page.getByRole("list", { name: "Wednesday, November 4" });

test("with no account and no network, an event made on this device stays after a reload", async ({
  page,
  context,
}) => {
  await openApp(page);
  // No sign-in in the way: the calendar on this device, said calmly.
  const local = page.getByRole("region", { name: "On this device" });
  await expect(local.getByRole("checkbox", { name: "Personal" })).toBeChecked();
  await expect(local.getByText("Not synced: on this device only")).toBeVisible();

  // No network: nothing in AstroTime needs it for this.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Create" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Dentist");
  await dialog.getByLabel("Start time").selectOption("16:00");
  await dialog.getByRole("button", { name: "Save" }).click();
  const dentist = wednesday(page).getByRole("listitem", { name: "Dentist, 4:00 – 5:00 PM" });
  await expect(dentist).toBeVisible();
  // Nothing in the accounts asks for attention: there is no server to reach.
  await expect(page.getByRole("button", { name: "Accounts", exact: true })).toBeVisible();

  await context.setOffline(false);
  await page.reload();
  await expect(dentist).toBeVisible();
});

test("an account added beside the calendar on this device keeps it once it holds items", async ({
  page,
}) => {
  const radicale = await startRadicale();
  try {
    await radicale.mkcalendar("work");
    await openApp(page);
    await page.getByRole("button", { name: "Create" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByRole("textbox", { name: "Title" }).fill("Kept here");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    const signIn = await addAccount(page, "caldav");
    await signIn.getByRole("textbox", { name: "Server address" }).fill(radicale.url);
    await signIn.getByRole("textbox", { name: "User name" }).fill(radicale.username);
    await signIn.getByLabel("Password").fill(radicale.password);
    await signIn.getByRole("button", { name: "Sign in" }).click();
    const account = page.getByRole("region", { name: `astro@${new URL(radicale.url).host}` });
    await expect(account.getByRole("checkbox", { name: "work" })).toBeVisible();
    // Holding an item, the calendar on this device stays, with it.
    await expect(page.getByRole("region", { name: "On this device" })).toBeVisible();
    await expect(page.getByRole("listitem", { name: /^Kept here, / })).toBeVisible();
  } finally {
    await radicale.stop();
  }
});
