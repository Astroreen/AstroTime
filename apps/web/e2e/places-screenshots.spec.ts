// The evidence for places on the map (docs/plans/design.md#D175, D177):
// Location's search with its results, and a place's card in the details,
// on a phone and on a wide screen, in both themes and both languages.
// Photon answers with its recorded answers; the map's tiles are
// OpenStreetMap's, fetched once into `$ASTROTIME_SCREENSHOTS/tiles` and
// served from there after (its tile policy: no bulk). Runs only when
// ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots pnpm --filter @astrotime/web e2e places-screenshots
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

const directory = process.env["ASTROTIME_SCREENSHOTS"];
test.skip(!directory, "set ASTROTIME_SCREENSHOTS to a directory to take the screenshots");

const LOCALES = { en: "en-US", ru: "ru-RU" } as const;
type Language = keyof typeof LOCALES;

const WORDS = {
  en: {
    fixture: "en",
    today: "Wednesday, November 4",
    create: "Create",
    newEvent: "New event",
    title: "Title",
    walk: "Walk",
    location: "Location",
    query: "Brandenburger",
    place: /^Brandenburg Gate/,
    results: "Places",
    save: "Save",
  },
  ru: {
    fixture: "default",
    today: "среда, 4 ноября",
    create: "Создать",
    newEvent: "Новое мероприятие",
    title: "Название",
    walk: "Прогулка",
    location: "Место",
    query: "Красная площадь",
    place: /^Красная площадь Москва/,
    results: "Места",
    save: "Сохранить",
  },
} as const;

async function open(
  browser: Browser,
  language: Language,
  theme: "dark" | "light",
  phone: boolean,
): Promise<Page> {
  const context = await browser.newContext({
    locale: LOCALES[language],
    colorScheme: theme,
    viewport: phone ? PHONE : WIDE,
    ...(phone ? { hasTouch: true, isMobile: true } : {}),
    timezoneId: "Europe/Vilnius",
  });
  const page = await context.newPage();
  const answer = readFileSync(
    new URL(
      `../../../packages/ui/test/fixtures/photon-${WORDS[language].fixture}.json`,
      import.meta.url,
    ),
    "utf8",
  );
  await page.route("https://photon.komoot.io/api/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: answer,
    }),
  );
  const tiles = `${directory}/tiles`;
  mkdirSync(tiles, { recursive: true });
  await page.route("https://tile.openstreetmap.org/**", async (route) => {
    const file = `${tiles}/${new URL(route.request().url()).pathname.slice(1).replaceAll("/", "-")}`;
    if (!existsSync(file)) writeFileSync(file, await (await route.fetch()).body());
    await route.fulfill({ contentType: "image/png", body: readFileSync(file) });
  });
  await openDemo(page, "day");
  await expect(
    page.getByRole("list", { name: WORDS[language].today }).getByRole("listitem").first(),
  ).toBeVisible();
  return page;
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${directory}/${name}.png`, animations: "disabled" });

for (const language of ["en", "ru"] as const) {
  for (const theme of ["dark", "light"] as const) {
    for (const size of ["phone", "wide"] as const) {
      test(`places, ${language}, ${theme}, ${size}`, async ({ browser }) => {
        const w = WORDS[language];
        const name = (what: string) => `${what}-${theme}-${language}-${size}`;
        const page = await open(browser, language, theme, size === "phone");
        await page.getByRole("button", { name: w.create }).click();
        const dialog = page.getByRole("dialog", { name: w.newEvent });
        await dialog.getByRole("textbox", { name: w.title }).fill(w.walk);
        await dialog.getByRole("combobox", { name: w.location }).fill(w.query);
        const option = page
          .getByRole("listbox", { name: w.results })
          .getByRole("option", { name: w.place });
        await expect(option).toBeVisible();
        await shot(page, name("places-search"));
        await option.click();
        await dialog.getByRole("button", { name: w.save }).click();
        await expect(dialog).toHaveCount(0);
        await page
          .getByRole("list", { name: w.today })
          .getByRole("button", { name: new RegExp(`^${w.walk}, `) })
          .click();
        const details = page.getByRole("dialog", { name: w.walk });
        const map = details.getByRole("img");
        await expect(map).toBeVisible();
        // Every tile drawn (its load, or its error), so the shot shows the map.
        await map.locator("img").evaluateAll((all) =>
          Promise.all(
            (all as HTMLImageElement[]).map((img) =>
              img.complete
                ? null
                : new Promise((done) => {
                    img.addEventListener("load", done, { once: true });
                    img.addEventListener("error", done, { once: true });
                  }),
            ),
          ),
        );
        await shot(page, name("places-card"));
        await page.context().close();
      });
    }
  }
}
