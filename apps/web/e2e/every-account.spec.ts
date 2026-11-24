// The account a new item goes to (design D312), and every account at once
// (D313), against two real Radicales: quick create offers each account and
// that account's calendars, and the event is uploaded to the one chosen;
// with Settings' "Save new items to every account" on, there is no account
// to choose, and the event is uploaded to both servers, a UID each. With
// ASTROTIME_SCREENSHOTS naming a directory, the evidence is taken on the way.
import { test as base, expect, type Page } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { addAccount, choose, openApp, quickCreate, WIDE } from "./support.ts";

const test = base.extend<{ first: CalDavServer; second: CalDavServer }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  first: async ({}, use) => {
    const server = await startRadicale();
    await use(server);
    await server.stop();
  },
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  second: async ({}, use) => {
    const server = await startRadicale();
    await use(server);
    await server.stop();
  },
});

test.use({ viewport: WIDE });

const directory = process.env["ASTROTIME_SCREENSHOTS"];
const shoot = async (page: Page, name: string) => {
  if (directory)
    await page.screenshot({ path: `${directory}/${name}.png`, animations: "disabled" });
};

/** Signs in to `server` and waits for its first sync to end; its account's name. */
async function signIn(page: Page, server: CalDavServer): Promise<string> {
  const dialog = await addAccount(page, "caldav");
  await dialog.getByRole("textbox", { name: "Server address" }).fill(server.url);
  await dialog.getByRole("textbox", { name: "User name" }).fill(server.username);
  await dialog.getByLabel("Password").fill(server.password);
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await expect(dialog).toHaveCount(0);
  const name = `astro@${new URL(server.url).host}`;
  await expect(page.getByRole("region", { name }).getByText(/^Synced at /)).toBeVisible();
  await page.keyboard.press("Escape");
  return name;
}

/** The UID of an upload to `server`'s calendar, once it was created there. */
const uploadTo = (page: Page, server: CalDavServer) =>
  page
    .waitForResponse(
      (response) =>
        // Through the dev server's proxy (`/dav-proxy/`), which names the server in its path.
        response.request().method() === "PUT" &&
        decodeURIComponent(response.url()).includes(`${new URL(server.url).host}/`),
    )
    .then((response) => {
      expect(response.status()).toBe(201);
      return /\r\nUID:([^\r]+)\r\n/.exec(response.request().postData() ?? "")?.[1];
    });

/** How many items a calendar holds on its server, as another client lists them. */
async function itemsIn(server: CalDavServer, url: string): Promise<number> {
  const response = await fetch(url, {
    method: "PROPFIND",
    headers: {
      Authorization: `Basic ${btoa(`${server.username}:${server.password}`)}`,
      Depth: "1",
      "Content-Type": "application/xml",
    },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>',
  });
  return (await response.text()).match(/\.ics<\//g)?.length ?? 0;
}

test("a new event goes to the account chosen, or to every account", async ({
  page,
  first,
  second,
}) => {
  const home = await first.mkcalendar("home");
  const work = await second.mkcalendar("work");
  const family = await second.mkcalendar("family");
  await openApp(page);
  const firstName = await signIn(page, first);
  const secondName = await signIn(page, second);

  // Quick create offers each account, and the chosen one's calendars (D312).
  await page.getByRole("button", { name: "Create" }).click();
  const quick = quickCreate(page);
  const account = quick.getByRole("combobox", { name: "Account" });
  await expect(account).toBeVisible();
  // Each account in turn: its own calendars only, its first one chosen.
  const calendar = quick.getByRole("combobox", { name: "Calendar" });
  await choose(account, firstName);
  await expect(calendar).toHaveText(/home/);
  await calendar.click();
  await expect(page.getByRole("option", { name: "home" })).toBeVisible();
  await expect(page.getByRole("option", { name: "family" })).toHaveCount(0);
  await page.getByRole("option", { name: "home" }).click();
  await choose(account, secondName);
  await expect(account).toHaveText(new RegExp(secondName.replaceAll(".", "\\.")));
  await expect(calendar).not.toHaveText(/home/);
  await calendar.click();
  await expect(page.getByRole("option", { name: "work" })).toBeVisible();
  await expect(page.getByRole("option", { name: "family" })).toBeVisible();
  await expect(page.getByRole("option", { name: "home" })).toHaveCount(0);
  await page.getByRole("option", { name: "family" }).click();
  await quick.getByRole("textbox", { name: "Title" }).fill("Family dinner");
  await shoot(page, "account-choice");
  const toSecond = uploadTo(page, second);
  await quick.getByRole("button", { name: "Save" }).click();
  expect(await toSecond).toBeTruthy();

  // On: no account to choose, and the event is uploaded to both (D313).
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const every = settings.getByRole("switch", { name: "Save new items to every account" });
  await expect(every).not.toBeChecked();
  await every.click();
  await expect(every).toBeChecked();
  await shoot(page, "every-account-setting");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  await page.getByRole("button", { name: "Create" }).click();
  await expect(quick.getByRole("combobox", { name: "Account" })).toHaveCount(0);
  await expect(quick.getByText("Also saved to your other accounts.")).toBeVisible();
  await quick.getByRole("textbox", { name: "Title" }).fill("Dentist");
  await shoot(page, "every-account-quick-create");
  const both = Promise.all([uploadTo(page, first), uploadTo(page, second)]);
  await quick.getByRole("button", { name: "Save" }).click();
  const [one, other] = await both;
  expect(one).toBeTruthy();
  expect(other).toBeTruthy();
  expect(one).not.toBe(other);
  // Off, the family calendar alone had it; on, the first server's too (the
  // second's first calendar by name is family again).
  expect([
    await itemsIn(first, home),
    await itemsIn(second, family),
    await itemsIn(second, work),
  ]).toEqual([1, 2, 0]);
});
