// The evidence for editing (docs/plans/foundation.md#pr-6--editing): the
// details of an event and of a task, the edit dialog on a phone and on a
// wide screen, the repeat picker, the scope dialog and the Conflicts list,
// AstroTime's own dropdowns open (design D167; on a phone by touch), in both themes and both languages, from the demo data with the clock
// frozen. Runs only when ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots pnpm --filter @astrotime/web e2e editing-screenshots
import { expect, test, type Browser, type Page } from "@playwright/test";

import { choose, openDemo, PHONE, WIDE } from "./support.ts";

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
    startTime: "Start time",
    twoPm: "2:00 PM",
    menu: "Main menu",
    settings: "Settings",
    language: "Language",
    repeat: "Repeat",
    custom: "Custom…",
    interval: "Interval",
    monday: "Monday",
    save: "Save",
    scope: "Edit recurring event",
    accounts: /^Accounts/,
    reviewConflicts: "Review",
    conflicts: "Conflicts",
    task: "Task",
    newTask: "New task",
    addDue: "Add due",
    dueDate: "Due date",
    startDate: "Start date",
    pack: "Pack the bags",
    description: "Description",
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
    startTime: "Время начала",
    twoPm: "14:00",
    menu: "Главное меню",
    settings: "Настройки",
    language: "Язык",
    repeat: "Повтор",
    custom: "Настроить…",
    interval: "Интервал",
    monday: "Понедельник",
    save: "Сохранить",
    scope: "Изменить повторяющееся мероприятие",
    accounts: /^Аккаунты/,
    reviewConflicts: "Разобрать",
    conflicts: "Конфликты",
    task: "Задача",
    newTask: "Новая задача",
    addDue: "Добавить срок",
    dueDate: "Дата срока",
    startDate: "Дата начала",
    pack: "Собрать вещи",
    description: "Описание",
  },
} as const;

async function open(
  browser: Browser,
  options: {
    language: Language;
    theme: Theme;
    size: { width: number; height: number };
    touch?: boolean;
  },
  view: "day" | "week",
): Promise<Page> {
  const context = await browser.newContext({
    locale: LOCALES[options.language],
    colorScheme: options.theme,
    viewport: options.size,
    timezoneId: "Europe/Vilnius",
    // A phone is touched: the dropdowns' rows are a finger's (design D167).
    ...(options.size === PHONE || options.touch ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await context.newPage();
  await openDemo(page, view);
  await expect(
    page.getByRole("list", { name: WORDS[options.language].today }).getByRole("listitem").first(),
  ).toBeVisible();
  return page;
}

/** A screenshot once Base UI's popups have finished entering or leaving. */
async function shot(page: Page, name: string): Promise<void> {
  await expect(page.locator("[data-starting-style], [data-ending-style]")).toHaveCount(0);
  await page.screenshot({ path: `${directory}/${name}.png`, animations: "disabled" });
}

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
      const editing = wide.getByRole("dialog", { name: w.editEvent });
      await expect(editing).toBeVisible();
      await shot(wide, name("edit", "wide"));
      await editing.getByRole("combobox", { name: w.startTime }).click();
      await expect(wide.getByRole("listbox")).toBeVisible();
      await shot(wide, name("dropdown-time", "wide"));
      await wide.keyboard.press("Escape");
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
      await create.getByRole("combobox", { name: w.repeat }).tap();
      await expect(phone.getByRole("listbox")).toBeVisible();
      await shot(phone, name("dropdown-repeat", "phone"));
      await phone.getByRole("option").first().tap();
      await expect(phone.getByRole("listbox")).toHaveCount(0);
      await choose(create.getByLabel(w.repeat, { exact: true }), w.custom);
      await create.getByLabel(w.interval, { exact: true }).fill("2");
      await create.getByRole("button", { name: w.monday }).click();
      await create.getByLabel(w.repeat, { exact: true }).scrollIntoViewIfNeeded();
      await shot(phone, name("repeat", "phone"));
      await phone.keyboard.press("Escape");
      await expect(phone.getByRole("dialog")).toHaveCount(0);

      // Settings' dropdowns on a phone.
      await phone.getByRole("button", { name: w.menu }).tap();
      await phone.getByRole("dialog").getByRole("button", { name: w.settings }).tap();
      await phone.getByRole("dialog", { name: w.settings }).getByLabel(w.language).tap();
      await expect(phone.getByRole("listbox")).toBeVisible();
      await shot(phone, name("dropdown-settings", "phone"));
      await phone.context().close();
    });
  }
}

/** A phone held in the hand, as the owner tests on: a touch screen. */
const TOUCH_PHONE = { width: 390, height: 844 };

for (const language of ["en", "ru"] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`a task's time (design D159), ${language}, ${theme}`, async ({ browser }) => {
      const w = WORDS[language];
      const name = (what: string, size: string) => `${what}-${theme}-${language}-${size}`;

      // On a phone: a task from "+", its start as an event's, then its due.
      const phone = await open(browser, { language, theme, size: TOUCH_PHONE, touch: true }, "day");
      await phone.getByRole("button", { name: w.create }).click();
      await phone
        .getByRole("dialog", { name: w.newEvent })
        .getByRole("radio", { name: w.task })
        .click();
      const task = phone.getByRole("dialog", { name: w.newTask });
      await task.getByRole("textbox", { name: w.title }).fill(w.pack);
      await shot(phone, name("task-new", "phone"));
      await task.getByRole("button", { name: w.addDue }).click();
      await task.getByLabel(w.dueDate).fill("2026-11-06");
      await shot(phone, name("task-due", "phone"));
      // Its last fields: no status, priority, progress or tags (design D162).
      await task.getByRole("textbox", { name: w.description }).scrollIntoViewIfNeeded();
      await shot(phone, name("task-fields", "phone"));
      await task.getByRole("button", { name: w.save }).click();
      await expect(task).toHaveCount(0);
      await shot(phone, name("task-chip", "phone"));
      await phone.context().close();

      // On a wide screen: the same task in the week, a chip at its start.
      const wide = await open(browser, { language, theme, size: WIDE }, "week");
      await wide.getByRole("button", { name: w.create }).click();
      await wide
        .getByRole("dialog", { name: w.newEvent })
        .getByRole("radio", { name: w.task })
        .click();
      const wideTask = wide.getByRole("dialog", { name: w.newTask });
      await wideTask.getByRole("textbox", { name: w.title }).fill(w.pack);
      await wideTask.getByLabel(w.startDate).fill("2026-11-05");
      await choose(wideTask.getByLabel(w.startTime), w.twoPm);
      await wideTask.getByRole("button", { name: w.addDue }).click();
      await wideTask.getByLabel(w.dueDate).fill("2026-11-07");
      await shot(wide, name("task-due", "wide"));
      await wideTask.getByRole("button", { name: w.save }).click();
      await expect(wideTask).toHaveCount(0);
      await shot(wide, name("task-chip", "wide"));
      await wide.context().close();
    });
  }
}

const MENU = {
  en: { more: "More actions", copy: "Make a copy", copyTo: "Copy to…", newEvent: "New event" },
  ru: {
    more: "Ещё",
    copy: "Сделать копию",
    copyTo: "Копировать в…",
    newEvent: "Новое мероприятие",
  },
} as const;

for (const language of ["en", "ru"] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`the actions menu (design D163, D164), ${language}, ${theme}`, async ({ browser }) => {
      const w = WORDS[language];
      const m = MENU[language];
      const name = (what: string, size: string) => `${what}-${theme}-${language}-${size}`;

      // On a phone: the menu open, then the copy's notice.
      const phone = await open(browser, { language, theme, size: TOUCH_PHONE, touch: true }, "day");
      await phone
        .getByRole("list", { name: w.today })
        .getByRole("button", { name: new RegExp(`^${w.review}, `) })
        .click();
      const details = phone.getByRole("dialog", { name: w.review });
      await details.getByRole("button", { name: m.more }).click();
      await expect(phone.getByRole("menuitem", { name: m.copy })).toBeVisible();
      await shot(phone, name("menu", "phone"));
      await phone.getByRole("menuitem", { name: m.copy }).click();
      await expect(phone.getByRole("status").getByRole("button").first()).toBeVisible();
      await shot(phone, name("copied", "phone"));
      await phone.context().close();

      // On a wide screen: "Copy to…", the dialog filled from the item.
      const wide = await open(browser, { language, theme, size: WIDE }, "week");
      await wide
        .getByRole("list", { name: w.today })
        .getByRole("button", { name: new RegExp(`^${w.review}, `) })
        .click();
      const wideDetails = wide.getByRole("dialog", { name: w.review });
      await wideDetails.getByRole("button", { name: m.more }).click();
      await shot(wide, name("menu", "wide"));
      await wide.getByRole("menuitem", { name: m.copyTo }).click();
      await expect(wide.getByRole("dialog", { name: m.newEvent })).toBeVisible();
      await shot(wide, name("copy-to", "wide"));
      await wide.context().close();
    });
  }
}
