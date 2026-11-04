// Calendars and lists made on an account's server (docs/plans/design.md#D276,
// docs/plans/import.md#D277, providers D275): "+ New list" on the tasks
// screen makes a list on Radicale with one MKCALENDAR and shows it; an import
// makes its new calendar and list there, and its items go up to them. On a
// phone in Russian with no account, the list is made on this device.
import { test as base, expect, type Page } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { importFile, TEAM } from "./import-files.ts";
import { addAccount, choose, openApp, PHONE, WIDE } from "./support.ts";

const test = base.extend<{ radicale: CalDavServer }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  radicale: async ({}, use) => {
    const server = await startRadicale();
    await use(server);
    await server.stop();
  },
});

/** Signs in to Radicale and waits for the first sync to end. */
async function signIn(page: Page, radicale: CalDavServer): Promise<string> {
  const dialog = await addAccount(page, "caldav");
  await dialog.getByRole("textbox", { name: "Server address" }).fill(radicale.url);
  await dialog.getByRole("textbox", { name: "User name" }).fill(radicale.username);
  await dialog.getByLabel("Password").fill(radicale.password);
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await expect(dialog).toHaveCount(0);
  const name = `astro@${new URL(radicale.url).host}`;
  await expect(page.getByRole("region", { name }).getByText(/^Synced at /)).toBeVisible();
  await page.keyboard.press("Escape");
  return name;
}

/** What the server names a calendar at `url`, as another client asks it. */
async function displayName(radicale: CalDavServer, url: string): Promise<string | null> {
  const response = await fetch(url, {
    method: "PROPFIND",
    headers: {
      Authorization: `Basic ${btoa(`${radicale.username}:${radicale.password}`)}`,
      Depth: "0",
      "Content-Type": "application/xml",
    },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
  });
  return /<[a-z0-9]*:?displayname>([^<]*)</i.exec(await response.text())?.[1] ?? null;
}

test.describe("wide, English, on Radicale", () => {
  test.use({ viewport: WIDE });

  test("+ New list makes the list on the account's server and shows it", async ({
    page,
    radicale,
  }) => {
    await radicale.mkcalendar("personal", ["VTODO"]);
    await openApp(page);
    const account = await signIn(page, radicale);
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    const tasks = page.getByRole("region", { name: "Tasks" });
    await tasks.getByRole("button", { name: "New list" }).click();
    const dialog = page.getByRole("dialog", { name: "New list" });
    await expect(dialog.getByRole("combobox", { name: "Where" })).toHaveText(account);
    await dialog.getByRole("textbox", { name: "Name" }).fill("Errands");
    await page.screenshot({ path: "test-results/new-list-en-wide.png" });
    const made = page.waitForResponse((response) => response.request().method() === "MKCALENDAR");
    await dialog.getByRole("button", { name: "Create" }).click();
    const response = await made;
    expect(response.status()).toBe(201);
    await expect(dialog).toBeHidden();
    // The list made is the one shown.
    await expect(tasks.getByRole("tab", { name: "Errands" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await displayName(radicale, response.url())).toBe("Errands");
  });

  test("an import's new calendar and list on the account: made there, its items uploaded to them", async ({
    page,
    radicale,
  }) => {
    await radicale.mkcalendar("personal");
    await openApp(page);
    const account = await signIn(page, radicale);
    await page
      .getByRole("navigation", { name: "Main menu" })
      .getByRole("button", { name: "Settings" })
      .click();
    await importFile(page, /^Import from a file/, "team.ics", TEAM);
    const dialog = page.getByRole("dialog", { name: "Import" });
    const team = dialog.getByRole("region", { name: "Team" });
    await choose(
      team.getByRole("combobox", { name: "Events go to" }),
      `New calendar on ${account}: Team`,
    );
    await choose(
      team.getByRole("combobox", { name: "Tasks go to" }),
      `New list on ${account}: Team`,
    );
    const made: string[] = [];
    page.on("response", (answer) => {
      if (answer.request().method() === "MKCALENDAR" && answer.status() === 201)
        made.push(answer.url());
    });
    // Three items go up once made: the sync after the import (D5).
    const uploads = Promise.all(
      [0, 1, 2].map(() =>
        page.waitForResponse(
          (answer) => answer.request().method() === "PUT" && answer.status() === 201,
        ),
      ),
    );
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("2 events · 1 task");
    await uploads;
    // One calendar a kind (providers D275), both named as the file's.
    expect(made).toHaveLength(2);
    for (const url of made) expect(await displayName(radicale, url)).toBe("Team");
  });
});

test.describe("on a phone, in Russian, with no account", () => {
  test.use({ viewport: PHONE, locale: "ru-RU", hasTouch: true, isMobile: true });

  test("+ Создать список: the list is made on this device, no place to choose", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    const tasks = page.getByRole("region", { name: "Задачи" });
    await tasks.getByRole("button", { name: "Создать список" }).click();
    const dialog = page.getByRole("dialog", { name: "Новый список" });
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
    await dialog.getByRole("textbox", { name: "Название" }).fill("Покупки");
    await page.screenshot({ path: "test-results/new-list-ru-phone.png" });
    await dialog.getByRole("button", { name: "Создать" }).click();
    await expect(dialog).toBeHidden();
    await expect(tasks.getByRole("tab", { name: "Покупки" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
