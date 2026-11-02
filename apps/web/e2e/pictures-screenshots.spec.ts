// The evidence for the pictures (docs/plans/design.md#D215–D221): the
// Agenda with its illustrated cards and a month's banner, and an item's
// details under its picture, on a phone and on a wide screen, in both themes and both
// languages. Runs only when ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots pnpm --filter @astrotime/web e2e pictures-screenshots
import { readFileSync } from "node:fs";

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

// A place's photo (D220, D221): Photon and Wikipedia answer with their
// recorded answers, and the "photo" is one of AstroTime's own banners, so
// the evidence shows no one's photo.
const PLACE = {
  en: { photon: "photon-en.json", wiki: "en", title: "Sightseeing", query: "Brandenburger" },
  ru: { photon: "photon-default.json", wiki: "ru", title: "Экскурсия", query: "Красная площадь" },
} as const;
const fixture = (name: string) =>
  readFileSync(new URL(`../../../packages/ui/test/fixtures/${name}`, import.meta.url));

for (const [language, theme, size] of [
  ["en", "light", "phone"],
  ["ru", "dark", "phone"],
  ["en", "dark", "wide"],
  ["ru", "light", "wide"],
] as const) {
  test(`place photo ${language} ${theme} ${size}`, async ({ browser }) => {
    const phone = size === "phone";
    const context = await browser.newContext({
      locale: LOCALES[language],
      colorScheme: theme,
      viewport: phone ? PHONE : WIDE,
      ...(phone ? { hasTouch: true, isMobile: true } : {}),
      timezoneId: "Europe/Vilnius",
    });
    const page = await context.newPage();
    const place = PLACE[language];
    await page.route("https://photon.komoot.io/api/**", (route) =>
      route.fulfill({ contentType: "application/json", body: fixture(place.photon) }),
    );
    await page.route(`https://${place.wiki}.wikipedia.org/w/api.php**`, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: fixture(
          new URL(route.request().url()).searchParams.has("gsrsearch")
            ? `wikipedia-${place.wiki}-search.json`
            : "wikipedia-en-imageinfo.json",
        ),
      }),
    );
    // The place card's map: a plain ground, no tile fetched (OpenStreetMap's policy: no bulk).
    await page.route("https://tile.openstreetmap.org/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8e4dc"/></svg>',
      }),
    );
    await page.route("https://thumb.wikimedia.org/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: fixture("../../src/pictures/art/month-04.svg"),
      }),
    );
    await openDemo(page, "agenda");
    await page.getByRole("button", { name: /^(Create|Создать)$/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: /^(Title|Название)$/ }).fill(place.title);
    await dialog.getByRole("combobox", { name: /^(Location|Место)$/ }).fill(place.query);
    await page.getByRole("listbox").getByRole("option").first().click();
    await dialog.getByRole("button", { name: /^(Save|Сохранить)$/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const card = page.getByRole("listitem", { name: new RegExp(`^${place.title}`) });
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator("img")).toHaveAttribute("data-shown", "true");
    await pictures(page);
    const name = `${directory}/place-photo-${language}-${theme}-${size}`;
    await page.screenshot({ path: `${name}-agenda.png` });
    await card.getByRole("button").click();
    await expect(page.locator(".details-picture img")).toBeVisible();
    await pictures(page);
    await page.screenshot({ path: `${name}-details.png` });
    await context.close();
  });
}

// The user's own pictures (D222, D223): a word with a picture and a month
// banner of their own, the "picture" one of AstroTime's own banners, so the
// evidence shows no one's photo.
for (const [language, theme, size] of [
  ["en", "dark", "phone"],
  ["ru", "light", "phone"],
  ["en", "light", "wide"],
] as const) {
  test(`own pictures ${language} ${theme} ${size}`, async ({ browser }) => {
    const phone = size === "phone";
    const context = await browser.newContext({
      locale: LOCALES[language],
      colorScheme: theme,
      viewport: phone ? PHONE : WIDE,
      ...(phone ? { hasTouch: true, isMobile: true } : {}),
      timezoneId: "Europe/Vilnius",
    });
    const page = await context.newPage();
    const picture = {
      name: "lake.svg",
      mimeType: "image/svg+xml",
      buffer: fixture("../../src/pictures/art/month-07.svg"),
    };
    await openDemo(page, "agenda");
    const openSettings = async () => {
      if (phone) {
        await page.getByRole("button", { name: /^(Main menu|Главное меню)$/ }).click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /^(Settings|Настройки)$/ })
          .click();
      } else {
        await page.getByRole("button", { name: /^(Settings|Настройки)$/ }).click();
      }
      return page.getByRole("dialog", { name: /^(Settings|Настройки)$/ });
    };
    const settings = await openSettings();
    await settings
      .getByRole("button", { name: /^(Add a word with a picture|Добавить слово с картинкой)$/ })
      .click();
    const editor = page.getByRole("dialog", { name: /^(A word's picture|Картинка для слова)$/ });
    await editor.getByRole("textbox").fill(language === "en" ? "Stand-up" : "Планёрка");
    const chooser = page.waitForEvent("filechooser");
    await editor.getByRole("button", { name: /^(Choose a picture|Выбрать картинку)$/ }).click();
    await (await chooser).setFiles(picture);
    await expect(editor.locator("img")).toHaveAttribute("src", /^blob:/);
    // Base UI marks a dialog entering or leaving: the screenshot waits for it to settle.
    await expect(page.locator("[data-starting-style], [data-ending-style]")).toHaveCount(0);
    await pictures(page);
    const name = `${directory}/own-pictures-${language}-${theme}-${size}`;
    await page.screenshot({ path: `${name}-editor.png` });
    await editor.getByRole("button", { name: /^(Save|Сохранить)$/ }).click();
    await expect(editor).toHaveCount(0);
    const group = settings.getByRole("region", { name: /^(Pictures|Картинки)$/ });
    await group.scrollIntoViewIfNeeded();
    await expect(page.locator("[data-starting-style], [data-ending-style]")).toHaveCount(0);
    await pictures(page);
    await page.screenshot({ path: `${name}-settings.png` });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const card = page
      .getByRole("listitem", { name: new RegExp(language === "en" ? "^Stand-up" : "^Планёрка") })
      .first();
    await expect(card.locator("img")).toHaveAttribute("data-shown", "true");
    await pictures(page);
    await page.screenshot({ path: `${name}-agenda.png` });
    await context.close();
  });
}
