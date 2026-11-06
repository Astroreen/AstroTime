// The evidence for quick create and the lighter editor (design D296, D297):
// the sheet on a phone and the popover by its slot on a wide screen, for an
// event and a task, then the edit dialog it expands to and an existing
// event's, in both themes and both languages, from the demo data with the
// clock frozen. Runs only when ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots pnpm --filter @astrotime/web e2e quick-create-screenshots
import { expect, test, type Browser, type Page } from "@playwright/test";

import { expand, openDemo, PHONE, quickCreate, WIDE } from "./support.ts";

const directory = process.env["ASTROTIME_SCREENSHOTS"];
test.skip(!directory, "set ASTROTIME_SCREENSHOTS to a directory to take the screenshots");

const LOCALES = { en: "en-US", ru: "ru-RU" } as const;

const WORDS = {
  en: {
    today: "Wednesday, November 4",
    thursday: "Thursday, November 5",
    review: "Design review",
    edit: "Edit",
    editEvent: "Edit event",
    create: "Create",
    title: "Title",
    task: "Task",
    swimming: "Swimming",
    call: "Call the plumber",
    meeting: "Planning",
  },
  ru: {
    today: "среда, 4 ноября",
    thursday: "четверг, 5 ноября",
    review: "Обзор дизайна",
    edit: "Изменить",
    editEvent: "Изменить мероприятие",
    create: "Создать",
    title: "Название",
    task: "Задача",
    swimming: "Бассейн",
    call: "Позвонить сантехнику",
    meeting: "Планирование",
  },
} as const;

async function open(
  browser: Browser,
  language: keyof typeof LOCALES,
  theme: "dark" | "light",
  size: typeof PHONE | typeof WIDE,
): Promise<Page> {
  const context = await browser.newContext({
    locale: LOCALES[language],
    colorScheme: theme,
    viewport: size,
    timezoneId: "Europe/Vilnius",
    ...(size === PHONE ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await context.newPage();
  await openDemo(page, size === PHONE ? "day" : "week");
  await expect(
    page.getByRole("list", { name: WORDS[language].today }).getByRole("listitem").first(),
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
    test(`the sheet and the editor on a phone, ${language}, ${theme}`, async ({ browser }) => {
      const w = WORDS[language];
      const name = (what: string, size: string) => `${what}-${theme}-${language}-${size}`;

      // A phone: the sheet for an event, for a task, then the editor it expands to.
      const phone = await open(browser, language, theme, PHONE);
      await phone.getByRole("button", { name: w.create }).click();
      const sheet = quickCreate(phone, language);
      await sheet.getByRole("textbox", { name: w.title }).fill(w.swimming);
      await shot(phone, name("quick", "phone"));
      await sheet.getByRole("radio", { name: w.task }).click();
      await sheet.getByRole("textbox", { name: w.title }).fill(w.call);
      await shot(phone, name("quick-task", "phone"));
      await expand(phone, language);
      await shot(phone, name("editor-new", "phone"));
      await phone.context().close();
    });

    test(`the popover and the editor on a wide screen, ${language}, ${theme}`, async ({
      browser,
    }) => {
      const w = WORDS[language];
      const name = (what: string, size: string) => `${what}-${theme}-${language}-${size}`;
      // The popover by a tapped slot, the editor it expands to, an event's editor.
      const wide = await open(browser, language, theme, WIDE);
      const thursday = wide.getByRole("list", { name: w.thursday });
      const box = (await thursday.boundingBox())!;
      await thursday.click({ position: { x: box.width - 10, y: 14.25 * 56 } });
      const popover = quickCreate(wide, language);
      await popover.getByRole("textbox", { name: w.title }).fill(w.meeting);
      await shot(wide, name("quick", "wide"));
      await expand(wide, language);
      await shot(wide, name("editor-new", "wide"));
      await wide.keyboard.press("Escape");
      await expect(wide.getByRole("dialog")).toHaveCount(0);
      await wide
        .getByRole("list", { name: w.today })
        .getByRole("button", { name: new RegExp(`^${w.review}, `) })
        .click();
      await wide
        .getByRole("dialog", { name: w.review })
        .getByRole("button", { name: w.edit })
        .click();
      await expect(wide.getByRole("dialog", { name: w.editEvent })).toBeVisible();
      await shot(wide, name("editor-edit", "wide"));
      await wide.context().close();
    });
  }
}
