// A place's photo (docs/plans/design.md#D220, D221): Wikipedia's article on
// the place, found by its name near its point, and its free photo with its
// author and licence; what is sent, what is kept, and when nothing is shown.
// Wikipedia's answers are recorded ones (fixtures/README.md).
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import { namesPlace, textOf, wikipediaPhotos } from "../src/places/photos.ts";
import { memoryPreferences } from "../src/preferences.ts";

const recorded = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`fixtures/wikipedia-${name}.json`, import.meta.url), "utf8"));

const GATE = { name: "Brandenburger Tor", geo: { lat: 52.5166047, lon: 13.3809897 } };
const SQUARE = { name: "Красная площадь", geo: { lat: 55.7535908, lon: 37.6215013 } };

/** A Wikipedia answering searches with `search` and file pages with `info`, keeping what was asked. */
function fakeWikipedia(search = recorded("en-search"), info = recorded("en-imageinfo")) {
  const asked: URL[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    asked.push(url);
    const answer = url.searchParams.has("gsrsearch") ? search : info;
    return Response.json(answer);
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

describe("a place's photo from Wikipedia", () => {
  test("the article on the place, its photo, author and licence", async () => {
    const { fetch } = fakeWikipedia();
    const photos = wikipediaPhotos(memoryPreferences(), fetch);
    expect(await photos.find(GATE, "en")).toEqual({
      url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a6/Brandenburger_Tor_abends.jpg/960px-Brandenburger_Tor_abends.jpg",
      small:
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a6/Brandenburger_Tor_abends.jpg/500px-Brandenburger_Tor_abends.jpg",
      article: "https://en.wikipedia.org/wiki/Brandenburg_Gate",
      source: "https://commons.wikimedia.org/wiki/File%3ABrandenburger_Tor_abends.jpg",
      author: "Thomas Wolf, www.foto-tw.de",
      licence: "CC BY-SA 3.0",
      licenceUrl: "https://creativecommons.org/licenses/by-sa/3.0",
    });
  });

  test("sends the name and the point rounded to about 100 m, to the UI's language's Wikipedia", async () => {
    const { fetch, asked } = fakeWikipedia(recorded("ru-search"));
    await wikipediaPhotos(memoryPreferences(), fetch).find(SQUARE, "ru");
    const [search, info] = asked;
    expect(search!.origin).toBe("https://ru.wikipedia.org");
    expect(search!.searchParams.get("gsrsearch")).toBe(
      "красная площадь nearcoord:1km,55.754,37.622",
    );
    // Only free photos, and nothing that identifies the user: no cookies are sent.
    expect(search!.searchParams.get("pilicense")).toBe("free");
    expect(info!.searchParams.get("titles")).toBe("File:Kremlin_and_Red_Square.1.jpg");
    // Any other language asks English's.
    const other = fakeWikipedia();
    await wikipediaPhotos(memoryPreferences(), other.fetch).find(GATE, "de");
    expect(other.asked[0]!.origin).toBe("https://en.wikipedia.org");
  });

  test("a place Wikipedia has no article on has no photo, and that is kept too", async () => {
    const { fetch, asked } = fakeWikipedia(recorded("en-search-none"));
    const preferences = memoryPreferences();
    const photos = wikipediaPhotos(preferences, fetch);
    const cafe = { name: "Kavinė Pas Joną", geo: { lat: 54.6872, lon: 25.2797 } };
    expect(await photos.find(cafe, "en")).toBeNull();
    expect(photos.known(cafe, "en")).toBeNull();
    // Kept on the device: another start knows it without asking.
    expect(wikipediaPhotos(preferences, fetch).known(cafe, "en")).toBeNull();
    expect(asked).toHaveLength(1);
  });

  test("a place is asked about once, however many cards ask, and its photo is known after", async () => {
    const { fetch, asked } = fakeWikipedia();
    const photos = wikipediaPhotos(memoryPreferences(), fetch);
    expect(photos.known(GATE, "en")).toBeUndefined();
    const [a, b] = await Promise.all([photos.find(GATE, "en"), photos.find(GATE, "en")]);
    expect(a).toEqual(b);
    expect(asked).toHaveLength(2);
    expect(photos.known(GATE, "en")?.licence).toBe("CC BY-SA 3.0");
    await photos.find(GATE, "en");
    expect(asked).toHaveLength(2);
  });

  test("'no photo' is asked again after thirty days; a photo is kept", async () => {
    let now = 0;
    const { fetch } = fakeWikipedia(recorded("en-search-none"));
    const photos = wikipediaPhotos(memoryPreferences(), fetch, () => now);
    await photos.find(GATE, "en");
    now = 29 * 24 * 3600 * 1000;
    expect(photos.known(GATE, "en")).toBeNull();
    now = 31 * 24 * 3600 * 1000;
    expect(photos.known(GATE, "en")).toBeUndefined();
  });

  test("an article nearby on something else is not the place's", async () => {
    // The recorded search near the gate, asked for a café there: no title names it.
    const { fetch } = fakeWikipedia();
    const cafe = { name: "Café Einstein", geo: GATE.geo };
    expect(await wikipediaPhotos(memoryPreferences(), fetch).find(cafe, "en")).toBeNull();
  });

  test("a photo whose licence Commons does not name is not shown", async () => {
    const { fetch } = fakeWikipedia(recorded("en-search"), { query: { pages: [{}] } });
    expect(await wikipediaPhotos(memoryPreferences(), fetch).find(GATE, "en")).toBeNull();
  });

  test("a service that fails rejects, and nothing is kept, so it is asked again", async () => {
    const preferences = memoryPreferences();
    const failing = (async () => new Response("", { status: 503 })) as typeof globalThis.fetch;
    await expect(wikipediaPhotos(preferences, failing).find(GATE, "en")).rejects.toThrow(/503/);
    expect(wikipediaPhotos(preferences, failing).known(GATE, "en")).toBeUndefined();
  });
});

describe("whether a title names the place", () => {
  test.each([
    ["Brandenburg Gate", "Brandenburger Tor", true],
    ["Красная площадь", "Красная площадь", true],
    ["Vilnius", "Vilnius, Lithuania", true],
    ["Berlin Hauptbahnhof", "Café Einstein", false],
    ["DZ Bank Building", "Brandenburger Tor", false],
    // A word many places share is not enough.
    ["Площадь Революции (Москва)", "Красная площадь", false],
    ["Central Park", "Gorky Park", false],
  ])("%s for %s: %s", (title, name, names) => {
    expect(namesPlace(title, name)).toBe(names);
  });
});

test("Commons' HTML credit as text", () => {
  expect(textOf('<b><a href="//x">Thomas Wolf</a></b>, <small>www.foto-tw.de</small>')).toBe(
    "Thomas Wolf, www.foto-tw.de",
  );
  expect(textOf("Ann &amp; Bo &lt;3")).toBe("Ann & Bo <3");
});
