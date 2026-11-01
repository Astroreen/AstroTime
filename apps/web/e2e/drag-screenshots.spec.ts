// The evidence for dragging (design D111, D112): a drag in progress with its
// ghost and new time, a resize, a drag in the Month, and on a phone, in both
// themes and both languages, from the demo data with the clock frozen; and
// what a drop announces, in both languages. Runs only when
// ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots pnpm --filter @astrotime/web e2e drag-screenshots
import { writeFile } from "node:fs/promises";

import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

const directory = process.env["ASTROTIME_SCREENSHOTS"];
test.skip(!directory, "set ASTROTIME_SCREENSHOTS to a directory to take the screenshots");

const LOCALES = { en: "en-US", ru: "ru-RU" } as const;
type Language = keyof typeof LOCALES;
type Theme = "dark" | "light";
const HOUR = 56;

const WORDS = {
  en: {
    today: "Wednesday, November 4",
    thursday: "Thursday, November 5",
    friday: "Friday, November 6",
    saturday: "Saturday, November 7",
    twelfth: "Thursday, November 12",
    lunch: /^Lunch with Marta, /,
    workshop: /^CalDAV workshop, /,
    concert: /^Concert at the philharmonic, /,
  },
  ru: {
    today: "среда, 4 ноября",
    thursday: "четверг, 5 ноября",
    friday: "пятница, 6 ноября",
    saturday: "суббота, 7 ноября",
    twelfth: "четверг, 12 ноября",
    lunch: /^Обед с Мартой, /,
    workshop: /^Воркшоп по CalDAV, /,
    concert: /^Концерт в филармонии, /,
  },
} as const;

async function open(
  browser: Browser,
  options: { language: Language; theme: Theme; size: { width: number; height: number } },
  view: "day" | "week" | "month",
): Promise<Page> {
  const context = await browser.newContext({
    locale: LOCALES[options.language],
    colorScheme: options.theme,
    viewport: options.size,
    timezoneId: "Europe/Vilnius",
  });
  const page = await context.newPage();
  await openDemo(page, view);
  await expect(page.getByRole("listitem").first()).toBeVisible();
  return page;
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${directory}/${name}.png`, animations: "disabled" });

async function hold(page: Page, at: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(page.locator("[data-ghost]").first()).toBeVisible();
}

async function on(page: Page, name: string, hours: number) {
  const box = (await page.getByRole("list", { name }).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + hours * HOUR };
}

async function top(locator: Locator, dy = 10) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + dy };
}

for (const language of ["en", "ru"] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`dragging, ${language}, ${theme}`, async ({ browser }) => {
      const w = WORDS[language];
      const name = (what: string, size: string) => `${what}-${theme}-${language}-${size}`;

      // A drag in progress: the original dimmed, the ghost on Thursday with its new time.
      const wide = await open(browser, { language, theme, size: WIDE }, "week");
      const lunch = wide
        .getByRole("list", { name: w.today })
        .getByRole("listitem", { name: w.lunch });
      await hold(wide, await top(lunch), await on(wide, w.thursday, 15.1));
      await shot(wide, name("drag", "wide"));
      await wide.mouse.up();
      const status = wide.getByRole("main").getByRole("status");
      await expect(status).not.toBeEmpty();
      if (theme === "dark")
        await writeFile(
          `${directory}/announcement-${language}.txt`,
          `${await status.textContent()}\n`,
        );

      // A resize in progress: the workshop's end held and pulled down to 6:45.
      const workshop = wide
        .getByRole("list", { name: w.friday })
        .getByRole("listitem", { name: w.workshop });
      const box = (await workshop.boundingBox())!;
      await hold(
        wide,
        { x: box.x + box.width / 2, y: box.y + box.height - 2 },
        await on(wide, w.friday, 18.6),
      );
      await shot(wide, name("resize", "wide"));
      await wide.keyboard.press("Escape");
      await wide.mouse.up();
      await wide.context().close();

      // In the Month: the concert held over Thursday the 12th.
      const month = await open(browser, { language, theme, size: WIDE }, "month");
      const concert = month
        .getByRole("list", { name: w.saturday })
        .getByRole("listitem", { name: w.concert });
      const target = (await month.getByRole("button", { name: w.twelfth }).boundingBox())!;
      await hold(month, await top(concert, 6), { x: target.x, y: target.y + 40 });
      await shot(month, name("drag-month", "wide"));
      await month.keyboard.press("Escape");
      await month.mouse.up();
      await month.context().close();

      // On a phone, the Day view: lunch held an hour and a half later.
      const phone = await open(browser, { language, theme, size: PHONE }, "day");
      const dayLunch = phone
        .getByRole("list", { name: w.today })
        .getByRole("listitem", { name: w.lunch });
      await hold(phone, await top(dayLunch), await on(phone, w.today, 14.6));
      await shot(phone, name("drag", "phone"));
      await phone.keyboard.press("Escape");
      await phone.mouse.up();
      await phone.context().close();
    });
  }
}
