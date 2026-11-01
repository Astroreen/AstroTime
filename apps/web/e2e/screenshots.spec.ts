// The evidence for a UI pull request (docs/plans/foundation.md#pr-5--calendar-grid):
// every view in both themes and both languages, from the demo data with the
// clock frozen. Runs only when ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots pnpm --filter @astrotime/web e2e screenshots
import { expect, test, type Browser, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

const directory = process.env["ASTROTIME_SCREENSHOTS"];
test.skip(!directory, "set ASTROTIME_SCREENSHOTS to a directory to take the screenshots");

const LOCALES = { en: "en-US", ru: "ru-RU" } as const;
type Language = keyof typeof LOCALES;
type Theme = "dark" | "light";

async function open(
  browser: Browser,
  options: { language: Language; theme: Theme; size: { width: number; height: number } },
  view: "day" | "3days" | "week" | "month" | "agenda",
): Promise<Page> {
  const context = await browser.newContext({
    locale: LOCALES[options.language],
    colorScheme: options.theme,
    viewport: options.size,
    timezoneId: "Europe/Vilnius",
  });
  const page = await context.newPage();
  await openDemo(page, view);
  // The demo's first item of the day is drawn: the store is read.
  await expect(
    page
      .getByRole("list", { name: /4|ноября/ })
      .getByRole("listitem")
      .first(),
  ).toBeVisible();
  return page;
}

const shot = (page: Page, name: string) =>
  // Transitions run to their end, so a popover is shown open, not fading in.
  page.screenshot({ path: `${directory}/${name}.png`, animations: "disabled" });

for (const language of ["en", "ru"] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`views, ${language}, ${theme}`, async ({ browser }) => {
      for (const view of ["day", "3days", "week"] as const) {
        const page = await open(browser, { language, theme, size: PHONE }, view);
        await shot(page, `${view}-${theme}-${language}-phone`);
        await page.context().close();
      }
      const page = await open(browser, { language, theme, size: WIDE }, "week");
      await shot(page, `week-${theme}-${language}-wide`);
      await page.context().close();
    });
  }
}

for (const language of ["en", "ru"] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`Month and Agenda, ${language}, ${theme}`, async ({ browser }) => {
      for (const view of ["month", "agenda"] as const) {
        const page = await open(browser, { language, theme, size: PHONE }, view);
        await shot(page, `${view}-${theme}-${language}-phone`);
        await page.context().close();
      }
      const page = await open(browser, { language, theme, size: WIDE }, "month");
      await shot(page, `month-${theme}-${language}-wide`);
      await page.context().close();
    });
  }
}

test("the strip expanded, the undone tasks, the drawer and the month picker", async ({
  browser,
}) => {
  for (const language of ["en", "ru"] as const) {
    const page = await open(browser, { language, theme: "dark", size: PHONE }, "day");
    await page.getByRole("button", { name: /all-day|на весь день/ }).click();
    await shot(page, `day-strip-expanded-dark-${language}-phone`);
    await page.getByRole("button", { name: /undone|невыполн/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await shot(page, `undone-open-dark-${language}-phone`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Main menu|Главное меню/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await shot(page, `drawer-dark-${language}-phone`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^(November|Ноябрь), / }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await shot(page, `month-picker-dark-${language}-phone`);
    await page.context().close();
  }
});

test("the tasks screen, its panel, the settings and search (design D52, D53)", async ({
  browser,
}) => {
  for (const language of ["en", "ru"] as const) {
    const tasks = language === "en" ? "Tasks" : "Задачи";
    const completed = language === "en" ? /^Completed/ : /^Выполненные/;
    for (const theme of ["dark", "light"] as const) {
      const page = await open(browser, { language, theme, size: PHONE }, "day");
      await page.getByRole("button", { name: tasks, exact: true }).click();
      const panel = page.getByRole("region", { name: tasks });
      await panel.getByRole("tab", { name: new RegExp(`^${tasks}`) }).click();
      await expect(panel.getByRole("checkbox").first()).toBeVisible();
      await shot(page, `tasks-${theme}-${language}-phone`);
      if (theme === "dark") {
        await panel.getByRole("button", { name: completed }).click();
        await expect(panel.getByRole("checkbox", { checked: true }).first()).toBeVisible();
        await shot(page, `tasks-completed-${theme}-${language}-phone`);
      }
      await page.context().close();
    }
    const wide = await open(
      browser,
      { language, theme: language === "en" ? "dark" : "light", size: WIDE },
      "week",
    );
    await wide.getByRole("button", { name: tasks, exact: true }).click();
    await expect(
      wide.getByRole("region", { name: tasks }).getByRole("checkbox").first(),
    ).toBeVisible();
    await shot(wide, `tasks-panel-${language === "en" ? "dark" : "light"}-${language}-wide`);
    await wide.context().close();

    const page = await open(browser, { language, theme: "dark", size: PHONE }, "day");
    await page
      .getByRole("button", { name: language === "en" ? "Main menu" : "Главное меню" })
      .click();
    const settings = page.getByRole("region", {
      name: language === "en" ? "Settings" : "Настройки",
    });
    await settings.scrollIntoViewIfNeeded();
    await expect(settings).toBeInViewport();
    await shot(page, `settings-dark-${language}-phone`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: language === "en" ? "Search" : "Поиск" }).click();
    await page.getByRole("searchbox").fill(language === "en" ? "the" : "на");
    await expect(
      page.getByRole("list", { name: /Search results|Результаты поиска/ }),
    ).toBeVisible();
    await shot(page, `search-dark-${language}-phone`);
    await page.context().close();
  }
});
