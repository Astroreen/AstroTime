// Import from a file (docs/plans/import.md#D265–#D271): Settings' "Data"
// group picks a file, the dialog shows what it holds and where it goes,
// asks about the items already there that differ, and writes them through
// the store; the views show them. On a wide screen in English and on a
// phone in Russian.
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { BIG, HOLIDAYS, importFile, NOKIA, OUTLOOK_RU, TAKEOUT, TEAM } from "./import-files.ts";
import { choose, NOW, openDemo, PHONE, WIDE } from "./support.ts";

test("wide, English: a file's events and a task, one already there, into Work and a new list", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("heading", { name: "Data" })).toBeVisible();
  await importFile(page, /^Import from a file/, "team.ics", TEAM);

  const dialog = page.getByRole("dialog", { name: "Import" });
  const team = dialog.getByRole("region", { name: "Team" });
  await expect(team).toContainText("2 events · 1 task · Nov 4 – 6, 2026");
  // No calendar is called Team: the ones new items go to are offered first (D269).
  await expect(team.getByRole("combobox", { name: "Events go to" })).toContainText("Personal");
  await choose(team.getByRole("combobox", { name: "Events go to" }), "Work");
  await choose(
    team.getByRole("combobox", { name: "Tasks go to" }),
    "New list on this device: Team",
  );
  await dialog.getByRole("button", { name: "Import", exact: true }).click();

  // The demo's design review is in Work already, and differs: asked once (D270).
  await expect(dialog.getByRole("alert")).toContainText(
    "1 entry of the file is already in the calendar it goes to",
  );
  await expect(dialog.getByRole("alert")).toContainText(
    "The file's version replaces the one there.",
  );
  await dialog.getByRole("button", { name: "Use the file's version" }).click();
  const done = dialog.getByRole("status");
  await expect(done).toContainText("Imported");
  await expect(done).toContainText("2 events · 1 task");
  await expect(done).toContainText("1 updated");
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await expect(dialog).toBeHidden();

  // The new list is on this device, beside the demo's account (D269).
  await expect(settings.getByRole("region", { name: "On this device" })).toContainText("Team");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // In the views, as if made here.
  await expect(
    page.getByRole("list", { name: "Thursday, November 5" }).getByRole("listitem", {
      name: /^Planning poker/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Wednesday, November 4" }).getByRole("listitem", {
      name: /^Design review \(moved\)/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main menu" }).getByRole("checkbox", { name: "Team" }),
  ).toBeChecked();
});

test("a double tap on Import imports once: one new calendar, each event once", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await importFile(page, /^Import from a file/, "team.ics", TEAM);
  const dialog = page.getByRole("dialog", { name: "Import" });
  const team = dialog.getByRole("region", { name: "Team" });
  await choose(
    team.getByRole("combobox", { name: "Events go to" }),
    "New calendar on this device: Team",
  );
  await choose(
    team.getByRole("combobox", { name: "Tasks go to" }),
    "New list on this device: Team",
  );
  // Two taps in one task, before React draws the button off: only the first imports.
  await dialog.getByRole("button", { name: "Import", exact: true }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(dialog.getByRole("status")).toContainText("2 events · 1 task");
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await expect(settings.getByRole("checkbox", { name: "Team" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("list", { name: "Thursday, November 5" }).getByRole("listitem", {
      name: /^Planning poker/,
    }),
  ).toHaveCount(1);
});

test("a big file with a series, stopped in the middle: what landed stays, the series with it", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  // A clock the test holds: the import gives the page back between batches
  // through a timer, so with time paused it waits there until the test lets it go.
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => localStorage.setItem("astrotime.view", "week"));
  await page.goto("/?demo");
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await importFile(page, /^Import from a file/, "archive.ics", BIG);
  const dialog = page.getByRole("dialog", { name: "Import" });
  const archive = dialog.getByRole("region", { name: "Archive" });
  await expect(archive).toContainText("450 events");
  await choose(
    archive.getByRole("combobox", { name: "Events go to" }),
    "New calendar on this device: Archive",
  );
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  // The first batch written, the run waiting for the page back.
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "200");
  await dialog.getByRole("button", { name: "Stop" }).click();
  await page.clock.resume();
  const done = dialog.getByRole("status");
  await expect(done).toContainText("Stopped. What was imported before stays.");
  await expect(done).toContainText("200 events");
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await expect(settings.getByRole("checkbox", { name: "Archive" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  // The series came in the first batch: its occurrences in the week.
  await expect(
    page.getByRole("list", { name: "Thursday, November 5" }).getByRole("listitem", {
      name: /^Morning run/,
    }),
  ).toBeVisible();
});

test("Google Takeout's tasks: each list a source, into the tasks screen", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  await importFile(page, /^Import from a file/, "Tasks.json", TAKEOUT);
  const dialog = page.getByRole("dialog", { name: "Import" });
  await expect(dialog.getByRole("region", { name: "My Tasks" })).toContainText("2 tasks");
  await expect(dialog.getByRole("region", { name: "Работа" })).toContainText("1 task");
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("3 tasks");
});

test("export a calendar to a file, and import it back: every item already there (import D274)", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  await page.getByRole("button", { name: /^Export to a file/ }).click();
  const dialog = page.getByRole("dialog", { name: "Export to a file" });
  await choose(dialog.getByRole("combobox", { name: "Calendar or list" }), "Work");
  const saving = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const download = await saving;
  expect(download.suggestedFilename()).toBe("Work.ics");
  const text = readFileSync(await download.path(), "utf8");
  expect(text).toContain("X-WR-CALNAME:Work");
  expect(text).toContain("SUMMARY:Design review");
  // The web begins a download: said as begun, not as saved.
  await expect(dialog.getByRole("status")).toContainText("the download of Work.ics has begun");
  await dialog.getByRole("button", { name: "Close" }).last().click();

  await importFile(page, /^Import from a file/, "Work.ics", text);
  const importing = page.getByRole("dialog", { name: "Import" });
  const work = importing.getByRole("region", { name: "Work" });
  // A calendar of its name is there: offered first.
  await expect(work.getByRole("combobox", { name: "Events go to" })).toContainText("Work");
  await importing.getByRole("button", { name: "Import", exact: true }).click();
  await expect(importing.getByRole("status")).toContainText("already there, skipped");
});

test.describe("on a phone, in Russian", () => {
  test.use({ locale: "ru-RU", hasTouch: true, isMobile: true });

  test("a broken file says what it mended and what it could not import, then lands in a new calendar", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openDemo(page, "agenda");
    await page.getByRole("button", { name: "Главное меню" }).click();
    await page
      .getByRole("dialog", { name: "Главное меню" })
      .getByRole("button", { name: "Настройки" })
      .click();
    const settings = page.getByRole("dialog", { name: "Настройки" });
    await expect(settings.getByRole("heading", { name: "Данные" })).toBeVisible();

    // Not a calendar at all: said so, nothing else.
    await importFile(page, /^Импорт из файла/, "вход.ics", "<html><body>Войти</body></html>");
    const dialog = page.getByRole("dialog", { name: "Импорт" });
    await expect(dialog.getByRole("alert")).toContainText("вход.ics — не календарь");
    await dialog.getByRole("button", { name: "Закрыть" }).last().click();
    await expect(dialog).toBeHidden();

    await importFile(page, /^Импорт из файла/, "отпуск.ics", HOLIDAYS);
    const trip = dialog.getByRole("region", { name: "Отпуск" });
    await expect(trip).toContainText("2 события");
    await expect(trip).toContainText(
      "1 запись не удаётся импортировать · 1 запись исправлена для импорта",
    );
    await trip.getByText("1 запись не удаётся импортировать").click();
    await expect(trip.getByRole("listitem")).toHaveText([
      "trip-1: строка была разорвана: соединена",
      "trip-2: не читается",
    ]);
    await choose(
      trip.getByRole("combobox", { name: "События — в" }),
      "Новый календарь на этом устройстве: Отпуск",
    );
    // The whole screen, its bars in sight (design D235).
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBe(PHONE.width);
    await dialog.getByRole("button", { name: "Импортировать" }).click();
    await expect(dialog.getByRole("status")).toContainText("2 события");
    await dialog.getByRole("button", { name: "Закрыть" }).last().click();
    await expect(settings.getByRole("region", { name: "На этом устройстве" })).toContainText(
      "Отпуск",
    );
    await settings.getByRole("button", { name: "Закрыть настройки" }).click();
    await expect(page.getByRole("listitem", { name: /Поездка в Ригу/ }).first()).toBeVisible();
  });

  test("an old phone's vCalendar: its events and task, and what iCalendar has no place for", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openDemo(page, "agenda");
    await page.getByRole("button", { name: "Главное меню" }).click();
    await page
      .getByRole("dialog", { name: "Главное меню" })
      .getByRole("button", { name: "Настройки" })
      .click();
    await importFile(page, /^Импорт из файла/, "nokia.vcs", NOKIA);
    const dialog = page.getByRole("dialog", { name: "Импорт" });
    const phone = dialog.getByRole("region", { name: "nokia" });
    await expect(phone).toContainText("4 события · 1 задача");
    await expect(phone).toContainText("Не перенесено, в iCalendar для этого нет места: PALARM");
    await dialog.getByRole("button", { name: "Импортировать" }).click();
    await expect(dialog.getByRole("status")).toContainText("4 события · 1 задача");
  });

  test("Russian Outlook's CSV: read as Windows-1251, day first, into the views", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openDemo(page, "agenda");
    await page.getByRole("button", { name: "Главное меню" }).click();
    await page
      .getByRole("dialog", { name: "Главное меню" })
      .getByRole("button", { name: "Настройки" })
      .click();
    await importFile(page, /^Импорт из файла/, "Календарь.csv", OUTLOOK_RU);
    const dialog = page.getByRole("dialog", { name: "Импорт" });
    await expect(dialog).toContainText(
      "Файл не указывает кодировку: он прочитан как windows-1251.",
    );
    const source = dialog.getByRole("region", { name: "Календарь" });
    await expect(source).toContainText("2 события · 5–9 нояб. 2026 г.");
    await dialog.getByRole("button", { name: "Импортировать" }).click();
    await expect(dialog.getByRole("status")).toContainText("2 события");
    await dialog.getByRole("button", { name: "Закрыть" }).last().click();
    await page
      .getByRole("dialog", { name: "Настройки" })
      .getByRole("button", { name: "Закрыть настройки" })
      .click();
    await expect(page.getByRole("listitem", { name: /^Планёрка/ }).first()).toBeVisible();
  });
});
