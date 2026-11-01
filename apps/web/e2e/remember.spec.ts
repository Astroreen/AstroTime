// The app remembers the user (docs/plans/foundation.md#D121): an account
// signed in to is there after the browser is closed and opened again, the
// browser is asked to keep the data, the first run says the data belongs to
// this address, and a Login Flow whose tab the browser discarded while the
// user approved on Nextcloud's page is taken up by the tab loaded anew.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, expect, test, type Page } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { NOW, WIDE } from "./support.ts";

test.use({ viewport: WIDE });

let radicale: CalDavServer;
test.beforeAll(async () => {
  radicale = await startRadicale();
});
test.afterAll(async () => {
  await radicale.stop();
});

const accountName = () => `astro@${new URL(radicale.url).host}`;

type Asks = typeof globalThis & { persistAsks: number; persistAsked: Promise<void> };

/** Counts the app's asks to keep its data, from before any of its script runs. */
async function countPersistAsks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const storage = navigator.storage;
    const persist = storage.persist.bind(storage);
    const asks = globalThis as Asks;
    let asked = () => {};
    asks.persistAsks = 0;
    asks.persistAsked = new Promise((resolve) => (asked = resolve));
    storage.persist = () => {
      asks.persistAsks++;
      asked();
      return persist();
    };
  });
}

test("an account is there after the browser is closed and opened again, and the browser is asked to keep it", async ({
  baseURL,
}) => {
  if (!baseURL) throw new Error("The config gives a baseURL.");
  const profile = await mkdtemp(join(tmpdir(), "astrotime-profile-"));
  try {
    const first = await chromium.launchPersistentContext(profile, { baseURL, viewport: WIDE });
    const page = first.pages()[0] ?? (await first.newPage());
    await countPersistAsks(page);
    await page.clock.setFixedTime(NOW);
    await page.goto("/");
    // Each origin has a store of its own: the first run says which this is.
    await expect(
      page.getByText(
        `AstroTime keeps your accounts and data in this browser, for ${new URL(baseURL).host} only.`,
        {
          exact: false,
        },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Another CalDAV server" }).click();
    const dialog = page.getByRole("dialog", { name: "Add an account" });
    await dialog.getByRole("textbox", { name: "Server address" }).fill(radicale.url);
    await dialog.getByRole("textbox", { name: "User name" }).fill(radicale.username);
    await dialog.getByLabel("Password").fill(radicale.password);
    await dialog.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("region", { name: accountName() })).toBeVisible();
    // Asked once the store holds the account, and once only.
    await page.evaluate(() => (globalThis as Asks).persistAsked);
    expect(await page.evaluate(() => (globalThis as Asks).persistAsks)).toBe(1);
    await first.close();

    const again = await chromium.launchPersistentContext(profile, { baseURL, viewport: WIDE });
    const reopened = again.pages()[0] ?? (await again.newPage());
    await reopened.clock.setFixedTime(NOW);
    await reopened.goto("/");
    const account = reopened.getByRole("region", { name: accountName() });
    await expect(account.getByText(/^Synced at /)).toBeVisible();
    await expect(reopened.getByRole("button", { name: "Another CalDAV server" })).toHaveCount(0);
    await again.close();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("a Login Flow whose tab the browser discarded is taken up by the tab loaded anew, and signs in", async ({
  page,
}) => {
  // Nextcloud's Login Flow, mocked at the proxy, for the local Radicale: its
  // page waits for the approval; CalDAV goes on to the real server.
  let approved = false;
  let spent = false;
  await page
    .context()
    .route("https://cloud.example.com/**", (route) =>
      route.fulfill({ body: "Nextcloud's sign-in page" }),
    );
  await page.route("**/dav-proxy/**", (route) => {
    const url = route.request().url();
    const flow = new URL(radicale.url);
    if (url.endsWith("/index.php/login/v2"))
      return route.fulfill({
        json: {
          poll: { token: "t0k3n", endpoint: new URL("login/v2/poll", flow).href },
          login: new URL("login/v2/flow/x", flow).href,
        },
      });
    if (url.endsWith("/login/v2/poll")) {
      if (!approved || spent) return route.fulfill({ status: 404, json: [] });
      spent = true;
      return route.fulfill({
        json: {
          server: radicale.url,
          loginName: radicale.username,
          appPassword: radicale.password,
        },
      });
    }
    return route.fallback();
  });
  await page
    .context()
    .route(`${new URL(radicale.url).origin}/login/v2/flow/**`, (route) =>
      route.fulfill({ body: "Nextcloud's sign-in page" }),
    );
  await page.clock.setFixedTime(NOW);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in to Nextcloud" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an account" });
  await dialog.getByRole("textbox", { name: "Server address" }).fill(radicale.url);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("status")).toContainText("Approve AstroTime");

  // The browser discards the tab while the user approves on Nextcloud's page;
  // back to it, the tab loads anew.
  await page.reload();
  await expect(dialog.getByRole("status")).toContainText("Approve AstroTime");
  approved = true;
  await page.bringToFront();
  await expect(page.getByRole("region", { name: accountName() })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Nothing is left to take up: loaded again, the tab opens no dialog.
  await page.reload();
  await expect(page.getByRole("region", { name: accountName() })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
