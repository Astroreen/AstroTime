// Accounts end to end against a real Radicale (docs/plans/foundation.md#pr-5--calendar-grid,
// D92): the web app signs in by password through the dev server's proxy, syncs
// the server's items into the Week view, follows a change made by another
// client, and says what went wrong in the user's language. Radicale is the
// one the sync package's integration tests start, ready when it says so.
import { test as base, expect, type Page } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { addAccount, openApp, RU_ADD_ACCOUNT, WIDE } from "./support.ts";

const test = base.extend<{ radicale: CalDavServer & { put: Put } }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  radicale: async ({}, use) => {
    const server = await startRadicale();
    const authorization = `Basic ${btoa(`${server.username}:${server.password}`)}`;
    const put: Put = async (calendarUrl, uid, summary, start, end) => {
      const response = await fetch(`${calendarUrl}${uid}.ics`, {
        method: "PUT",
        headers: { Authorization: authorization, "Content-Type": "text/calendar" },
        body: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Another client//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261101T080000Z\r\nDTSTART;TZID=Europe/Vilnius:${start}\r\nDTEND;TZID=Europe/Vilnius:${end}\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
      });
      if (response.status >= 300) throw new Error(`PUT ${uid}: ${response.status}`);
    };
    await use(Object.assign(server, { put }));
    await server.stop();
  },
});

type Put = (
  calendarUrl: string,
  uid: string,
  summary: string,
  start: string,
  end: string,
) => Promise<void>;

test.use({ viewport: WIDE });

const wednesday = (page: Page) => page.getByRole("list", { name: "Wednesday, November 4" });

async function signInByPassword(page: Page, server: CalDavServer, password = server.password) {
  const dialog = await addAccount(page, "caldav");
  await dialog.getByRole("textbox", { name: "Server address" }).fill(server.url);
  await dialog.getByRole("textbox", { name: "User name" }).fill(server.username);
  await dialog.getByLabel("Password").fill(password);
  await dialog.getByRole("button", { name: "Sign in" }).click();
  return dialog;
}

test("an account added by password syncs its calendars into the Week view, and Sync now brings a change from the server", async ({
  page,
  radicale,
}) => {
  const work = await radicale.mkcalendar("work");
  await radicale.put(
    work,
    "planning",
    "Planning with Radicale",
    "20261104T140000",
    "20261104T150000",
  );
  await openApp(page);
  // No sign-in in the way: the calendar on this device (D122).
  await expect(page.getByRole("region", { name: "On this device" })).toBeVisible();

  await signInByPassword(page, radicale);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    wednesday(page).getByRole("listitem", { name: /^Planning with Radicale, / }),
  ).toBeVisible();
  // The drawer: the account, how it synced, and its calendar with its checkbox (design D46).
  const account = page.getByRole("region", { name: `astro@${new URL(radicale.url).host}` });
  // With the server's calendars here, the unused calendar on this device steps aside (D122).
  await expect(page.getByRole("region", { name: "On this device" })).toHaveCount(0);
  await expect(account.getByRole("checkbox", { name: "work" })).toBeChecked();
  await expect(account.getByText(/^Synced at /)).toBeVisible();

  // Another client adds an event; Sync now brings it.
  await radicale.put(work, "review", "Review from the phone", "20261104T160000", "20261104T170000");
  await page.getByRole("button", { name: /^Accounts/ }).click();
  const accounts = page.getByRole("dialog", { name: "Accounts" });
  await accounts.getByRole("button", { name: "Sync now" }).click();
  // The dialog keeps the view from the accessibility tree while it is open.
  await accounts.getByRole("button", { name: "Close" }).click();
  await expect(
    wednesday(page).getByRole("listitem", { name: /^Review from the phone, / }),
  ).toBeVisible();
});

test("two tabs sync one at a time: a tab's sync waits for the other's to end (D91)", async ({
  context,
  radicale,
}) => {
  const work = await radicale.mkcalendar("work");
  const first = await context.newPage();
  await openApp(first);
  await signInByPassword(first, radicale);
  await expect(first.getByRole("button", { name: "Accounts", exact: true })).toBeVisible();
  // A sync of the first tab that has not ended: it holds the store's sync lock.
  await first.evaluate(
    () =>
      new Promise<void>((held) => {
        void navigator.locks.request("astrotime-sync:astrotime", () => {
          held();
          return new Promise<void>((end) => {
            (globalThis as typeof globalThis & { endSync?: () => void }).endSync = end;
          });
        });
      }),
  );
  await radicale.put(work, "review", "Review from the phone", "20261104T160000", "20261104T170000");

  // The second tab's sync on start waits for it, so it brings nothing yet.
  const second = await context.newPage();
  await openApp(second);
  await expect(second.getByRole("button", { name: "Accounts, syncing" })).toBeVisible();
  const waiting = await second.evaluate(async () =>
    ((await navigator.locks.query()).pending ?? []).map((lock) => lock.name),
  );
  expect(waiting).toContain("astrotime-sync:astrotime");
  const review = (page: Page) =>
    wednesday(page).getByRole("listitem", { name: /^Review from the phone, / });
  await expect(review(second)).toHaveCount(0);

  // The first tab's sync ends: the second's runs, and both tabs show what it brought.
  await first.evaluate(() =>
    (globalThis as typeof globalThis & { endSync?: () => void }).endSync?.(),
  );
  await expect(review(second)).toBeVisible();
  await expect(review(first)).toBeVisible();
  await expect(second.getByRole("button", { name: "Accounts", exact: true })).toBeVisible();
});

test.describe("in Russian", () => {
  test.use({ locale: "ru-RU" });

  test("a wrong password says so, and nothing is kept", async ({ page, radicale }) => {
    await openApp(page);
    const dialog = await addAccount(page, "caldav", RU_ADD_ACCOUNT);
    await dialog.getByRole("textbox", { name: "Адрес сервера" }).fill(radicale.url);
    await dialog.getByRole("textbox", { name: "Имя пользователя" }).fill(radicale.username);
    await dialog.getByLabel("Пароль").fill("wrong");
    await dialog.getByRole("button", { name: "Войти" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Неверное имя пользователя или пароль.");
    await dialog.getByRole("button", { name: "Отмена" }).click();
    await expect(page.getByRole("region", { name: "На этом устройстве" })).toBeVisible();
  });
});

test("removing an account, once confirmed, deletes its calendars from this device", async ({
  page,
  radicale,
}) => {
  const work = await radicale.mkcalendar("work");
  await radicale.put(
    work,
    "planning",
    "Planning with Radicale",
    "20261104T140000",
    "20261104T150000",
  );
  await openApp(page);
  await signInByPassword(page, radicale);
  await expect(
    wednesday(page).getByRole("listitem", { name: /^Planning with Radicale, / }),
  ).toBeVisible();
  const name = `astro@${new URL(radicale.url).host}`;
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: `Options for ${name}` })
    .click();
  await page.getByRole("menuitem", { name: "Remove from this device" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Remove ${name}?` });
  await confirm.getByRole("button", { name: "Remove" }).click();
  // No account is left: the calendar on this device again (D122).
  await expect(page.getByRole("region", { name: "On this device" })).toBeVisible();
});

test("an account whose sync is off asks nothing of its server, even on Sync now; on again, it syncs at once (D171)", async ({
  page,
  radicale,
}) => {
  const work = await radicale.mkcalendar("work");
  await radicale.put(
    work,
    "planning",
    "Planning with Radicale",
    "20261104T140000",
    "20261104T150000",
  );
  await openApp(page);
  await signInByPassword(page, radicale);
  await expect(
    wednesday(page).getByRole("listitem", { name: /^Planning with Radicale, / }),
  ).toBeVisible();
  const name = `astro@${new URL(radicale.url).host}`;

  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const section = settings.getByRole("region", { name });
  await section.getByRole("switch", { name: "Sync" }).click();
  await expect(section.getByText("Sync is off")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // Another client adds an event; Sync now, while the sync is off, reaches no server.
  await radicale.put(work, "review", "Review from the phone", "20261104T160000", "20261104T170000");
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/dav-proxy/")) asked.push(request.url());
  });
  await page.getByRole("button", { name: /^Accounts/ }).click();
  const accounts = page.getByRole("dialog", { name: "Accounts" });
  await accounts.getByRole("button", { name: "Sync now" }).click();
  await expect(accounts.getByRole("status").filter({ hasText: "Accounts, synced" })).toHaveCount(1);
  expect(asked).toEqual([]);
  await expect(accounts.getByText("Sync is off")).toBeVisible();
  await accounts.getByRole("button", { name: "Close" }).click();
  await expect(
    wednesday(page).getByRole("listitem", { name: /^Planning with Radicale, / }),
  ).toBeVisible();
  await expect(
    wednesday(page).getByRole("listitem", { name: /^Review from the phone, / }),
  ).toHaveCount(0);

  // On again: it syncs at once and brings the event.
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  await section.getByRole("switch", { name: "Sync" }).click();
  await expect(section.getByText(/^Synced at /)).toBeVisible();
  expect(asked.length).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(
    wednesday(page).getByRole("listitem", { name: /^Review from the phone, / }),
  ).toBeVisible();
});

test("a server this AstroTime does not carry is named as the administrator's choice (D20)", async ({
  page,
}) => {
  // The proxy's own refusal, as `proxyHandler` answers for a server off its allowlist.
  await page.route("**/dav-proxy/**", (route) =>
    route.fulfill({
      status: 403,
      headers: { "x-astrotime-refused": "not-allowed" },
      body: "not on this proxy's allowlist",
    }),
  );
  await openApp(page);
  const dialog = await addAccount(page);
  await dialog.getByRole("textbox", { name: "Server address" }).fill("cloud.example.com");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "This AstroTime's administrator has not allowed this server.",
  );
});

test("an http:// address to another host says the password would cross unencrypted; https and this device do not (providers D260)", async ({
  page,
}) => {
  await openApp(page);
  const dialog = await addAccount(page);
  const address = dialog.getByRole("textbox", { name: "Server address" });
  const warning =
    "This address is not encrypted: your password could be read on the way. Use https:// if the server offers it.";
  await address.fill("http://dav.example.net/dav.php/");
  await expect(address).toHaveAccessibleDescription(warning);
  await expect(dialog.getByText(warning)).toBeVisible();
  for (const safe of ["dav.example.net", "https://dav.example.net/", "http://127.0.0.1:5232/"]) {
    await address.fill(safe);
    await expect(dialog.getByText(warning)).toHaveCount(0);
  }
});

test("in Russian the same warning says the same (providers D262)", async ({ browser }) => {
  const context = await browser.newContext({ locale: "ru-RU" });
  const page = await context.newPage();
  await openApp(page);
  const dialog = await addAccount(page, "nextcloud", RU_ADD_ACCOUNT);
  const address = dialog.getByRole("textbox", { name: "Адрес сервера" });
  await address.fill("http://dav.example.net/");
  await expect(address).toHaveAccessibleDescription(
    "Этот адрес не зашифрован: пароль могут перехватить по дороге. Используйте https://, если сервер его поддерживает.",
  );
  await context.close();
});

test("a calendar subscribed to by its address shows its events, read-only; an address that is no calendar says so (providers D251)", async ({
  page,
}) => {
  const feed = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//Feed//EN\r\nX-WR-CALNAME:Team holidays\r\nBEGIN:VEVENT\r\nUID:offsite\r\nDTSTAMP:20261101T080000Z\r\nDTSTART;TZID=Europe/Vilnius:20261104T120000\r\nDTEND;TZID=Europe/Vilnius:20261104T130000\r\nSUMMARY:Team offsite\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  // The feed's server, at the dev server's proxy: a calendar at one address, a sign-in page at another.
  await page.route("**/dav-proxy/https%3A%2F%2Fcalendar.example.org/**", (route) =>
    route.request().url().endsWith("/team.ics")
      ? route.fulfill({ status: 200, contentType: "text/calendar", body: feed })
      : route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Sign in</title>",
        }),
  );
  await openApp(page);
  const dialog = await addAccount(page);
  await dialog.getByRole("tab", { name: "Subscribe" }).click();
  const panel = dialog.getByRole("tabpanel", { name: "Subscribe" });
  const address = panel.getByRole("textbox", { name: "Calendar address" });
  await address.fill("webcal://calendar.example.org/login");
  await panel.getByRole("button", { name: "Subscribe" }).click();
  await expect(panel.getByRole("alert")).toHaveText(
    "This address answers, but not with a calendar: a web page, or nothing at all.",
  );
  await address.fill("webcal://calendar.example.org/team.ics");
  await panel.getByRole("button", { name: "Subscribe" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(wednesday(page).getByRole("listitem", { name: /^Team offsite, / })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Team holidays" })).toBeChecked();
  // Read-only: its details offer no edit.
  await wednesday(page)
    .getByRole("listitem", { name: /^Team offsite, / })
    .click();
  const details = page.getByRole("dialog", { name: "Team offsite" });
  await expect(details).toBeVisible();
  await expect(details.getByRole("button", { name: "Edit" })).toHaveCount(0);
});
