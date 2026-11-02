// Places on the map (docs/plans/design.md#D175, D177): Photon's answers as
// places, what the search sends and keeps, the card's map and links, and the
// edit dialog's changes for a place picked or typed. Photon's answers are
// recorded ones (fixtures/README.md); nothing here reaches the network.
import { readFileSync } from "node:fs";

import { CalendarObject, type Place } from "@astrotime/core";
import { describe, expect, test } from "vite-plus/test";

import { changesOf, formOf, newForm } from "../src/calendar/editing.ts";
import { mapsLink, nameAndAddress, tilesAround } from "../src/places/map.ts";
import { photon, placesOf } from "../src/places/photon.ts";

const recorded = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`fixtures/photon-${name}.json`, import.meta.url), "utf8"));

const ENDPOINT = "https://photon.example.org/api/";

/** A Photon that answers `answer` and keeps every URL asked. */
function fakePhoton(answer: unknown = recorded("en"), status = 200) {
  const asked: URL[] = [];
  const fetch = (async (input: string | URL | Request) => {
    asked.push(new URL(String(input)));
    return new Response(JSON.stringify(answer), { status });
  }) as typeof globalThis.fetch;
  return { search: photon(ENDPOINT, fetch), asked };
}

describe("Photon's answers as places", () => {
  test("name, address and point; a place Photon lists twice, once", () => {
    const places = placesOf(recorded("en"));
    expect(places[0]).toEqual({
      name: "Brandenburger Tor",
      address: "Unter den Linden, 10117 Berlin, Germany",
      geo: { lat: 52.5166047, lon: 13.3809897 },
    });
    // The station's node and its halt have the same text: one place.
    expect(places.map((p) => p.name)).toEqual([
      "Brandenburger Tor",
      "Brandenburger Tor",
      "Brandenburg Gate",
      "Brandenburger Tor",
    ]);
    expect(places[2]!.address).toBe("Pariser Platz 1, 10117 Berlin, Germany");
  });

  test("each place's own name in its own language, and a town's region when there is no town", () => {
    const [square] = placesOf(recorded("default"));
    expect(square).toEqual({
      name: "Красная площадь",
      address: "Москва, Россия",
      geo: { lat: 55.7535908, lon: 37.6215013 },
    });
    expect(
      placesOf({
        features: [
          {
            properties: { name: "Lake", state: "Bavaria", country: "Germany" },
            geometry: { type: "Point", coordinates: [11, 48] },
          },
          { properties: { name: "No point" } },
        ],
      }),
    ).toEqual([{ name: "Lake", address: "Bavaria, Germany", geo: { lat: 48, lon: 11 } }]);
    expect(placesOf(null)).toEqual([]);
  });
});

describe("the search", () => {
  test("asks in the UI's language where Photon has it, else for each place's own name", async () => {
    const { search, asked } = fakePhoton();
    await search("Brandenburger Tor", { language: "en", near: null });
    await search("Красная площадь", { language: "ru", near: null });
    expect(asked.map((url) => [url.origin + url.pathname, url.searchParams.get("lang")])).toEqual([
      [ENDPOINT, "en"],
      [ENDPOINT, "default"],
    ]);
    expect(asked[0]!.searchParams.get("q")).toBe("Brandenburger Tor");
    expect(asked[0]!.searchParams.get("limit")).toBe("6");
    expect(asked[0]!.searchParams.has("lat")).toBe(false);
  });

  test("prefers places near the town given, rounded to a tenth of a degree", async () => {
    const { search, asked } = fakePhoton();
    await search("Bahnhof", { language: "de", near: { lat: 52.51662, lon: 13.38099 } });
    expect([asked[0]!.searchParams.get("lat"), asked[0]!.searchParams.get("lon")]).toEqual([
      "52.5",
      "13.4",
    ]);
  });

  test("asks nothing for a query shorter than three letters, or one asked before", async () => {
    const { search, asked } = fakePhoton();
    expect(await search("  Br ", { language: "en", near: null })).toEqual([]);
    const first = await search("Brandenburger  Tor", { language: "en", near: null });
    const again = await search(" brandenburger tor", { language: "en", near: null });
    expect(again).toBe(first);
    expect(asked).toHaveLength(1);
  });

  test("a refusal rejects, and is not kept", async () => {
    const { search, asked } = fakePhoton({ message: "throttled" }, 429);
    await expect(search("Berlin", { language: "en", near: null })).rejects.toThrow(/429/);
    await expect(search("Berlin", { language: "en", near: null })).rejects.toThrow(/429/);
    expect(asked).toHaveLength(2);
  });

  test("an answer that is no JSON (a captive portal's page) rejects, and is not kept", async () => {
    const asked: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      asked.push(String(input));
      return new Response("<html>Sign in to the Wi-Fi</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }) as typeof globalThis.fetch;
    const search = photon(ENDPOINT, fetch);
    await expect(search("Berlin", { language: "en", near: null })).rejects.toThrow();
    await expect(search("Berlin", { language: "en", near: null })).rejects.toThrow();
    expect(asked).toHaveLength(2);
  });

  test("an aborted search goes with its request", async () => {
    let signal: AbortSignal | null | undefined;
    const fetch = (async (_: unknown, init?: RequestInit) => {
      signal = init?.signal;
      throw new DOMException("aborted", "AbortError");
    }) as typeof globalThis.fetch;
    const controller = new AbortController();
    controller.abort();
    await expect(
      photon(ENDPOINT, fetch)("Berlin", { language: "en", near: null, signal: controller.signal }),
    ).rejects.toThrow(/aborted/);
    expect(signal?.aborted).toBe(true);
  });
});

describe("the place card", () => {
  const gate = { lat: 52.5162, lon: 13.3777 };

  test("its map: the tiles that cover the box, the place in its centre", () => {
    const tiles = tilesAround(gate, 512, 144, "https://tile.openstreetmap.org/");
    // At zoom 16 the gate is at tile x 35203.34, y 21494.006 (OpenStreetMap's
    // slippy map formula): a box 2 tiles wide around it reaches from x
    // 35202.34 to 35204.34, and 72 px up and down, into the row above.
    expect(tiles.map((t) => t.src.slice("https://tile.openstreetmap.org/16/".length))).toEqual([
      "35202/21493.png",
      "35203/21493.png",
      "35204/21493.png",
      "35202/21494.png",
      "35203/21494.png",
      "35204/21494.png",
    ]);
    expect(tiles[0]!.top).toBeLessThanOrEqual(0);
    expect(tiles.at(-1)!.top + 256).toBeGreaterThanOrEqual(144);
    expect(tiles[0]!.left).toBeLessThanOrEqual(0);
    expect(tiles.at(-1)!.left + 256).toBeGreaterThanOrEqual(512);
  });

  test("open in maps: the point on OpenStreetMap or by geo:, else a search for the text", () => {
    expect(mapsLink("Gate", gate, "web")).toBe(
      "https://www.openstreetmap.org/?mlat=52.5162&mlon=13.3777#map=17/52.5162/13.3777",
    );
    expect(mapsLink("Brandenburg Gate, Berlin", gate, "geo")).toBe(
      "geo:52.5162,13.3777?q=52.5162,13.3777(Brandenburg%20Gate%2C%20Berlin)",
    );
    expect(mapsLink("Room 4", null, "web")).toBe(
      "https://www.openstreetmap.org/search?query=Room%204",
    );
    expect(mapsLink("Room 4", null, "geo")).toBe("geo:0,0?q=Room%204");
    // Parentheses in a name would end the label early.
    expect(mapsLink("Cafe (Old Town), Street 1", gate, "geo")).toBe(
      "geo:52.5162,13.3777?q=52.5162,13.3777(Cafe%20%28Old%20Town%29%2C%20Street%201)",
    );
  });

  test("name and address: Apple's two lines, or AstroTime's and Google's comma", () => {
    expect(nameAndAddress("Apple Park\nOne Apple Park Way, Cupertino")).toEqual({
      name: "Apple Park",
      address: "One Apple Park Way, Cupertino",
    });
    expect(nameAndAddress("Brandenburg Gate, Pariser Platz 1, Berlin")).toEqual({
      name: "Brandenburg Gate",
      address: "Pariser Platz 1, Berlin",
    });
    expect(nameAndAddress("Café")).toEqual({ name: "Café", address: "" });
  });
});

describe("the edit dialog's place (D176)", () => {
  const gate: Place = {
    name: "Brandenburg Gate",
    address: "Pariser Platz 1, 10117 Berlin, Germany",
    geo: { lat: 52.5162, lon: 13.3777 },
  };
  const text = "Brandenburg Gate, Pariser Platz 1, 10117 Berlin, Germany";
  const blank = newForm("event", {
    calendarId: "c",
    day: "2026-11-04",
    minutes: 600,
    timeZone: "Europe/Berlin",
  });

  test("a place picked is written with its point; text typed after it, as text", () => {
    expect(changesOf(null, { ...blank, location: text, place: gate }, "R").location).toBe(gate);
    expect(changesOf(null, { ...blank, location: `${text} 2`, place: gate }, "R").location).toBe(
      `${text} 2`,
    );
    expect(changesOf(null, { ...blank, location: "Café", place: null }, "R").location).toBe("Café");
  });

  test("an item's own place opens as a place, and stays untouched unless changed", () => {
    const object = CalendarObject.parse(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//test//EN",
        "BEGIN:VEVENT",
        "UID:gate",
        "DTSTAMP:20261001T000000Z",
        "DTSTART:20261104T100000Z",
        "DTEND:20261104T110000Z",
        `LOCATION:${text.replaceAll(",", "\\,")}`,
        "GEO:52.5162;13.3777",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
    const form = formOf(
      { objectId: "o", calendarId: "c", object, recurrenceId: null, item: object.master! },
      "Europe/Berlin",
      "2026-11-04",
    );
    expect(form.place).toEqual(gate);
    expect(changesOf(form, form, "R")).toEqual({});
    expect(changesOf(form, { ...form, location: "Café" }, "R").location).toBe("Café");
  });
});
