// The evidence for the font and the text size (design D294, D295): Settings
// with its preview in each font, and the views at 85 % and 130 % on a phone
// and a wide screen, both themes. Runs only when ASTROTIME_SCREENSHOTS names a
// directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots pnpm --filter @astrotime/web e2e fonts-screenshots
import { expect, test, type Browser, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

const directory = process.env["ASTROTIME_SCREENSHOTS"];
test.skip(!directory, "set ASTROTIME_SCREENSHOTS to a directory to take the screenshots");
// A ceiling for many pages in one test, not a wait.
test.setTimeout(180_000);

const FONTS = {
  system: "System default",
  inter: "Inter",
  roboto: "Roboto",
  "noto-sans": "Noto Sans",
  "pt-sans": "PT Sans",
  nunito: "Nunito",
  literata: "Literata",
  "jetbrains-mono": "JetBrains Mono",
} as const;

async function open(
  browser: Browser,
  options: {
    theme: "dark" | "light";
    size: { width: number; height: number };
    font: keyof typeof FONTS;
    textSize: number;
    language?: "en-US" | "ru-RU";
  },
  view: "week" | "month" | "agenda",
): Promise<Page> {
  const context = await browser.newContext({
    locale: options.language ?? "en-US",
    colorScheme: options.theme,
    viewport: options.size,
    timezoneId: "Europe/Vilnius",
  });
  const page = await context.newPage();
  await page.addInitScript(
    (settings) => localStorage.setItem("astrotime.settings", JSON.stringify(settings)),
    { font: options.font, textSize: options.textSize },
  );
  await openDemo(page, view);
  await expect(
    page
      .getByRole("list", { name: /4|ноября/ })
      .getByRole("listitem")
      .first(),
  ).toBeVisible();
  if (options.font !== "system")
    await expect(page.locator("body")).toHaveCSS(
      "font-family",
      new RegExp(`^"?${FONTS[options.font]}"?, `),
    );
  return page;
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${directory}/${name}.png`, animations: "disabled" });

async function openSettings(page: Page, wide: boolean) {
  const menu = /^(Main menu|Главное меню)$/;
  if (!wide) await page.getByRole("button", { name: menu }).click();
  await page
    .getByRole(wide ? "navigation" : "dialog", { name: menu })
    .getByRole("button", { name: /^(Settings|Настройки)$/ })
    .click();
  await expect(
    page.getByRole("figure", { name: /^(Preview of the font|Как выглядят)/ }),
  ).toBeVisible();
}

test("Settings in each font, with its preview", async ({ browser }) => {
  for (const font of Object.keys(FONTS) as (keyof typeof FONTS)[]) {
    for (const language of ["en-US", "ru-RU"] as const) {
      const page = await open(
        browser,
        { theme: "dark", size: WIDE, font, textSize: 100, language },
        "week",
      );
      await openSettings(page, true);
      await shot(page, `font-${font}-${language.slice(0, 2)}-dark-wide`);
      await page.context().close();
    }
  }
});

for (const textSize of [85, 130]) {
  for (const theme of ["dark", "light"] as const) {
    test(`views at ${textSize} %, ${theme}`, async ({ browser }) => {
      for (const [name, size] of [
        ["phone", PHONE],
        ["wide", WIDE],
      ] as const) {
        for (const view of ["week", "month", "agenda"] as const) {
          const page = await open(browser, { theme, size, font: "inter", textSize }, view);
          await shot(page, `size-${textSize}-${view}-${theme}-${name}`);
          if (view === "week") {
            await openSettings(page, name === "wide");
            await shot(page, `size-${textSize}-settings-${theme}-${name}`);
          }
          await page.context().close();
        }
      }
    });
  }
}
