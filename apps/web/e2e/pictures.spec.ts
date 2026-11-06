// The pictures (docs/plans/design.md#D215–D221): an item whose title has a
// subject's word is drawn over its picture in the Agenda and in its details,
// one with a place over its place's photo (Wikipedia faked); the others are
// as they were; Settings → Pictures turns them off.
import { readFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { openDemo } from "./support.ts";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** A photo: a 1×1 PNG. */
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

/** Whether a picture arrived and was decoded. */
const loaded = (picture: Locator) =>
  picture.evaluate((img: HTMLImageElement) => img.decode().then(() => img.naturalWidth > 0));

test("a lunch is drawn over its picture in the Agenda and its details; a design review is not (D215, D216)", async ({
  page,
}) => {
  await openDemo(page, "agenda");
  const lunch = page.getByRole("listitem", { name: /^Lunch with Marta/ });
  await lunch.scrollIntoViewIfNeeded();
  const picture = lunch.locator("img");
  await expect(picture).toHaveAttribute("src", /meal/);
  expect(await loaded(picture)).toBe(true);
  // Its height is the card's own, before the picture and after it (no shift).
  expect((await lunch.boundingBox())?.height).toBe(104);
  // An item with no theme's word is the plain card.
  // (A stand-up is a meeting since D298, drawn over its picture.)
  const review = page.getByRole("listitem", { name: /^Design review/ }).first();
  await expect(review.locator("img")).toHaveCount(0);

  await lunch.getByRole("button").click();
  const details = page.getByRole("dialog", { name: "Lunch with Marta" });
  const header = details.locator(".details-picture img");
  await expect(header).toHaveAttribute("src", /meal/);
  expect(await loaded(header)).toBe(true);
  // The bar's buttons stay over it, and work.
  await details.getByRole("button", { name: "Close" }).click();
  await expect(details).toBeHidden();
});

test("with a large text the card grows and its title wraps, never clipped (D216)", async ({
  page,
}) => {
  await openDemo(page, "agenda");
  await page.addStyleTag({
    content: "html { font-size: 200%; } :root { --text-body: 28px; --text-note: 25px; }",
  });
  const lunch = page.getByRole("listitem", { name: /^Lunch with Marta/ });
  await lunch.scrollIntoViewIfNeeded();
  const fits = await lunch.evaluate((card) =>
    [...card.querySelectorAll<HTMLElement>(".picture-text > *")].every(
      (line) => line.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom,
    ),
  );
  expect(fits).toBe(true);
  expect((await lunch.boundingBox())!.height).toBeGreaterThan(104);
});

test("Settings → Pictures → Illustrations off: every card and the details are plain (D217)", async ({
  page,
}) => {
  await openDemo(page, "agenda");
  const lunch = page.getByRole("listitem", { name: /^Lunch with Marta/ });
  await expect(lunch.locator("img")).toHaveCount(1);

  // On a phone, Settings is the drawer's last row (D131).
  await page.getByRole("button", { name: "Main menu" }).click();
  await page
    .getByRole("dialog", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const toggle = settings.getByRole("switch", { name: "Illustrations by an item's title" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await settings.getByRole("button", { name: "Close settings" }).click();

  await expect(lunch.locator("img")).toHaveCount(0);
  await lunch.getByRole("button").click();
  await expect(page.getByRole("dialog", { name: "Lunch with Marta" })).toBeVisible();
  await expect(page.locator(".details-picture")).toHaveCount(0);
});

test.describe("month banners", () => {
  for (const [zone, december] of [
    ["Europe/Vilnius", "month-12"],
    ["Australia/Sydney", "month-06"],
  ] as const) {
    test(`in ${zone}, December opens under ${december}'s banner (D218)`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        timezoneId: zone,
      });
      const page = await context.newPage();
      await openDemo(page, "agenda");
      const heading = page.getByRole("heading", { name: "December", exact: true });
      await heading.scrollIntoViewIfNeeded();
      const banner = page.locator(".month-banner", { has: heading });
      await expect(banner.locator("img")).toHaveAttribute("src", new RegExp(december));
      expect(await loaded(banner.locator("img"))).toBe(true);
      expect((await banner.boundingBox())?.height).toBe(144);
      await context.close();
    });
  }
});

test.describe("a place's photo", () => {
  const fixture = (name: string) =>
    readFileSync(new URL(`../../../packages/ui/test/fixtures/${name}`, import.meta.url));

  /** Photon, Wikipedia and Wikimedia, faked; what Wikipedia was asked. */
  async function fakeServices(page: Page) {
    const asked: URL[] = [];
    await page.route("https://photon.komoot.io/api/**", (route) =>
      route.fulfill({ contentType: "application/json", body: fixture("photon-en.json") }),
    );
    await page.route("https://en.wikipedia.org/w/api.php**", (route) => {
      const url = new URL(route.request().url());
      asked.push(url);
      return route.fulfill({
        contentType: "application/json",
        body: fixture(
          url.searchParams.has("gsrsearch")
            ? "wikipedia-en-search.json"
            : "wikipedia-en-imageinfo.json",
        ),
      });
    });
    await page.route("https://thumb.wikimedia.org/**", (route) =>
      route.fulfill({ contentType: "image/png", body: PHOTO }),
    );
    return asked;
  }

  /** An event with no subject's word at a place picked from Location's search. */
  async function sightseeing(page: Page) {
    await page.getByRole("button", { name: "Create" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByRole("textbox", { name: "Title" }).fill("Sightseeing");
    await dialog.getByRole("combobox", { name: "Location" }).fill("Brandenburger");
    await page.getByRole("listbox", { name: "Places" }).getByRole("option").first().tap();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
  }

  test("an item with a place and no subject's word is drawn over its place's photo, credited in its details (D220, D221)", async ({
    page,
  }) => {
    const asked = await fakeServices(page);
    await openDemo(page, "agenda");
    await sightseeing(page);
    const card = page.getByRole("listitem", { name: /^Sightseeing/ });
    await expect(card.locator("img")).toHaveAttribute("src", /thumb\.wikimedia\.org/);
    expect(await loaded(card.locator("img"))).toBe(true);
    // The name and the point rounded to about 100 m, once.
    expect(asked.map((url) => url.searchParams.get("gsrsearch")).filter(Boolean)).toEqual([
      "brandenburger tor nearcoord:1km,52.517,13.381",
    ]);
    // The card credits its author too (D221).
    await expect(card.getByText("© Thomas Wolf, www.foto-tw.de")).toBeVisible();
    await card.getByRole("button").click();
    const details = page.getByRole("dialog", { name: "Sightseeing" });
    await expect(details.locator(".details-picture img")).toHaveAttribute("srcset", /500px/);
    await expect(
      details.getByRole("link", { name: "Thomas Wolf, www.foto-tw.de" }),
    ).toHaveAttribute(
      "href",
      "https://commons.wikimedia.org/wiki/File%3ABrandenburger_Tor_abends.jpg",
    );
    await expect(details.getByRole("link", { name: "CC BY-SA 3.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by-sa/3.0",
    );
    // Asked once, however many places show it.
    expect(asked.filter((url) => url.searchParams.has("gsrsearch"))).toHaveLength(1);
  });

  test("a home address sends nothing: only a place with a name of its own is looked up (D220)", async ({
    page,
  }) => {
    const asked = await fakeServices(page);
    // Photon's answer for a home: an address, a street and a number, no name.
    await page.route("https://photon.komoot.io/api/**", (route) =>
      route.fulfill({
        json: {
          features: [
            {
              properties: {
                street: "Unter den Linden",
                housenumber: "77",
                postcode: "10117",
                city: "Berlin",
                country: "Germany",
              },
              geometry: { type: "Point", coordinates: [13.3807, 52.5165] },
            },
          ],
        },
      }),
    );
    await openDemo(page, "agenda");
    await page.getByRole("button", { name: "Create" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByRole("textbox", { name: "Title" }).fill("Plumber");
    await dialog.getByRole("combobox", { name: "Location" }).fill("Unter den Linden 77");
    await page.getByRole("listbox", { name: "Places" }).getByRole("option").first().tap();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    const card = page.getByRole("listitem", { name: /^Plumber/ });
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button").click();
    await expect(page.getByRole("dialog", { name: "Plumber" })).toBeVisible();
    await expect(page.locator(".details-picture")).toHaveCount(0);
    await expect(card.locator("img")).toHaveCount(0);
    expect(asked).toEqual([]);
  });

  test("Settings → Pictures → Photos of places off: nothing is asked, the plain card (D221)", async ({
    page,
  }) => {
    const asked = await fakeServices(page);
    await openDemo(page, "agenda");
    await page.getByRole("button", { name: "Main menu" }).click();
    await page
      .getByRole("dialog", { name: "Main menu" })
      .getByRole("button", { name: "Settings" })
      .click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    const toggle = settings.getByRole("switch", { name: "Photos of places" });
    await expect(settings.getByText(/go to en\.wikipedia\.org for its photo/)).toBeVisible();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await settings.getByRole("button", { name: "Close settings" }).click();
    await sightseeing(page);
    const card = page.getByRole("listitem", { name: /^Sightseeing/ });
    await card.getByRole("button").click();
    await expect(page.getByRole("dialog", { name: "Sightseeing" })).toBeVisible();
    await expect(page.locator(".details-picture")).toHaveCount(0);
    await expect(card.locator("img")).toHaveCount(0);
    expect(asked).toEqual([]);
  });
});

test("a title edited to another subject draws the new picture, faded in once it comes (D216)", async ({
  page,
}) => {
  await openDemo(page, "agenda");
  const cinema = page.getByRole("listitem", { name: /^Cinema/ });
  await page.getByRole("button", { name: "Show earlier" }).click();
  await cinema.scrollIntoViewIfNeeded();
  await expect(cinema.locator("img")).toHaveAttribute("data-shown", "true");
  await cinema.getByRole("button").click();
  await page.getByRole("dialog", { name: "Cinema" }).getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  await edit.getByRole("textbox", { name: "Title" }).fill("Dinner");
  await edit.getByRole("button", { name: "Save" }).click();
  const dinner = page.getByRole("listitem", { name: /^Dinner/ });
  await expect(dinner.locator("img")).toHaveAttribute("src", /meal/);
  await expect(dinner.locator("img")).toHaveAttribute("data-shown", "true");
});

test.describe("the user's own pictures", () => {
  /** A picture from the device: a PNG. */
  const OWN = PHOTO;

  async function openSettings(page: Page) {
    await page.getByRole("button", { name: "Main menu" }).click();
    await page
      .getByRole("dialog", { name: "Main menu" })
      .getByRole("button", { name: "Settings" })
      .click();
    return page.getByRole("dialog", { name: "Settings" });
  }

  test("a word of the user's with their picture draws their items over it, kept on the device (D222, D223)", async ({
    page,
  }) => {
    await openDemo(page, "agenda");
    let settings = await openSettings(page);
    await settings.getByRole("button", { name: "Add a word with a picture" }).click();
    const editor = page.getByRole("dialog", { name: "A word's picture" });
    await editor.getByRole("textbox", { name: "Word" }).fill("stand");
    const chooser = page.waitForEvent("filechooser");
    await editor.getByRole("button", { name: "Choose a picture" }).click();
    await (await chooser).setFiles({ name: "team.png", mimeType: "image/png", buffer: OWN });
    await expect(editor.locator("img")).toHaveAttribute("src", /^blob:/);
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).toHaveCount(0);
    await expect(settings.getByRole("listitem").filter({ hasText: "stand" })).toBeVisible();
    await settings.getByRole("button", { name: "Close settings" }).click();

    const standUp = page.getByRole("listitem", { name: /^Stand-up/ }).first();
    await expect(standUp.locator("img")).toHaveAttribute("src", /^blob:/);
    expect(await loaded(standUp.locator("img"))).toBe(true);
    // Kept on the device: another load draws it too.
    await page.reload();
    await expect(
      page
        .getByRole("listitem", { name: /^Stand-up/ })
        .first()
        .locator("img"),
    ).toHaveAttribute("src", /^blob:/);

    // A file that is no picture is refused, said in the dialog.
    settings = await openSettings(page);
    await settings.getByRole("button", { name: "Add a word with a picture" }).click();
    const again = page.getByRole("dialog", { name: "A word's picture" });
    const refused = page.waitForEvent("filechooser");
    await again.getByRole("button", { name: "Choose a picture" }).click();
    await (
      await refused
    ).setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("no") });
    await expect(again.getByRole("alert")).toHaveText(
      "That file is not a picture this device can read",
    );
    await expect(again.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("a picture picked in a dialog closed unsaved is not kept; an existing word's dialog says it edits (D222, D223)", async ({
    page,
  }) => {
    const stored = () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const open = indexedDB.open("astrotime-pictures", 1);
            open.addEventListener("upgradeneeded", () => open.result.createObjectStore("pictures"));
            open.addEventListener("error", () => reject(open.error));
            open.addEventListener("success", () => {
              const count = open.result.transaction("pictures").objectStore("pictures").count();
              count.addEventListener("success", () => {
                open.result.close();
                resolve(count.result);
              });
            });
          }),
      );
    await openDemo(page, "agenda");
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Add a word with a picture" }).click();
    const editor = page.getByRole("dialog", { name: "A word's picture" });
    const chooser = page.waitForEvent("filechooser");
    await editor.getByRole("button", { name: "Choose a picture" }).click();
    await (await chooser).setFiles({ name: "team.png", mimeType: "image/png", buffer: OWN });
    await expect(editor.locator("img")).toHaveAttribute("src", /^blob:/);
    expect(await stored()).toBe(1);
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    // The form's delete began as it closed; a later transaction on the store waits for it.
    expect(await stored()).toBe(0);
    // An existing word's dialog says it edits.
    await settings.getByRole("button", { name: "Add a word with a picture" }).click();
    const fresh = page.getByRole("dialog", { name: "A word's picture" });
    await fresh.getByRole("textbox", { name: "Word" }).fill("stand");
    const again = page.waitForEvent("filechooser");
    await fresh.getByRole("button", { name: "Choose a picture" }).click();
    await (await again).setFiles({ name: "team.png", mimeType: "image/png", buffer: OWN });
    await expect(fresh.locator("img")).toHaveAttribute("src", /^blob:/);
    await fresh.getByRole("button", { name: "Save" }).click();
    await settings.getByRole("listitem").filter({ hasText: "stand" }).getByRole("button").click();
    await expect(page.getByRole("dialog", { name: "Change a word's picture" })).toBeVisible();
  });

  test("a month banner of the user's own, and back to AstroTime's (D223)", async ({ page }) => {
    await openDemo(page, "agenda");
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: /^Your month banners/ }).click();
    const banners = page.getByRole("dialog", { name: "Your month banners" });
    const chooser = page.waitForEvent("filechooser");
    await banners.getByRole("button", { name: "Choose a picture for December" }).click();
    await (await chooser).setFiles({ name: "snow.png", mimeType: "image/png", buffer: OWN });
    const reset = banners.getByRole("button", { name: "Back to AstroTime's for December" });
    await expect(reset).toBeVisible();
    await page.keyboard.press("Escape");
    await settings.getByRole("button", { name: "Close settings" }).click();
    const december = page.getByRole("heading", { name: "December", exact: true });
    await december.scrollIntoViewIfNeeded();
    const banner = page.locator(".month-banner", { has: december });
    await expect(banner.locator("img")).toHaveAttribute("src", /^blob:/);

    const again = await openSettings(page);
    await again.getByRole("button", { name: /^Your month banners/ }).click();
    await page
      .getByRole("dialog", { name: "Your month banners" })
      .getByRole("button", { name: "Back to AstroTime's for December" })
      .click();
    await page.keyboard.press("Escape");
    await again.getByRole("button", { name: "Close settings" }).click();
    await expect(banner.locator("img")).toHaveAttribute("src", /month-12/);
  });
});
