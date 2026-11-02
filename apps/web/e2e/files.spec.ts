// A file of the account's attached from the edit dialog (design D234,
// foundation D231), on a Nextcloud faked behind /dav-proxy/: its
// discovery, one calendar with one event, and its files as a real
// Nextcloud listed them (packages/caldav/test/fixtures/nextcloud-files-*.xml).
// The ATTACH that reaches the server is Nextcloud Calendar's.
//
// With ASTROTIME_SCREENSHOTS naming a directory it also takes the picker's
// screenshots, on a phone and a wide screen, English dark and Russian light.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { addAccount, NOW, PHONE, RU_ADD_ACCOUNT, WIDE } from "./support.ts";

const SERVER = "https://cloud.example.com";
const USER = "astrotime-test";
const HOME = `/remote.php/dav/calendars/${USER}/`;
const CALENDAR = `${HOME}work/`;
const fixture = (name: string) =>
  readFileSync(new URL(`../../../packages/caldav/test/fixtures/${name}`, import.meta.url), "utf8");

const multistatus = (responses: string) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${responses}</d:multistatus>`;
const response = (href: string, prop: string) =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;

const EVENT = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//IDN nextcloud.com//Calendar app 5.5.24//EN",
  "BEGIN:VEVENT",
  "UID:review",
  "DTSTAMP:20261101T080000Z",
  "DTSTART;TZID=Europe/Vilnius:20261104T140000",
  "DTEND;TZID=Europe/Vilnius:20261104T150000",
  "SUMMARY:Quarterly review",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

/** The fake server, behind the dev server's proxy: it keeps what is PUT. */
async function fakeNextcloud(page: Page): Promise<void> {
  let event = { etag: '"1"', ics: EVENT };
  let token = 1;
  await page.route("**/dav-proxy/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname.replace(/^\/dav-proxy\/[^/]+/, ""));
    const method = request.method();
    const xml = (body: string) =>
      route.fulfill({ status: 207, contentType: "application/xml; charset=utf-8", body });
    if (method === "PROPFIND" && (path === "/.well-known/caldav" || path === "/"))
      return xml(
        multistatus(
          response(
            path,
            `<d:current-user-principal><d:href>/remote.php/dav/principals/users/${USER}/</d:href></d:current-user-principal>`,
          ),
        ),
      );
    if (method === "PROPFIND" && path.startsWith("/remote.php/dav/principals/"))
      return xml(
        multistatus(
          response(path, `<c:calendar-home-set><d:href>${HOME}</d:href></c:calendar-home-set>`),
        ),
      );
    if (method === "PROPFIND" && path === HOME)
      return xml(
        multistatus(
          response(HOME, "<d:resourcetype><d:collection/></d:resourcetype>") +
            response(
              CALENDAR,
              `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><d:sync-token>http://sabre.io/ns/sync/${token}</d:sync-token>`,
            ),
        ),
      );
    if (method === "REPORT" && path === CALENDAR)
      return xml(
        multistatus(
          response(
            `${CALENDAR}review.ics`,
            `<d:getetag>${event.etag}</d:getetag><c:calendar-data>${event.ics}</c:calendar-data>`,
          ) + `<d:sync-token>http://sabre.io/ns/sync/${token}</d:sync-token>`,
        ),
      );
    if (method === "PROPFIND" && path === `/remote.php/dav/files/${USER}/`)
      return xml(fixture("nextcloud-files-root.xml"));
    if (method === "PROPFIND" && path === `/remote.php/dav/files/${USER}/Calendar/`)
      return xml(fixture("nextcloud-files-calendar.xml"));
    if (method === "PUT" && path === `${CALENDAR}review.ics`) {
      token += 1;
      event = { etag: `"${token}"`, ics: request.postData() ?? "" };
      return route.fulfill({ status: 204, headers: { ETag: event.etag } });
    }
    return route.fulfill({ status: 404, body: "" });
  });
}

async function signIn(page: Page, language: "en" | "ru") {
  const words = language === "en" ? undefined : RU_ADD_ACCOUNT;
  const dialog = await addAccount(page, "caldav", words);
  await dialog
    .getByRole("textbox", { name: language === "en" ? "Server address" : "Адрес сервера" })
    .fill(SERVER);
  await dialog
    .getByRole("textbox", { name: language === "en" ? "User name" : "Имя пользователя" })
    .fill(USER);
  await dialog.getByLabel(language === "en" ? "Password" : "Пароль").fill("app-password");
  await dialog.getByRole("button", { name: language === "en" ? "Sign in" : "Войти" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("a file of the account's attached from the edit dialog reaches the server as Nextcloud Calendar writes it", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => localStorage.setItem("astrotime.view", "day"));
  await fakeNextcloud(page);
  await page.goto("/");
  await signIn(page, "en");
  const opener = page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Quarterly review, / });
  await opener.click();
  await page
    .getByRole("dialog", { name: "Quarterly review" })
    .getByRole("button", { name: "Edit" })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  await edit.getByRole("button", { name: "From your files" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a file" });
  await picker.getByRole("button", { name: "Calendar" }).click();
  await picker.getByRole("button", { name: /AstroTime fixture\.txt/ }).click();
  await expect(picker).toHaveCount(0);
  const list = edit.getByRole("list", { name: "Attachments" });
  await expect(list.getByRole("listitem")).toHaveText([/AstroTime fixture\.txt.*TXT · 17\sB/]);
  // The item reaches the server with the sync the save starts.
  const uploaded = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/review.ics"),
  );
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toHaveCount(0);

  // Uploaded with the item: Nextcloud Calendar's ATTACH, a link to the file by its id.
  const attach = ((await uploaded).postData() ?? "")
    .replaceAll(/\r\n[ \t]/g, "")
    .split("\r\n")
    .find((line) => line.startsWith("ATTACH"));
  expect(attach).toBe(
    "ATTACH;FMTTYPE=text/plain;FILENAME=/Calendar/AstroTime fixture.txt;SIZE=17;X-NC-FILE-ID=1041771;X-NC-HAS-PREVIEW=true:https://cloud.example.com/index.php/f/1041771",
  );

  // The details show it, a link to the file.
  await opener.click();
  await expect(
    page
      .getByRole("dialog", { name: "Quarterly review" })
      .getByRole("link", { name: /AstroTime fixture\.txt/ }),
  ).toHaveAttribute("href", "https://cloud.example.com/index.php/f/1041771");
});

const directory = process.env["ASTROTIME_SCREENSHOTS"];
for (const [language, theme, size, viewport] of [
  ["en", "dark", "wide", WIDE],
  ["ru", "light", "wide", WIDE],
  ["en", "dark", "phone", PHONE],
  ["ru", "light", "phone", PHONE],
] as const) {
  test(`the file picker's screenshot, ${language} ${theme} ${size}`, async ({ browser }) => {
    test.skip(!directory, "set ASTROTIME_SCREENSHOTS to a directory to take the screenshots");
    const context = await browser.newContext({
      locale: language === "en" ? "en-US" : "ru-RU",
      timezoneId: "Europe/Vilnius",
      colorScheme: theme,
      viewport,
      ...(size === "phone" ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    await page.addInitScript(() => localStorage.setItem("astrotime.view", "day"));
    await fakeNextcloud(page);
    await page.goto("/");
    await signIn(page, language);
    const ru = language === "ru";
    await page.getByRole("button", { name: /^Quarterly review, / }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: ru ? "Изменить" : "Edit" })
      .click();
    await page.getByRole("button", { name: ru ? "Из ваших файлов" : "From your files" }).click();
    const picker = page.getByRole("dialog", { name: ru ? "Выбрать файл" : "Choose a file" });
    await expect(picker.getByRole("button", { name: "Calendar" })).toBeVisible();
    await page.screenshot({
      path: join(directory!, `file-picker-${theme}-${language}-${size}.png`),
    });
    await picker.getByRole("button", { name: "Calendar" }).click();
    await picker.getByRole("button", { name: /AstroTime fixture\.txt/ }).click();
    await expect(picker).toHaveCount(0);
    await page.screenshot({
      path: join(directory!, `editor-file-${theme}-${language}-${size}.png`),
    });
    await context.close();
  });
}
