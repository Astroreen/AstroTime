// The evidence for editing (docs/plans/foundation.md#pr-6--editing): the
// details of an event and of a task, the edit dialog on a phone and on a
// wide screen, the repeat picker, the scope dialog and the Conflicts list,
// in both themes and both languages, from the demo data with the clock
// frozen. Runs only when ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots pnpm --filter @astrotime/web e2e editing-screenshots
import { expect, test, type Browser, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

const directory = process.env["ASTROTIME_SCREENSHOTS"];
test.skip(!directory, "set ASTROTIME_SCREENSHOTS to a directory to take the screenshots");

const LOCALES = { en: "en-US", ru: "ru-RU" } as const;
type Language = keyof typeof LOCALES;
type Theme = "dark" | "light";

const WORDS = {
  en: {
    today: "Wednesday, November 4",
    thursday: "Thursday, November 5",
    review: "Design review",
    report: "Send the report",
    standup: "Stand-up",
    edit: "Edit",
    create: "Create",
    newEvent: "New event",
    editEvent: "Edit event",
    title: "Title",
    repeat: "Repeat",
    custom: "Custom…",
    interval: "Interval",
    monday: "Monday",
    save: "Save",
    scope: "Edit recurring event",
    accounts: /^Accounts/,
    reviewConflicts: "Review",
    conflicts: "Conflicts",
  },
  ru: {
    today: "среда, 4 ноября",
    thursday: "четверг, 5 ноября",
    review: "Обзор дизайна",
    report: "Отправить отчёт",
    standup: "Планёрка",
    edit: "Изменить",
    create: "Создать",
    newEvent: "Новое мероприятие",
    editEvent: "Изменить мероприятие",
    title: "Название",
    repeat: "Повтор",
    custom: "Настроить…",
    interval: "Интервал",
    monday: "Понедельник",
    save: "Сохранить",
    scope: "Изменить повторяющееся мероприятие",
    accounts: /^Аккаунты/,
    reviewConflicts: "Разобрать",
    conflicts: "Конфликты",
  },
} as const;

async function open(
  browser: Browser,
  options: { language: Language; theme: Theme; size: { width: number; height: number } },
  view: "day" | "week",
): Promise<Page> {
  const context = await browser.newContext({
    locale: LOCALES[options.language],
    colorScheme: options.theme,
    viewport: options.size,
    timezoneId: "Europe/Vilnius",
  });
  const page = await context.newPage();
  await openDemo(page, view);
  await expect(
    page.getByRole("list", { name: WORDS[options.language].today }).getByRole("listitem").first(),
  ).toBeVisible();
  return page;
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${directory}/${name}.png`, animations: "disabled" });

for (const language of ["en", "ru"] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`editing, ${language}, ${theme}`, async ({ browser }) => {
      const w = WORDS[language];
      const name = (what: string, size: string) => `${what}-${theme}-${language}-${size}`;

      // On a wide screen: an event's details, its edit dialog, the scope, the conflicts.
      const wide = await open(browser, { language, theme, size: WIDE }, "week");
      await wide
        .getByRole("list", { name: w.today })
        .getByRole("button", { name: new RegExp(`^${w.review}, `) })
        .click();
      const details = wide.getByRole("dialog", { name: w.review });
      await expect(details).toBeVisible();
      await shot(wide, name("details-event", "wide"));
      await details.getByRole("button", { name: w.edit }).click();
      await expect(wide.getByRole("dialog", { name: w.editEvent })).toBeVisible();
      await shot(wide, name("edit", "wide"));
      await wide.keyboard.press("Escape");
      await wide.keyboard.press("Escape");
      await expect(wide.getByRole("dialog")).toHaveCount(0);

      await wide
        .getByRole("list", { name: w.thursday })
        .getByRole("button", { name: new RegExp(`^${w.standup}, `) })
        .click();
      await wide
        .getByRole("dialog", { name: w.standup })
        .getByRole("button", { name: w.edit })
        .click();
      const edit = wide.getByRole("dialog", { name: w.editEvent });
      await edit.getByRole("textbox", { name: w.title }).fill(`${w.standup}!`);
      await edit.getByRole("button", { name: w.save }).click();
      await expect(wide.getByRole("alertdialog", { name: w.scope })).toBeVisible();
      await shot(wide, name("scope", "wide"));
      await wide.keyboard.press("Escape");
      await wide.keyboard.press("Escape");
      await wide.keyboard.press("Escape");
      await expect(wide.getByRole("dialog")).toHaveCount(0);

      await wide.getByRole("button", { name: w.accounts }).click();
      await wide.getByRole("button", { name: w.reviewConflicts }).click();
      await expect(wide.getByRole("dialog", { name: w.conflicts })).toBeVisible();
      await shot(wide, name("conflicts", "wide"));
      await wide.context().close();

      // On a phone: a task's details, the edit dialog, the repeat picker.
      const phone = await open(browser, { language, theme, size: PHONE }, "day");
      await phone
        .getByRole("list", { name: w.today })
        .getByRole("button", { name: new RegExp(w.report) })
        .click();
      await expect(phone.getByRole("dialog", { name: w.report })).toBeVisible();
      await shot(phone, name("details-task", "phone"));
      await phone.keyboard.press("Escape");
      await expect(phone.getByRole("dialog")).toHaveCount(0);
      await phone.getByRole("button", { name: w.create }).click();
      const create = phone.getByRole("dialog", { name: w.newEvent });
      await create
        .getByRole("textbox", { name: w.title })
        .fill(language === "en" ? "Swimming" : "Бассейн");
      await shot(phone, name("edit", "phone"));
      await create.getByLabel(w.repeat, { exact: true }).selectOption({ label: w.custom });
      await create.getByLabel(w.interval, { exact: true }).fill("2");
      await create.getByRole("button", { name: w.monday }).click();
      await create.getByLabel(w.repeat, { exact: true }).scrollIntoViewIfNeeded();
      await shot(phone, name("repeat", "phone"));
      await phone.context().close();
    });
  }
}
