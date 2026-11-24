// Where a new item goes (design D313), and every account at once (D314),
// against two real Radicales: quick create's row opens the accounts, then
// the chosen one's calendars, two ticked; the event is uploaded to both of
// them, a UID each, and nothing to the other server. With Settings' "Save
// new items to every account" on, the row is gone, and the event is
// uploaded to both servers. With
// ASTROTIME_SCREENSHOTS naming a directory, the evidence is taken on the way.
import { test as base, expect, type Page, type Response } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { addAccount, calendarField, openApp, quickCreate, WIDE } from "./support.ts";

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

/** The UIDs of the next `count` uploads to `server`, once each was created there. */
const uploadsTo = (page: Page, server: CalDavServer, count: number) =>
  new Promise<string[]>((resolve) => {
    const uids: string[] = [];
    const seen = (response: Response) => {
      // Through the dev server's proxy (`/dav-proxy/`), which names the server in its path.
      if (
        response.request().method() !== "PUT" ||
        !decodeURIComponent(response.url()).includes(`${new URL(server.url).host}/`)
      )
        return;
      expect(response.status()).toBe(201);
      uids.push(/\r\nUID:([^\r]+)\r\n/.exec(response.request().postData() ?? "")?.[1] ?? "");
      if (uids.length === count) {
        page.off("response", seen);
        resolve(uids);
      }
    };
    page.on("response", seen);
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
  const alpha = await first.mkcalendar("alpha");
  const work = await second.mkcalendar("work");
  const family = await second.mkcalendar("family");
  await openApp(page);
  await signIn(page, first);
  await signIn(page, second);

  // Quick create's one row: the account, then its calendars (D313).
  await page.getByRole("button", { name: "Create" }).click();
  const quick = quickCreate(page);
  const field = calendarField(quick);
  // It starts in the first account's alpha (first by name); the accounts
  // first, each by its user name (no server's address) and its calendars.
  await expect(field).toHaveAccessibleName(/^Calendar: astro ?, alpha$/);
  await field.click();
  const firstAccount = page.getByRole("button", { name: "astro alpha", exact: true });
  await expect(firstAccount).toHaveAttribute("aria-current", "true");
  // The second account: the item goes to its first calendar, then a second tick.
  await page.getByRole("button", { name: "astro family, work", exact: true }).click();
  const calendars = page.getByRole("group", { name: "Calendar" });
  await expect(calendars.getByRole("checkbox")).toHaveCount(2);
  await expect(calendars.getByRole("checkbox", { name: "family" })).toBeChecked();
  await calendars.getByRole("checkbox", { name: "work" }).click();
  await page.keyboard.press("Escape");
  await expect(calendars).toHaveCount(0);
  await expect(field).toHaveAccessibleName(/^Calendar: astro ?, family, work$/);
  await quick.getByRole("textbox", { name: "Title" }).fill("Family dinner");
  await shoot(page, "account-choice");
  const toSecond = uploadsTo(page, second, 2);
  await quick.getByRole("button", { name: "Save" }).click();
  const [dinner, dinnerCopy] = await toSecond;
  expect(dinner).not.toBe(dinnerCopy);

  // On: no account to choose, and the event is uploaded to both (D314).
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
  // No row for where it goes: every account gets it.
  await expect(calendarField(quick)).toHaveCount(0);
  await quick.getByRole("textbox", { name: "Title" }).fill("Dentist");
  await shoot(page, "every-account-quick-create");
  const both = Promise.all([uploadsTo(page, first, 1), uploadsTo(page, second, 1)]);
  await quick.getByRole("button", { name: "Save" }).click();
  const [[one], [other]] = await both;
  expect(one).not.toBe(other);
  // Off, the second server's two ticked calendars had it; on, each server's
  // first calendar by name (alpha here, family there).
  expect([
    await itemsIn(first, alpha),
    await itemsIn(second, family),
    await itemsIn(second, work),
  ]).toEqual([1, 2, 1]);
});
