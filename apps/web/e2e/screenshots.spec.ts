// The evidence for a UI pull request (docs/plans/foundation.md#pr-5--calendar-grid):
// every view in both themes and both languages, from the demo data with the
// clock frozen. Runs only when ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots pnpm --filter @astrotime/web e2e screenshots
import { expect, test, type Browser, type Page } from "@playwright/test";

import { captureNotifications, NOW, openDemo, PHONE, WIDE } from "./support.ts";

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
    // Settings on a wide screen: the top bar's button, a dialog (design D131).
    const name = language === "en" ? "Settings" : "Настройки";
    await wide.getByRole("banner").getByRole("button", { name }).click();
    await expect(wide.getByRole("dialog", { name })).toBeVisible();
    await shot(wide, `settings-${language === "en" ? "dark" : "light"}-${language}-wide`);
    await wide.context().close();

    const page = await open(browser, { language, theme: "dark", size: PHONE }, "day");
    const settingsName = language === "en" ? "Settings" : "Настройки";
    await page
      .getByRole("button", { name: language === "en" ? "Main menu" : "Главное меню" })
      .click();
    await page.getByRole("dialog").getByRole("button", { name: settingsName }).click();
    await expect(page.getByRole("dialog", { name: settingsName })).toBeVisible();
    await shot(page, `settings-dark-${language}-phone`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: settingsName })).toBeHidden();
    await page.getByRole("button", { name: language === "en" ? "Search" : "Поиск" }).click();
    await expect(page.getByRole("searchbox")).toBeFocused();
    await shot(page, `search-empty-dark-${language}-phone`);
    await page.getByRole("searchbox").fill(language === "en" ? "the" : "на");
    await expect(
      page.getByRole("list", { name: /Search results|Результаты поиска/ }),
    ).toBeVisible();
    await shot(page, `search-dark-${language}-phone`);
    await page.context().close();
  }
});

test("reminders: the setting, and a notification as the page draws it (foundation D101)", async ({
  browser,
}) => {
  const words = {
    en: { menu: "Main menu", settings: "Settings", reminders: "Reminders", next: /^Next: / },
    ru: {
      menu: "Главное меню",
      settings: "Настройки",
      reminders: "Напоминания",
      next: /^Следующее: /,
    },
  } as const;
  const openOnClock = async (
    language: Language,
    theme: Theme,
    permission: NotificationPermission = "default",
  ) => {
    const context = await browser.newContext({
      locale: LOCALES[language],
      colorScheme: theme,
      viewport: PHONE,
      timezoneId: "Europe/Vilnius",
    });
    const page = await context.newPage();
    // A clock the test moves, and notifications drawn in the page (support.ts).
    await captureNotifications(page, permission);
    await page.clock.install({ time: NOW });
    await page.addInitScript(() => localStorage.setItem("astrotime.view", "day"));
    await page.goto("/?demo");
    await expect(
      page
        .getByRole("list", { name: /4|ноября/ })
        .getByRole("listitem")
        .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: words[language].menu }).click();
    await page.getByRole("dialog").getByRole("button", { name: words[language].settings }).click();
    const toggle = page.getByRole("switch", { name: words[language].reminders });
    await toggle.scrollIntoViewIfNeeded();
    return { page, toggle };
  };
  for (const language of ["en", "ru"] as const) {
    for (const theme of ["dark", "light"] as const) {
      const { page, toggle } = await openOnClock(language, theme);
      await page.context().grantPermissions(["notifications"]);
      await toggle.click();
      // The setting's last line, that the web reminds only while it is open.
      const last = page.getByText(/open in a tab|открыт во вкладке/);
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await expect(page.getByText(words[language].next)).toBeInViewport();
      await shot(page, `reminders-setting-${theme}-${language}-phone`);
      await page.keyboard.press("Escape");
      await page.clock.runFor("20:00");
      await expect(
        page.getByRole("region", { name: "Notifications" }).getByRole("button"),
      ).toBeVisible();
      await shot(page, `reminder-notification-${theme}-${language}-phone`);
      await page.context().close();
    }
    const { page, toggle } = await openOnClock(language, "dark", "denied");
    await expect(toggle).toBeDisabled();
    const why = page.getByText(/blocks notifications|не пропускает уведомления/);
    await why.scrollIntoViewIfNeeded();
    await expect(why).toBeInViewport();
    await shot(page, `reminders-blocked-dark-${language}-phone`);
    await page.context().close();
  }
});
