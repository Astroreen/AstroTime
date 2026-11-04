// The evidence for import (docs/plans/import.md#D265–#D271): Settings'
// "Data" group, the import dialog's preview with a source's problems and
// targets, the question about items already there, and the summary, on a
// phone and a wide screen, in both themes and both languages. Runs only
// when ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots pnpm --filter @astrotime/web e2e import-screenshots
import { expect, test } from "@playwright/test";

import { HOLIDAYS, importFile, NOKIA, OUTLOOK_RU, TAKEOUT, TEAM } from "./import-files.ts";
import { choose, openDemo } from "./support.ts";

const directory = process.env["ASTROTIME_SCREENSHOTS"];
test.skip(!directory, "set ASTROTIME_SCREENSHOTS to a directory to take the screenshots");

const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };
const WORDS = {
  en: {
    locale: "en-US",
    menu: "Main menu",
    settings: "Settings",
    data: "Data",
    entry: /^Import from a file/,
    dialog: "Import",
    start: "Import",
    update: "Use the file's version",
    done: "Imported",
  },
  ru: {
    locale: "ru-RU",
    menu: "Главное меню",
    settings: "Настройки",
    data: "Данные",
    entry: /^Импорт из файла/,
    dialog: "Импорт",
    start: "Импортировать",
    update: "Взять версию из файла",
    done: "Импортировано",
  },
} as const;

for (const language of ["en", "ru"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const [size, viewport] of [
      ["phone", PHONE],
      ["wide", WIDE],
    ] as const) {
      test(`${language} ${theme} ${size}`, async ({ browser }) => {
        const words = WORDS[language];
        const context = await browser.newContext({
          locale: words.locale,
          colorScheme: theme,
          viewport,
          ...(size === "phone" ? { hasTouch: true, isMobile: true } : {}),
          timezoneId: "Europe/Vilnius",
        });
        const page = await context.newPage();
        await openDemo(page, "week");
        if (size === "phone") {
          await page.getByRole("button", { name: words.menu }).click();
          await page
            .getByRole("dialog", { name: words.menu })
            .getByRole("button", { name: words.settings })
            .click();
        } else {
          await page
            .getByRole("navigation", { name: words.menu })
            .getByRole("button", { name: words.settings })
            .click();
        }
        const settings = page.getByRole("dialog", { name: words.settings });
        const data = settings.getByRole("heading", { name: words.data });
        await data.scrollIntoViewIfNeeded();
        await expect(data).toBeVisible();
        const shot = (name: string) =>
          page.screenshot({ path: `${directory}/import-${name}-${language}-${theme}-${size}.png` });
        await shot("settings");

        // The broken file in its language's words: what it mended, what it could not import.
        const file = language === "en" ? TEAM : HOLIDAYS;
        await importFile(page, words.entry, language === "en" ? "team.ics" : "отпуск.ics", file);
        const dialog = page.getByRole("dialog", { name: words.dialog });
        const source = dialog.getByRole("region").first();
        await expect(source).toBeVisible();
        if (language === "ru") await source.locator("summary").click();
        // Into Work, where the demo's design review already is: the question comes (D270).
        else await choose(source.getByRole("combobox").first(), "Work");
        await shot("preview");

        await dialog.getByRole("button", { name: words.start, exact: true }).click();
        if (language === "en") {
          await expect(dialog.getByRole("button", { name: words.update })).toBeVisible();
          await shot("asking");
          await dialog.getByRole("button", { name: words.update }).click();
        }
        await expect(dialog.getByRole("status")).toContainText(words.done);
        await shot("done");
        await context.close();
      });
    }
  }
}

// vCalendar 1.0 and CSV (import D266, D272): a phone's file, what was not
// carried over said; Russian Outlook's CSV, its encoding guessed.
for (const [format, language, theme, size, viewport] of [
  ["vcs", "ru", "light", "phone", PHONE],
  ["vcs", "en", "dark", "wide", WIDE],
  ["csv", "ru", "dark", "phone", PHONE],
  ["takeout", "en", "light", "wide", WIDE],
] as const) {
  test(`${format} ${language} ${theme} ${size}`, async ({ browser }) => {
    const words = WORDS[language];
    const context = await browser.newContext({
      locale: words.locale,
      colorScheme: theme,
      viewport,
      ...(size === "phone" ? { hasTouch: true, isMobile: true } : {}),
      timezoneId: "Europe/Vilnius",
    });
    const page = await context.newPage();
    await openDemo(page, "week");
    if (size === "phone") {
      await page.getByRole("button", { name: words.menu }).click();
      await page
        .getByRole("dialog", { name: words.menu })
        .getByRole("button", { name: words.settings })
        .click();
    } else {
      await page
        .getByRole("navigation", { name: words.menu })
        .getByRole("button", { name: words.settings })
        .click();
    }
    if (format === "vcs") await importFile(page, words.entry, "nokia.vcs", NOKIA);
    else if (format === "csv") await importFile(page, words.entry, "Календарь.csv", OUTLOOK_RU);
    else await importFile(page, words.entry, "Tasks.json", TAKEOUT);
    const dialog = page.getByRole("dialog", { name: words.dialog });
    await expect(dialog.getByRole("region").first()).toBeVisible();
    await page.screenshot({
      path: `${directory}/import-${format}-${language}-${theme}-${size}.png`,
    });
    await context.close();
  });
}

// Export (import D274): a calendar chosen, the file saved, said.
for (const [language, theme, size, viewport] of [
  ["ru", "dark", "phone", PHONE],
  ["en", "light", "wide", WIDE],
] as const) {
  test(`export ${language} ${theme} ${size}`, async ({ browser }) => {
    const words = WORDS[language];
    const context = await browser.newContext({
      locale: words.locale,
      colorScheme: theme,
      viewport,
      ...(size === "phone" ? { hasTouch: true, isMobile: true } : {}),
      timezoneId: "Europe/Vilnius",
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await openDemo(page, "week");
    if (size === "phone") {
      await page.getByRole("button", { name: words.menu }).click();
      await page
        .getByRole("dialog", { name: words.menu })
        .getByRole("button", { name: words.settings })
        .click();
    } else {
      await page
        .getByRole("navigation", { name: words.menu })
        .getByRole("button", { name: words.settings })
        .click();
    }
    await page
      .getByRole("button", { name: language === "en" ? /^Export to a file/ : /^Экспорт в файл/ })
      .click();
    const dialog = page.getByRole("dialog", {
      name: language === "en" ? "Export to a file" : "Экспорт в файл",
    });
    const saving = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: language === "en" ? "Export" : "Экспортировать", exact: true })
      .click();
    await saving;
    await expect(dialog.getByRole("status")).toBeVisible();
    await page.screenshot({ path: `${directory}/export-${language}-${theme}-${size}.png` });
    await context.close();
  });
}
