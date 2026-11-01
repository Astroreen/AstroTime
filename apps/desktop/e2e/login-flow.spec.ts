// Nextcloud's Login Flow v2 on the desktop (docs/plans/desktop.md#D77): the
// login page goes to the system browser through `shell.openExternal`, the
// app polls through the main process's HTTP, and once the user approves the
// poll ends with an app password and the account syncs. The system browser is
// the test's Chromium: the spec takes the URL the app hands `openExternal`.
// Runs against a Nextcloud someone started (the nightly's, or a disposable
// one), named by ASTROTIME_NEXTCLOUD_URL, _USERNAME and _PASSWORD:
//
//   docker run -d -p 127.0.0.1:18120:80 -e SQLITE_DATABASE=nextcloud \
//     -e NEXTCLOUD_ADMIN_USER=astro -e NEXTCLOUD_ADMIN_PASSWORD=… \
//     -e NEXTCLOUD_TRUSTED_DOMAINS="localhost 127.0.0.1" nextcloud:31-apache
//
// ASTROTIME_SCREENSHOTS, when it names a directory, also takes the waiting
// state's screenshots.
import { join } from "node:path";

import { chromium, expect, test } from "@playwright/test";

import { externalServer } from "../../../packages/sync/test/servers.ts";
import { keepPassword, launch, profile } from "./support.ts";

const server = externalServer("nextcloud");
const screenshots = process.env["ASTROTIME_SCREENSHOTS"];
test.skip(!server, "set ASTROTIME_NEXTCLOUD_URL, _USERNAME and _PASSWORD to a Nextcloud");

test("Login Flow v2: the page opens in the system browser, and once approved the poll ends and the account syncs", async () => {
  const nextcloud = server!;
  const { app, page } = await launch(profile());
  // The system browser, as the main process calls it: the URL comes here instead.
  const opened = app.evaluate(
    ({ shell }) =>
      new Promise<string>((resolve) => {
        shell.openExternal = async (url) => resolve(url);
      }),
  );

  await page.getByRole("button", { name: "Sign in to Nextcloud" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an account" });
  await dialog.getByRole("textbox", { name: "Server address" }).fill(nextcloud.url);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("heading", { name: "Waiting for Nextcloud" })).toBeVisible();
  const loginUrl = await opened;
  expect(new URL(loginUrl).origin).toBe(new URL(nextcloud.url).origin);
  if (screenshots) {
    for (const theme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: join(screenshots, `desktop-login-flow-${theme}.png`) });
    }
  }

  // The user goes to the browser, signs in on Nextcloud's own pages and
  // grants access (as packages/sync/test/servers.test.ts does), then comes back.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.blur());
  const browser = await chromium.launch();
  try {
    const login = await browser.newPage();
    await login.goto(loginUrl);
    await login.getByRole("heading", { name: "Connect to your account" }).waitFor();
    await login.getByRole("button", { name: "Log in", exact: true }).click();
    await login.getByRole("textbox", { name: /^Account name/ }).fill(nextcloud.username);
    await login.getByRole("textbox", { name: "Password" }).fill(nextcloud.password);
    await login.getByRole("button", { name: "Log in", exact: true }).click();
    await login.getByRole("button", { name: "Grant access" }).click();
    await login.getByRole("heading", { name: "Account connected" }).waitFor();
  } finally {
    await browser.close();
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());

  // The poll took the app password; without a keyring here, the app asks
  // how to keep it (D74), then finds the calendars and syncs.
  await keepPassword(page, "Keep until AstroTime quits");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const account = page.getByRole("region", {
    name: `${nextcloud.username}@${new URL(nextcloud.url).host}`,
  });
  await expect(account.getByText(/^Synced at /)).toBeVisible();
  await app.close();
});
