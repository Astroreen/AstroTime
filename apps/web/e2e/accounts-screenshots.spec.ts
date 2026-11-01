// The evidence for the accounts and sync PR (docs/plans/foundation.md#pr-5--calendar-grid):
// the first run on the calendar on this device (D122), the add-account dialog, Login Flow's waiting step (Nextcloud
// mocked at the proxy), an error, and an account synced from a real Radicale
// in the drawer, the Week view and the accounts dialog. Runs only when
// ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots pnpm --filter @astrotime/web e2e accounts-screenshots
import { expect, test, type Browser, type Page } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { addAccount, openApp, PHONE, RU_ADD_ACCOUNT, WIDE } from "./support.ts";

const directory = process.env["ASTROTIME_SCREENSHOTS"];
test.skip(!directory, "set ASTROTIME_SCREENSHOTS to a directory to take the screenshots");

const LOCALES = { en: "en-US", ru: "ru-RU" } as const;
type Language = keyof typeof LOCALES;
type Theme = "dark" | "light";

const TEXT = {
  en: {
    add: { accounts: /^Accounts/, add: "Add account", dialog: "Add an account" },
    server: "Server address",
    user: "User name",
    password: "Password",
    signIn: "Sign in",
    continue: "Continue",
    accounts: /^Accounts/,
    menu: "Main menu",
    calendars: { work: "Work", personal: "Personal", tasks: "Tasks" },
    events: ["Planning", "Lunch with Marta", "Code review", "Dentist", "Release notes"],
    task: "Renew the domain",
  },
  ru: {
    add: RU_ADD_ACCOUNT,
    server: "Адрес сервера",
    user: "Имя пользователя",
    password: "Пароль",
    signIn: "Войти",
    continue: "Продолжить",
    accounts: /^Аккаунты/,
    menu: "Главное меню",
    calendars: { work: "Работа", personal: "Личное", tasks: "Задачи" },
    events: ["Планирование", "Обед с Мартой", "Ревью кода", "Стоматолог", "Заметки к релизу"],
    task: "Продлить домен",
  },
} as const;

async function open(
  browser: Browser,
  options: { language: Language; theme: Theme; size: { width: number; height: number } },
): Promise<Page> {
  const context = await browser.newContext({
    locale: LOCALES[options.language],
    colorScheme: options.theme,
    viewport: options.size,
    timezoneId: "Europe/Vilnius",
  });
  const page = await context.newPage();
  await openApp(page);
  return page;
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${directory}/${name}.png`, animations: "disabled" });

/** Radicale with three calendars of the week of November 4 in `language`. */
async function seeded(language: Language): Promise<CalDavServer> {
  const server = await startRadicale();
  const auth = `Basic ${btoa(`${server.username}:${server.password}`)}`;
  const text = TEXT[language];
  const calendar = async (slug: string, name: string, color: string, comps: string[]) => {
    const url = `${server.url}${server.username}/${slug}/`;
    const response = await fetch(url, {
      method: "MKCALENDAR",
      headers: { Authorization: auth, "Content-Type": "application/xml" },
      body: `<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/"><d:set><d:prop><d:displayname>${name}</d:displayname><ic:calendar-color>${color}</ic:calendar-color><c:supported-calendar-component-set>${comps.map((c) => `<c:comp name="${c}"/>`).join("")}</c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`,
    });
    if (response.status !== 201) throw new Error(`MKCALENDAR ${slug}: ${response.status}`);
    return url;
  };
  const put = async (url: string, uid: string, body: string) => {
    const response = await fetch(`${url}${uid}.ics`, {
      method: "PUT",
      headers: { Authorization: auth, "Content-Type": "text/calendar" },
      body: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Another client//EN\r\n${body}END:VCALENDAR\r\n`,
    });
    if (response.status >= 300) throw new Error(`PUT ${uid}: ${response.status}`);
  };
  const event = (uid: string, summary: string, start: string, end: string) =>
    `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261101T080000Z\r\nDTSTART;TZID=Europe/Vilnius:${start}\r\nDTEND;TZID=Europe/Vilnius:${end}\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\n`;
  const work = await calendar("work", text.calendars.work, "#3f7be0ff", ["VEVENT"]);
  const personal = await calendar("personal", text.calendars.personal, "#2f9e6bff", ["VEVENT"]);
  const tasks = await calendar("tasks", text.calendars.tasks, "#d9822bff", ["VTODO"]);
  const [planning, lunch, review, dentist, notes] = text.events;
  await put(work, "planning", event("planning", planning, "20261102T093000", "20261102T110000"));
  await put(personal, "lunch", event("lunch", lunch, "20261103T130000", "20261103T140000"));
  await put(work, "review", event("review", review, "20261104T140000", "20261104T153000"));
  await put(personal, "dentist", event("dentist", dentist, "20261105T083000", "20261105T093000"));
  await put(work, "notes", event("notes", notes, "20261106T110000", "20261106T120000"));
  await put(
    tasks,
    "domain",
    `BEGIN:VTODO\r\nUID:domain\r\nDTSTAMP:20261101T080000Z\r\nDUE;TZID=Europe/Vilnius:20261105T170000\r\nSUMMARY:${text.task}\r\nEND:VTODO\r\n`,
  );
  return server;
}

async function signIn(page: Page, language: Language, server: CalDavServer) {
  const text = TEXT[language];
  const dialog = await addAccount(page, "caldav", text.add);
  await dialog.getByRole("textbox", { name: text.server }).fill(server.url);
  await dialog.getByRole("textbox", { name: text.user }).fill(server.username);
  await dialog.getByLabel(text.password).fill(server.password);
  await dialog.getByRole("button", { name: text.signIn }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("listitem", { name: new RegExp(`^${text.events[2]}, `) }),
  ).toBeVisible();
}

for (const language of ["en", "ru"] as const) {
  test(`the first run and the add-account dialog, ${language}`, async ({ browser }) => {
    const text = TEXT[language];
    for (const theme of language === "en" ? (["dark", "light"] as const) : (["dark"] as const)) {
      const page = await open(browser, { language, theme, size: PHONE });
      await expect(page.getByRole("button", { name: text.accounts })).toBeVisible();
      await shot(page, `first-run-${theme}-${language}-phone`);
      await page.getByRole("button", { name: text.accounts }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot(page, `first-run-accounts-${theme}-${language}-phone`);
      await page.context().close();
    }
    const page = await open(browser, { language, theme: "dark", size: PHONE });
    await addAccount(page, "nextcloud", text.add);
    await page.getByRole("textbox", { name: text.server }).fill("cloud.example.com");
    await shot(page, `sign-in-nextcloud-dark-${language}-phone`);
    await page.getByRole("tab", { name: "CalDAV" }).click();
    await page.getByRole("textbox", { name: text.user }).fill("astro");
    await shot(page, `sign-in-caldav-dark-${language}-phone`);
    await page.context().close();
  });

  test(`Login Flow's waiting step and an error, ${language}`, async ({ browser }) => {
    const text = TEXT[language];
    const page = await open(browser, { language, theme: "dark", size: PHONE });
    // Nextcloud, mocked at the proxy: the flow starts, and waits for an approval that never comes.
    await page
      .context()
      .route("https://cloud.example.com/**", (route) =>
        route.fulfill({ body: "Nextcloud's sign-in page" }),
      );
    await page.route("**/dav-proxy/**", (route) => {
      const url = route.request().url();
      if (url.endsWith("/index.php/login/v2"))
        return route.fulfill({
          json: {
            poll: { token: "t", endpoint: "https://cloud.example.com/login/v2/poll" },
            login: "https://cloud.example.com/login/v2/flow/x",
          },
        });
      return route.fulfill({ status: 404, json: [] });
    });
    await addAccount(page, "nextcloud", text.add);
    await page.getByRole("textbox", { name: text.server }).fill("cloud.example.com");
    await page.getByRole("button", { name: text.continue }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toBeVisible();
    await page.bringToFront();
    await shot(page, `login-flow-waiting-dark-${language}-phone`);
    await page.context().close();

    // A wrong password, from a real Radicale.
    const server = await startRadicale();
    const wrong = await open(browser, { language, theme: "dark", size: PHONE });
    await addAccount(wrong, "caldav", text.add);
    await wrong.getByRole("textbox", { name: text.server }).fill(server.url);
    await wrong.getByRole("textbox", { name: text.user }).fill(server.username);
    await wrong.getByLabel(text.password).fill("wrong");
    await wrong.getByRole("button", { name: text.signIn }).click();
    await expect(wrong.getByRole("alert")).toBeVisible();
    await shot(wrong, `error-wrong-password-dark-${language}-phone`);
    await wrong.context().close();
    await server.stop();
  });

  test(`an account synced from Radicale, ${language}`, async ({ browser }) => {
    const text = TEXT[language];
    const server = await seeded(language);
    for (const theme of language === "en" ? (["dark", "light"] as const) : (["dark"] as const)) {
      const page = await open(browser, { language, theme, size: WIDE });
      await signIn(page, language, server);
      await shot(page, `week-radicale-${theme}-${language}-wide`);
      if (theme === "dark") {
        await page.getByRole("button", { name: text.accounts }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await shot(page, `accounts-sync-status-dark-${language}-wide`);
      }
      await page.context().close();
    }
    const phone = await open(browser, { language, theme: "dark", size: PHONE });
    await signIn(phone, language, server);
    await phone.getByRole("button", { name: text.menu }).click();
    await expect(phone.getByRole("dialog")).toBeVisible();
    await shot(phone, `drawer-account-dark-${language}-phone`);
    await phone.context().close();
    await server.stop();
  });
}
