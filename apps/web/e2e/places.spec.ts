// Places on the map end to end (docs/plans/design.md#D175, D177), on the
// demo data with the clock frozen: Location searches places as the user
// types, a place picked shows in the details with its map, free text stays
// text, and with the setting off nothing is asked. Photon answers with the
// answers recorded from it (packages/ui/test/fixtures/README.md) and the
// tiles are a blank image: no test reaches the network.
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

const recorded = readFileSync(
  new URL("../../../packages/ui/test/fixtures/photon-en.json", import.meta.url),
  "utf8",
);
/** A white tile: a 1×1 PNG, which the map draws at 256 × 256. */
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

/** Photon and the tile server, faked; what each was asked. */
async function fakeServices(page: Page) {
  const searched: URL[] = [];
  const tiles: string[] = [];
  await page.route("https://photon.komoot.io/api/**", (route) => {
    searched.push(new URL(route.request().url()));
    return route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: recorded,
    });
  });
  await page.route("https://tile.openstreetmap.org/**", (route) => {
    tiles.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: TILE });
  });
  return { searched, tiles };
}

const GATE = "Brandenburg Gate, Pariser Platz 1, 10117 Berlin, Germany";

for (const [name, device] of [
  ["wide", { viewport: WIDE }],
  ["phone", { viewport: PHONE, hasTouch: true, isMobile: true }],
] as const) {
  test.describe(`on a ${name} screen`, () => {
    test.use(device);

    test("a place picked from Location's search shows in the details with its map and links", async ({
      page,
      context,
    }) => {
      const { searched, tiles } = await fakeServices(page);
      await openDemo(page, "day");
      await page.getByRole("button", { name: "Create" }).click();
      const dialog = page.getByRole("dialog", { name: "New event" });
      await dialog.getByRole("textbox", { name: "Title" }).fill("Walk");
      const location = dialog.getByRole("combobox", { name: "Location" });
      await location.fill("Brandenburger");
      const results = page.getByRole("listbox", { name: "Places" });
      const gate = results.getByRole("option", { name: /^Brandenburg Gate/ });
      if (name === "phone") await gate.tap();
      else await gate.click();
      await expect(location).toHaveValue(GATE);
      // One search for the pause, in the UI's language, sent from the page itself.
      expect(
        searched.map((url) => [url.searchParams.get("q"), url.searchParams.get("lang")]),
      ).toEqual([["Brandenburger", "en"]]);
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toHaveCount(0);

      await page
        .getByRole("list", { name: "Wednesday, November 4" })
        .getByRole("button", { name: /^Walk, / })
        .click();
      const details = page.getByRole("dialog", { name: "Walk" });
      await expect(details.getByText("Brandenburg Gate", { exact: true })).toBeVisible();
      await expect(details.getByText("Pariser Platz 1, 10117 Berlin, Germany")).toBeVisible();
      await expect(details.getByRole("img", { name: "Map of Brandenburg Gate" })).toBeVisible();
      await expect(details.getByRole("link", { name: "© OpenStreetMap" })).toHaveAttribute(
        "href",
        "https://www.openstreetmap.org/copyright",
      );
      await expect(details.getByRole("link", { name: "Open in maps" })).toHaveAttribute(
        "href",
        "https://www.openstreetmap.org/?mlat=52.51627&mlon=13.377703#map=17/52.51627/13.377703",
      );
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.every((url) => url.startsWith("https://tile.openstreetmap.org/16/"))).toBe(true);

      // A tap on the map opens it in maps, as the icon button does (design D238).
      await context.route("https://www.openstreetmap.org/**", (route) =>
        route.fulfill({ contentType: "text/html", body: "<title>maps</title>" }),
      );
      const opened = page.waitForEvent("popup");
      const map = details.getByRole("img", { name: "Map of Brandenburg Gate" });
      // The map's own link lies over it, out of the accessibility tree: the
      // tap goes where the map is drawn, as a finger's does.
      if (name === "phone") await map.tap({ force: true });
      else await map.click({ force: true });
      const maps = await opened;
      await maps.waitForLoadState();
      expect(maps.url()).toBe(
        "https://www.openstreetmap.org/?mlat=52.51627&mlon=13.377703#map=17/52.51627/13.377703",
      );
    });
  });
}

test.use({ viewport: WIDE });

test("text typed and not picked stays text: no map, and maps search for it", async ({ page }) => {
  const { tiles } = await fakeServices(page);
  await openDemo(page, "day");
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Design review, / })
    .click();
  const details = page.getByRole("dialog", { name: "Design review" });
  await expect(details.getByText("Room 4, second floor")).toBeVisible();
  await expect(details.getByRole("img", { name: /^Map of/ })).toHaveCount(0);
  await expect(details.getByRole("link", { name: "Open in maps" })).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/search?query=Room%204%2C%20second%20floor",
  );
  expect(tiles).toEqual([]);
});

test("a search that fails (a captive portal's page) leaves Location a text field", async ({
  page,
}) => {
  await page.route("https://photon.komoot.io/api/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html>Sign in to the Wi-Fi</html>" }),
  );
  await openDemo(page, "day");
  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Walk");
  const answered = page.waitForResponse((answer) => answer.url().startsWith("https://photon"));
  await dialog.getByRole("combobox", { name: "Location" }).fill("Brandenburger Tor");
  await answered;
  await expect(page.getByRole("listbox", { name: "Places" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Walk, / })
    .click();
  const details = page.getByRole("dialog", { name: "Walk" });
  await expect(details.getByText("Brandenburger Tor")).toBeVisible();
  await expect(details.getByRole("img", { name: /^Map of/ })).toHaveCount(0);
});

test("Copy address copies the text and says so; refused, the notice says it was not", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openDemo(page, "day");
  const open = async () => {
    await page
      .getByRole("list", { name: "Wednesday, November 4" })
      .getByRole("button", { name: /^Design review, / })
      .click();
    return page.getByRole("dialog", { name: "Design review" });
  };
  const details = await open();
  // Two icon buttons at the end of the address's line, each with its tooltip (design D238).
  const copy = details.getByRole("button", { name: "Copy address" });
  await expect(copy).toHaveAttribute("title", "Copy address");
  await expect(details.getByRole("link", { name: "Open in maps" })).toHaveAttribute(
    "title",
    "Open in maps",
  );
  await copy.click();
  await expect(details.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Room 4, second floor");
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);

  // A tap on the address itself copies it too, and says so.
  await page.evaluate(() => navigator.clipboard.writeText(""));
  const tapped = await open();
  // Its tap target lies over the text, out of the accessibility tree.
  await tapped.getByText("Room 4, second floor").click({ force: true });
  await expect(tapped.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Room 4, second floor");
  await page.keyboard.press("Escape");
  await expect(tapped).toHaveCount(0);

  // The clipboard refuses: the change notice says so, over the details.
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException("No", "NotAllowedError"));
  });
  const again = await open();
  await again.getByRole("button", { name: "Copy address" }).click();
  await expect(page.getByRole("alert")).toHaveText("The address could not be copied.");
  await expect(again.getByRole("button", { name: "Copy address" })).toBeVisible();
});

test("with places off in Settings, Location is a text field that asks nothing", async ({
  page,
}) => {
  const { searched } = await fakeServices(page);
  await openDemo(page, "day");
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const toggle = settings.getByRole("switch", { name: "Search places on the map" });
  await expect(toggle).toBeChecked();
  await expect(
    settings.getByText(
      "What you type in Location goes to photon.komoot.io to find places, and the maps of places come from tile.openstreetmap.org.",
    ),
  ).toBeVisible();
  await toggle.click();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await expect(dialog.getByRole("combobox", { name: "Location" })).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Location" }).fill("Brandenburger Tor");
  await dialog.getByRole("textbox", { name: "Title" }).fill("Walk");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  expect(searched).toEqual([]);
});
