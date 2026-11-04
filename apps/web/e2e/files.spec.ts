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

import { addAccount, choose, NOW, PHONE, RU_ADD_ACCOUNT, WIDE } from "./support.ts";

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

/** The fake server, behind the dev server's proxy: it keeps what is PUT, the files uploaded by path. */
async function fakeNextcloud(
  page: Page,
  /** What an upload's answer waits for, to hold it while the test acts. */
  uploadAnswered: Promise<void> = Promise.resolve(),
): Promise<Map<string, Buffer>> {
  const uploaded = new Map<string, Buffer>();
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
    // An upload from the device (foundation D232): the folder is there, the
    // file is kept as sent and listed with an id of its own.
    if (method === "MKCOL" && path === `/remote.php/dav/files/${USER}/Calendar`)
      return route.fulfill({ status: 405, body: "" });
    if (method === "PUT" && path.startsWith(`/remote.php/dav/files/${USER}/Calendar/`)) {
      uploaded.set(path, request.postDataBuffer() ?? Buffer.alloc(0));
      await uploadAnswered;
      return route.fulfill({ status: 201, body: "" });
    }
    if (method === "PROPFIND" && uploaded.has(path))
      return xml(
        `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"><d:response><d:href>${encodeURI(path)}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontenttype>text/plain</d:getcontenttype><d:getcontentlength>${uploaded.get(path)!.length}</d:getcontentlength><oc:fileid>5005</oc:fileid><nc:has-preview>false</nc:has-preview></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
      );
    if (method === "PUT" && path === `${CALENDAR}review.ics`) {
      token += 1;
      event = { etag: `"${token}"`, ics: request.postData() ?? "" };
      return route.fulfill({ status: 204, headers: { ETag: event.etag } });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  return uploaded;
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

test("a file from the device is uploaded to /Calendar and attached as Nextcloud Calendar's (foundation D232)", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => localStorage.setItem("astrotime.view", "day"));
  const uploaded = await fakeNextcloud(page);
  await page.goto("/");
  await signIn(page, "en");
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Quarterly review, / })
    .click();
  await page
    .getByRole("dialog", { name: "Quarterly review" })
    .getByRole("button", { name: "Edit" })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  // The system's file dialog, answered for the user.
  const chooser = page.waitForEvent("filechooser");
  await edit.getByRole("button", { name: "From this device" }).click();
  await (
    await chooser
  ).setFiles({
    name: "minutes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Minutes\n\u00ff\u0000", "latin1"),
  });
  const list = edit.getByRole("list", { name: "Attachments" });
  await expect(list.getByRole("listitem")).toHaveText([/minutes\.txt.*TXT · 10\sB/]);
  // The bytes reached the server as they were.
  expect([...uploaded.entries()].map(([path, bytes]) => [path, [...bytes]])).toEqual([
    [
      `/remote.php/dav/files/${USER}/Calendar/minutes.txt`,
      [...Buffer.from("Minutes\n\u00ff\u0000", "latin1")],
    ],
  ]);
  const saved = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/review.ics"),
  );
  await edit.getByRole("button", { name: "Save" }).click();
  // Unfolded (RFC 5545 §3.1): a long line is written over two.
  expect(((await saved).postData() ?? "").replaceAll(/\r\n[ \t]/g, "")).toContain(
    "ATTACH;FMTTYPE=text/plain;FILENAME=/Calendar/minutes.txt;SIZE=10;X-NC-FILE-ID=5005;X-NC-HAS-PREVIEW=false:https://cloud.example.com/index.php/f/5005",
  );
});

test("what the user changes while a file uploads stays: the file joins the list as it is then (design D232)", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => localStorage.setItem("astrotime.view", "day"));
  let answer!: () => void;
  const held = new Promise<void>((resolve) => (answer = resolve));
  await fakeNextcloud(page, held);
  await page.goto("/");
  await signIn(page, "en");
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Quarterly review, / })
    .click();
  await page
    .getByRole("dialog", { name: "Quarterly review" })
    .getByRole("button", { name: "Edit" })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  const chooser = page.waitForEvent("filechooser");
  await edit.getByRole("button", { name: "From this device" }).click();
  await (
    await chooser
  ).setFiles({ name: "minutes.txt", mimeType: "text/plain", buffer: Buffer.from("Minutes") });
  // The server holds its answer; meanwhile a link is added and the title changed.
  await expect(edit.getByRole("status")).toHaveText("Uploading minutes.txt…");
  await edit.getByRole("button", { name: "Add a link" }).click();
  await edit.getByRole("textbox", { name: "Link" }).fill("example.org/agenda");
  await edit.getByRole("textbox", { name: "Link" }).press("Enter");
  await edit.getByRole("textbox", { name: "Title" }).fill("Quarterly review, v2");
  answer();
  const list = edit.getByRole("list", { name: "Attachments" });
  await expect(list.getByRole("listitem")).toHaveText([/example\.org\/agenda/, /minutes\.txt/]);
  await expect(edit.getByRole("textbox", { name: "Title" })).toHaveValue("Quarterly review, v2");
});

test("an item moved to another account while its file uploads: not attached, said so; back, attached (D232)", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => localStorage.setItem("astrotime.view", "day"));
  let answer!: () => void;
  const held = new Promise<void>((resolve) => (answer = resolve));
  await fakeNextcloud(page, held);
  await page.goto("/");
  await signIn(page, "en");
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Quarterly review, / })
    .click();
  await page
    .getByRole("dialog", { name: "Quarterly review" })
    .getByRole("button", { name: "Edit" })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  const chooser = page.waitForEvent("filechooser");
  await edit.getByRole("button", { name: "From this device" }).click();
  await (
    await chooser
  ).setFiles({ name: "minutes.txt", mimeType: "text/plain", buffer: Buffer.from("Minutes") });
  await expect(edit.getByRole("status")).toHaveText("Uploading minutes.txt…");
  // Meanwhile the item goes to the calendar on this device, which has no files.
  await choose(edit.getByRole("combobox", { name: "Calendar" }), "Personal");
  answer();
  await expect(edit.getByRole("alert")).toHaveText(
    "minutes.txt was uploaded to the Calendar folder of your files, but is not attached while the item is in another account's calendar: move it back to attach it.",
  );
  await expect(edit.getByRole("list", { name: "Attachments" })).toHaveCount(0);
  // Back in the account the file went to: attached after all, the alert gone.
  await choose(edit.getByRole("combobox", { name: "Calendar" }), "Work");
  await expect(edit.getByRole("list", { name: "Attachments" }).getByRole("listitem")).toHaveText([
    /minutes\.txt/,
  ]);
  await expect(edit.getByRole("alert")).toHaveCount(0);
});

test("a bare name.ext is no link: tried, the field says to put https:// before it (design D233)", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => localStorage.setItem("astrotime.view", "day"));
  await fakeNextcloud(page);
  await page.goto("/");
  await signIn(page, "en");
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Quarterly review, / })
    .click();
  await page
    .getByRole("dialog", { name: "Quarterly review" })
    .getByRole("button", { name: "Edit" })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  await edit.getByRole("button", { name: "Add a link" }).click();
  const link = edit.getByRole("textbox", { name: "Link" });
  const hint = edit.getByText("Not a web link yet: put https:// before it.");
  // Not while typing, nor for what is no bare name.
  await link.fill("1234");
  await link.press("Enter");
  await expect(hint).toHaveCount(0);
  await link.fill("report.pdf");
  await expect(edit.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await expect(hint).toHaveCount(0);
  // Tried: Enter says what makes it a link.
  await link.press("Enter");
  await expect(hint).toBeVisible();
  // Said to the field: its description, in a live region.
  await expect(link).toHaveAccessibleDescription("Not a web link yet: put https:// before it.");
  await expect(hint).toHaveAttribute("aria-live", "polite");
  await link.fill("https://example.org/report.pdf");
  await expect(hint).toHaveCount(0);
  await expect(edit.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  // A site's name alone is a link.
  await link.fill("example.org");
  await expect(edit.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
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

// The owner's 3 (round 5): "Add a link" hid the other ways (design D237).
test("the three ways stay in sight: with a link being typed, files and the device are one tap away", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => localStorage.setItem("astrotime.view", "day"));
  await fakeNextcloud(page);
  await page.goto("/");
  await signIn(page, "en");
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Quarterly review, / })
    .click();
  await page
    .getByRole("dialog", { name: "Quarterly review" })
    .getByRole("button", { name: "Edit" })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  const files = edit.getByRole("button", { name: "From your files" });
  const device = edit.getByRole("button", { name: "From this device" });
  await expect(files).toBeEnabled();
  await expect(device).toBeEnabled();

  await edit.getByRole("button", { name: "Add a link" }).click();
  const link = edit.getByRole("textbox", { name: "Link" });
  await expect(link).toBeFocused();
  await expect(files).toBeEnabled();
  await expect(device).toBeEnabled();
  // Cancel goes back to the three, nothing added.
  await link.fill("example.org/half");
  await edit.getByRole("button", { name: "Cancel" }).click();
  await expect(link).toHaveCount(0);
  await expect(edit.getByRole("list", { name: "Attachments" })).toHaveCount(0);

  // From the link's field straight to the files.
  await edit.getByRole("button", { name: "Add a link" }).click();
  await files.click();
  await expect(page.getByRole("dialog", { name: "Choose a file" })).toBeVisible();
});

for (const [language, words] of [
  [
    "en",
    {
      create: "Create",
      event: /^New (event|task)$/,
      task: "Task",
      files: "From your files",
      device: "From this device",
      calendar: "Files need a Nextcloud account: this calendar is on this device.",
      list: "Files need a Nextcloud account: this list is on this device.",
    },
  ],
  [
    "ru",
    {
      create: "Создать",
      event: /^(Новое мероприятие|Новая задача)$/,
      task: "Задача",
      files: "Из ваших файлов",
      device: "С этого устройства",
      calendar: "Файлы есть только у аккаунта Nextcloud: этот календарь — на этом устройстве.",
      list: "Файлы есть только у аккаунта Nextcloud: этот список — на этом устройстве.",
    },
  ],
] as const) {
  test.describe(language, () => {
    test.use({ locale: language === "en" ? "en-US" : "ru-RU" });

    // The calendar on this device keeps no files: the ways are there, off, with why (design D237).
    test("on the calendar on this device the file ways are off and say why", async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.clock.setFixedTime(NOW);
      await page.goto("/");
      await page.getByRole("button", { name: words.create }).click();
      const edit = page.getByRole("dialog", { name: words.event });
      const files = edit.getByRole("button", { name: words.files });
      const device = edit.getByRole("button", { name: words.device });
      await expect(files).toBeDisabled();
      await expect(device).toBeDisabled();
      await expect(files).toHaveAccessibleDescription(words.calendar);
      await expect(edit.getByText(words.calendar)).toBeVisible();
      // A task's calendar is its list (design D236).
      await edit.getByRole("radio", { name: words.task }).click();
      await expect(device).toHaveAccessibleDescription(words.list);
    });
  });
}

// A Nextcloud whose sync is off keeps its files, but AstroTime does not
// reach them: the file ways say so (design D237), in both languages.
for (const language of ["en", "ru"] as const) {
  test(`a Nextcloud account with its sync off turns the file ways off and says why, ${language}`, async ({
    browser,
  }) => {
    const ru = language === "ru";
    const context = await browser.newContext({
      locale: ru ? "ru-RU" : "en-US",
      timezoneId: "Europe/Vilnius",
      viewport: WIDE,
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    await page.addInitScript(() => localStorage.setItem("astrotime.view", "day"));
    await fakeNextcloud(page);
    await page.goto("/");
    await signIn(page, language);
    await page
      .getByRole("navigation", { name: ru ? "Главное меню" : "Main menu" })
      .getByRole("button", { name: ru ? "Настройки" : "Settings" })
      .click();
    const settings = page.getByRole("dialog", { name: ru ? "Настройки" : "Settings" });
    await settings
      .getByRole("region", { name: `${USER}@cloud.example.com` })
      .getByRole("switch", { name: ru ? "Синхронизация" : "Sync" })
      .click();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();

    await page.getByRole("button", { name: /^Quarterly review, / }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: ru ? "Изменить" : "Edit" })
      .click();
    const edit = page.getByRole("dialog", { name: ru ? "Изменить мероприятие" : "Edit event" });
    const files = edit.getByRole("button", { name: ru ? "Из ваших файлов" : "From your files" });
    await expect(files).toBeDisabled();
    await expect(files).toHaveAccessibleDescription(
      ru
        ? "Для файлов включите синхронизацию этого аккаунта в настройках."
        : "Files need this account's sync on, in Settings.",
    );
    await context.close();
  });
}
