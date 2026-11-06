// The font and the text size (design D294, D295): each bundled font is
// fetched only once chosen and draws the app's text; one that cannot be
// fetched leaves the font as it was and says so; the text size scales the
// type scale and the hour. The same under the image's policy:
// e2e/built/csp.spec.ts.
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";

import { choose, openDemo, WIDE } from "./support.ts";

const FONTS = [
  "Inter",
  "Roboto",
  "Noto Sans",
  "PT Sans",
  "Nunito",
  "Literata",
  "JetBrains Mono",
] as const;

/** A font's file the page fetches (in dev, not the module that names its URL). */
const isFont = (request: Request) => request.resourceType() === "font";

const openSettings = async (page: Page) => {
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  return page.getByRole("dialog", { name: "Settings" });
};

/** The families `document.fonts` has loaded. */
const loadedFamilies = (page: Page) =>
  page.evaluate(() =>
    [...document.fonts]
      .filter((face) => face.status === "loaded")
      .map((face) => face.family.replace(/^"(.*)"$/, "$1")),
  );

test("each font is fetched only once chosen and draws the cards, headings and buttons (D294)", async ({
  page,
}) => {
  const fetched: string[] = [];
  page.on("request", (request) => {
    if (isFont(request)) fetched.push(request.url());
  });
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  const card = page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("listitem")
    .first();
  const heading = page.getByRole("main").getByRole("heading", { name: "Wednesday, November 4" });
  const today = page.getByRole("button", { name: /^Today/ });
  await expect(card).toBeVisible();
  let settings = await openSettings(page);
  await expect(
    settings.getByRole("figure", { name: "Preview of the font and text size" }),
  ).toBeVisible();
  // Nothing at the first load, nor with Settings open.
  expect(fetched).toEqual([]);
  await page.keyboard.press("Escape");

  for (const font of FONTS) {
    settings = await openSettings(page);
    await choose(settings.getByRole("combobox", { name: "Font" }), font);
    await expect(settings.getByRole("combobox", { name: "Font" })).toHaveText(font);
    expect(await loadedFamilies(page)).toContain(font);
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    for (const element of [card, heading, today])
      await expect(element).toHaveCSS("font-family", new RegExp(`^"?${font}"?, `));
  }
  // Only the chosen fonts' files, four subsets each (PT Sans: two weights).
  expect(new Set(fetched).size).toBe(6 * 4 + 8);

  // Kept on this device, and fetched again at the next start.
  await page.reload();
  await expect(card).toHaveCSS("font-family", /^"JetBrains Mono", /);
  await choose(
    (await openSettings(page)).getByRole("combobox", { name: "Font" }),
    "System default",
  );
  await page.keyboard.press("Escape");
  await expect(card).not.toHaveCSS("font-family", /JetBrains/);
});

test("a font that cannot be fetched leaves the text as it was and says so; it comes once the network does (D294)", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  // No network for the fonts' files.
  let offline = true;
  await page.route("**/*", (route) =>
    offline && isFont(route.request()) ? route.abort("internetdisconnected") : route.fallback(),
  );
  const settings = await openSettings(page);
  const font = settings.getByRole("combobox", { name: "Font" });
  await choose(font, "Roboto");
  await expect(settings.getByText(/^Roboto could not be downloaded\./)).toBeVisible();
  await expect(font).toHaveText("System default");
  // The system's own list names Roboto too, after its own fonts.
  await expect(page.locator("body")).not.toHaveCSS("font-family", /^"?Roboto"?, /);

  offline = false;
  await choose(font, "Roboto");
  await expect(font).toHaveText("Roboto");
  await expect(settings.getByText(/could not be downloaded/)).toHaveCount(0);
  await expect(page.locator("body")).toHaveCSS("font-family", /^"?Roboto"?, /);
});

test("a font whose files come after a later pick's is not applied: the last pick wins (D294)", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  // Literata's files held back until released.
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (isFont(request) && request.url().includes("literata")) await released;
    await route.fallback();
  });
  const settings = await openSettings(page);
  const font = settings.getByRole("combobox", { name: "Font" });
  const body = page.locator("body");

  for (const last of ["Inter", "System default"]) {
    await choose(font, "Literata");
    await expect(settings.getByText("Downloading Literata…")).toBeVisible();
    await choose(font, last);
    await expect(font).toHaveText(last);
  }
  // Literata's files come now: its faces load, and nothing changes.
  release();
  await page.waitForFunction(() =>
    [...document.fonts].some(
      (face) => face.family.includes("Literata") && face.status === "loaded",
    ),
  );
  await expect(font).toHaveText("System default");
  await expect(settings.getByText(/Downloading/)).toHaveCount(0);
  await expect(body).not.toHaveCSS("font-family", /^"?Literata/);
  await page.reload();
  await expect(page.getByRole("main", { name: "November" })).toBeVisible();
  await expect(body).not.toHaveCSS("font-family", /^"?Literata/);
});

test("the text size scales the type scale and the hour, seen in the preview as it is set (D295)", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  const main = page.getByRole("main", { name: "November" });
  await expect(main).toHaveCSS("--hour", "56px");
  const settings = await openSettings(page);
  const preview = settings.getByRole("figure", { name: "Preview of the font and text size" });
  const size = settings.getByRole("slider", { name: "Text size" });
  await expect(size).toHaveAttribute("aria-valuetext", "100%");
  const title = settings.getByRole("heading", { name: "Settings" });
  const fontSize = (locator: Locator) =>
    locator.evaluate((element) => getComputedStyle(element).fontSize);
  expect(await fontSize(title)).toBe("19px");

  await size.fill("9");
  await expect(size).toHaveAttribute("aria-valuetext", "130%");
  expect(await fontSize(title)).toBe("24.7px");
  // A field stays at 16 px or more, whatever the size (iOS zooms into one under it).
  await size.fill("0");
  await expect(size).toHaveAttribute("aria-valuetext", "85%");
  expect(await fontSize(title)).toBe("16.15px");
  expect(await fontSize(settings.getByRole("combobox", { name: "Font" }))).toBe("16px");
  await expect(preview).toBeVisible();

  await size.fill("9");
  await page.keyboard.press("Escape");
  await expect(main).toHaveCSS("--hour", "72.8px");
  await page.reload();
  await expect(main).toHaveCSS("--hour", "72.8px");
});
