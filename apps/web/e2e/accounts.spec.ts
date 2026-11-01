// Accounts end to end against a real Radicale (docs/plans/foundation.md#pr-5--calendar-grid,
// D92): the web app signs in by password through the dev server's proxy, syncs
// the server's items into the Week view, follows a change made by another
// client, and says what went wrong in the user's language. Radicale is the
// one the sync package's integration tests start, ready when it says so.
import { test as base, expect, type Page } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { openApp, WIDE } from "./support.ts";

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
  await page.getByRole("button", { name: "Another CalDAV server" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an account" });
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
  await expect(
    page.getByRole("heading", { name: "Your calendars and tasks, from your own server" }),
  ).toBeVisible();

  await signInByPassword(page, radicale);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    wednesday(page).getByRole("listitem", { name: /^Planning with Radicale, / }),
  ).toBeVisible();
  // The drawer: the account, how it synced, and its calendar with its checkbox (design D46).
  const account = page.getByRole("region", { name: `astro@${new URL(radicale.url).host}` });
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

test.describe("in Russian", () => {
  test.use({ locale: "ru-RU" });

  test("a wrong password says so, and nothing is kept", async ({ page, radicale }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Другой сервер CalDAV" }).click();
    const dialog = page.getByRole("dialog", { name: "Добавить аккаунт" });
    await dialog.getByRole("textbox", { name: "Адрес сервера" }).fill(radicale.url);
    await dialog.getByRole("textbox", { name: "Имя пользователя" }).fill(radicale.username);
    await dialog.getByLabel("Пароль").fill("wrong");
    await dialog.getByRole("button", { name: "Войти" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Неверное имя пользователя или пароль.");
    await dialog.getByRole("button", { name: "Отмена" }).click();
    await expect(
      page.getByRole("heading", { name: "Ваши календари и задачи с вашего сервера" }),
    ).toBeVisible();
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
  // No account is left: the first-run screen again.
  await expect(page.getByRole("button", { name: "Sign in to Nextcloud" })).toBeVisible();
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
  await page.getByRole("button", { name: "Sign in to Nextcloud" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an account" });
  await dialog.getByRole("textbox", { name: "Server address" }).fill("cloud.example.com");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "This AstroTime's administrator has not allowed this server.",
  );
});
