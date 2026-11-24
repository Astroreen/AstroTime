// The evidence for the account a new item goes to (design D313) and every
// account at once (D314): quick create on a phone with two accounts signed
// in (two real Radicales) with its picker open, the accounts then one's
// calendars, two ticked, and Settings' accounts on a wide screen, in both
// themes and both languages. It runs on `main` too, for the "before"
// pictures: there quick create has no account row and Settings no switch.
// Runs only when ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots pnpm --filter @astrotime/web e2e every-account-screenshots
import { test as base, expect, type Page } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { addAccount, openApp, PHONE, quickCreate, WIDE } from "./support.ts";

const directory = process.env["ASTROTIME_SCREENSHOTS"];
base.skip(!directory, "set ASTROTIME_SCREENSHOTS to a directory to take the screenshots");

const test = base.extend<{ first: CalDavServer; second: CalDavServer }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  first: async ({}, use) => {
    const server = await startRadicale();
    await use(server);
    await server.stop();
  },
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  second: async ({}, use) => {
    const server = await startRadicale();
    await use(server);
    await server.stop();
  },
});

const WORDS = {
  en: {
    create: "Create",
    title: "Title",
    menu: "Main menu",
    settings: "Settings",
    calendar: "Calendar",
  },
  ru: {
    create: "Создать",
    title: "Название",
    menu: "Главное меню",
    settings: "Настройки",
    calendar: "Календарь",
  },
} as const;

async function signIn(page: Page, server: CalDavServer): Promise<void> {
  const dialog = await addAccount(page, "caldav");
  await dialog.getByRole("textbox", { name: "Server address" }).fill(server.url);
  await dialog.getByRole("textbox", { name: "User name" }).fill(server.username);
  await dialog.getByLabel("Password").fill(server.password);
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await expect(dialog).toHaveCount(0);
  const name = `astro@${new URL(server.url).host}`;
  await expect(page.getByRole("region", { name }).getByText(/^Synced at /)).toBeVisible();
  await page.keyboard.press("Escape");
}

/** A screenshot once Base UI's popups have finished entering or leaving. */
async function shot(page: Page, name: string): Promise<void> {
  await expect(page.locator("[data-starting-style], [data-ending-style]")).toHaveCount(0);
  await page.screenshot({ path: `${directory}/${name}.png`, animations: "disabled" });
}

for (const language of ["en", "ru"] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`quick create and Settings with two accounts, ${language}, ${theme}`, async ({
      page,
      first,
      second,
    }) => {
      const w = WORDS[language];
      const name = (what: string) => `${what}-${theme}-${language}`;
      await page.emulateMedia({ colorScheme: theme });
      await first.mkcalendar("home");
      await second.mkcalendar("work");
      await second.mkcalendar("family");
      await openApp(page);
      await signIn(page, first);
      await signIn(page, second);

      const show = async (settings: object) => {
        await page.evaluate(
          (value) => localStorage.setItem("astrotime.settings", JSON.stringify(value)),
          { language, ...settings },
        );
        await page.reload();
      };

      // Quick create on a phone, as the owner's picture of Google's.
      await page.setViewportSize(PHONE);
      for (const [what, settings] of [
        ["quick", {}],
        ["quick-every", { everyAccount: true }],
      ] as const) {
        await show(settings);
        await page.getByRole("button", { name: w.create }).first().click();
        const quick = quickCreate(page, language);
        await quick.getByRole("textbox", { name: w.title }).fill("Dentist");
        await shot(page, name(what));
        // The row's picker, where there is one (design D313): the accounts, then one's calendars.
        const field = quick.getByRole("button", { name: new RegExp(`^${w.calendar}: `) });
        if (what === "quick" && (await field.count()) > 0) {
          await field.click();
          await shot(page, name("picker-accounts"));
          await page.getByRole("button", { name: "astro", exact: true }).nth(1).click();
          await page
            .getByRole("group", { name: w.calendar })
            .getByRole("checkbox", { name: "work" })
            .click();
          await shot(page, name("picker-calendars"));
          await page.keyboard.press("Escape");
          await expect(page.getByRole("group", { name: w.calendar })).toHaveCount(0);
        }
        await page.keyboard.press("Escape");
        await expect(quick).toHaveCount(0);
      }

      // Settings' accounts on a wide screen.
      await show({});
      await page.setViewportSize(WIDE);
      await page
        .getByRole("navigation", { name: w.menu })
        .getByRole("button", { name: w.settings })
        .click();
      const settings = page.getByRole("dialog", { name: w.settings });
      await settings
        .getByRole("region", { name: `astro@${new URL(first.url).host}` })
        .scrollIntoViewIfNeeded();
      await shot(page, name("settings"));
    });
  }
}
