// The evidence for the pictures (docs/plans/design.md#D215–D219): the
// Agenda with its illustrated cards and a month's banner, and an item's
// details under its picture, on a phone and on a wide screen, in both themes and both
// languages. Runs only when ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots pnpm --filter @astrotime/web e2e pictures-screenshots
import { expect, test, type Page } from "@playwright/test";

import { openDemo } from "./support.ts";

const directory = process.env["ASTROTIME_SCREENSHOTS"];
test.skip(!directory, "set ASTROTIME_SCREENSHOTS to a directory to take the screenshots");

const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };
const LOCALES = { en: "en-US", ru: "ru-RU" } as const;
const LUNCH = { en: /^Lunch with Marta/, ru: /^Обед с Мартой/ } as const;

/** Every picture on screen decoded, so the screenshot shows them. */
async function pictures(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      [...document.images]
        .filter((img) => img.loading !== "lazy" || img.getBoundingClientRect().top < innerHeight)
        .map((img) => img.decode().catch(() => {})),
    ),
  );
}

for (const language of ["en", "ru"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const [size, viewport] of [
      ["phone", PHONE],
      ["wide", WIDE],
    ] as const) {
      test(`${language} ${theme} ${size}`, async ({ browser }) => {
        const context = await browser.newContext({
          locale: LOCALES[language],
          colorScheme: theme,
          viewport,
          ...(size === "phone" ? { hasTouch: true, isMobile: true } : {}),
          timezoneId: "Europe/Vilnius",
        });
        const page = await context.newPage();
        await openDemo(page, "agenda");
        const lunch = page.getByRole("listitem", { name: LUNCH[language] });
        await lunch.scrollIntoViewIfNeeded();
        await expect(lunch.locator("img")).toHaveAttribute("data-shown", "true");
        await pictures(page);
        const name = `${directory}/pictures-${language}-${theme}-${size}`;
        await page.screenshot({ path: `${name}-agenda.png` });
        await lunch.getByRole("button").click();
        const header = page.locator(".details-picture img");
        await expect(header).toBeVisible();
        await pictures(page);
        await page.screenshot({ path: `${name}-details.png` });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        // December's banner at the top of the list (D218).
        const december = page.locator('.month-banner:has(img[src*="month-12"])');
        await december.evaluate((banner) => banner.scrollIntoView({ block: "start" }));
        await expect(december.locator("img")).toBeVisible();
        await pictures(page);
        await page.screenshot({ path: `${name}-banner.png` });
        await context.close();
      });
    }
  }
}
