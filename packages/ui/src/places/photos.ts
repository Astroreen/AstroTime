// A place's photo (docs/plans/design.md#D220, D221): for an item with no
// illustrated word but a place with a point, Wikipedia's article on that
// place, found by its name near its point, and the article's free photo
// from Wikimedia Commons, with its author and licence. What goes out is the
// place's name and its point rounded to about 100 m, from the page itself
// (foundation D178's way); each place is asked about once, its answer kept
// on this device, a place with no photo too.
import { PLACES } from "@astrotime/caldav";
import type { Geo } from "@astrotime/core";
import { foldForSearch } from "@astrotime/storage";

import type { Preferences } from "../preferences.ts";

export interface PlacePhoto {
  /** The photo, 960 px wide. */
  readonly url: string;
  /** The same, 500 px wide, for a phone's card. */
  readonly small: string;
  /** The Wikipedia article it illustrates. */
  readonly article: string;
  /** The photo's page on Wikimedia Commons, with its full credit. */
  readonly source: string;
  /** Its author, as plain text; none when Commons names none. */
  readonly author: string | null;
  /** Its licence's short name ("CC BY-SA 4.0", "Public domain"). */
  readonly licence: string;
  readonly licenceUrl: string | null;
}

export interface PhotoPlace {
  readonly name: string;
  readonly geo: Geo;
}

/** The Wikipedia a language asks: its own where there is one, else English's. */
export const wikipediaOf = (language: string) =>
  language === "ru" ? PLACES.wikipedias.ru : PLACES.wikipedias.en;

/** What a place's photo is kept as, `null` when there is none, with when it was asked. */
interface Kept {
  readonly photo: PlacePhoto | null;
  readonly at: number;
}

/** Places kept, the oldest forgotten first. */
const KEPT = 300;
/** How long "no photo" stands before the place is asked about again: a new article may come. */
const NONE_FOR_MS = 30 * 24 * 60 * 60 * 1000;
/** How far from the point the article may be: a town's article sits at its middle. */
const RADIUS = "1km";

const KEY = "astrotime.placePhotos";

/** The words of a place's name, folded; only those of three letters or more count. */
const wordsOf = (text: string) =>
  (foldForSearch(text).match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length >= 3);

/** Words many places' names share, which say nothing of which place it is. */
const GENERIC = new Set(
  [
    "the",
    "and",
    "square",
    "street",
    "avenue",
    "road",
    "park",
    "station",
    "cafe",
    "bar",
    "restaurant",
    "church",
    "museum",
    "hotel",
    "centre",
    "center",
    "house",
    "hall",
    "площадь",
    "улица",
    "проспект",
    "переулок",
    "парк",
    "сквер",
    "станция",
    "вокзал",
    "кафе",
    "ресторан",
    "бар",
    "церковь",
    "собор",
    "музей",
    "гостиница",
    "отель",
    "дом",
  ].map((word) => foldForSearch(word)),
);

/**
 * Whether an article's title names the place: a word of each that begins
 * alike, five letters or the whole shorter word ("Brandenburg Gate" for
 * "Brandenburger Tor", by a redirect's search; "Красная площадь" for
 * itself), never a word many places share ("площадь", "park"), so a nearby
 * article on something else is not taken for it.
 */
export function namesPlace(title: string, name: string): boolean {
  const theirs = wordsOf(title);
  const telling = wordsOf(name).filter((word) => !GENERIC.has(word));
  return telling.some((word) =>
    theirs.some((other) => {
      const length = Math.min(5, word.length, other.length);
      return word.slice(0, length) === other.slice(0, length);
    }),
  );
}

/** The keys a place is kept under: its language, name and point rounded as asked. */
const keyOf = (place: PhotoPlace, language: string) =>
  `${language}|${foldForSearch(place.name)}|${place.geo.lat.toFixed(3)},${place.geo.lon.toFixed(3)}`;

/** The answer kept for a place, if one is: a photo, or `null` for none. */
export type PhotoLookup = {
  /** What is known now, without asking: a photo, `null` for none, `undefined` when not yet asked. */
  known(place: PhotoPlace, language: string): PlacePhoto | null | undefined;
  /** Asks, one place at a time; resolves `null` for no photo, rejects when the service fails. */
  find(place: PhotoPlace, language: string): Promise<PlacePhoto | null>;
};

/** Place photos from Wikipedia, kept in `preferences`. */
export function wikipediaPhotos(
  preferences: Preferences,
  fetch: typeof globalThis.fetch = globalThis.fetch,
  now: () => number = Date.now,
): PhotoLookup {
  // Read once: every card asks what is known as it is drawn.
  let stored: Record<string, Kept> | undefined;
  const read = (): Record<string, Kept> => {
    if (stored) return stored;
    try {
      const value: unknown = JSON.parse(preferences.get(KEY) ?? "{}");
      stored = value && typeof value === "object" ? (value as Record<string, Kept>) : {};
    } catch {
      stored = {};
    }
    return stored;
  };
  const keep = (key: string, photo: PlacePhoto | null) => {
    const kept = read();
    delete kept[key];
    kept[key] = { photo, at: now() };
    const keys = Object.keys(kept);
    for (const old of keys.slice(0, Math.max(0, keys.length - KEPT))) delete kept[old];
    preferences.set(KEY, JSON.stringify(kept));
  };
  const known = (place: PhotoPlace, language: string) => {
    const kept = read()[keyOf(place, language)];
    if (!kept) return undefined;
    if (kept.photo === null && now() - kept.at > NONE_FOR_MS) return undefined;
    return kept.photo;
  };
  // One request at a time across the app, and one per place however many cards ask.
  let queue: Promise<unknown> = Promise.resolve();
  const asking = new Map<string, Promise<PlacePhoto | null>>();
  const find = (place: PhotoPlace, language: string) => {
    const key = keyOf(place, language);
    const already = asking.get(key);
    if (already) return already;
    const answer = queue
      .catch(() => {})
      .then(async () => {
        const again = known(place, language);
        if (again !== undefined) return again;
        const photo = await ask(place, wikipediaOf(language), fetch);
        keep(key, photo);
        return photo;
      })
      .finally(() => asking.delete(key));
    asking.set(key, answer);
    queue = answer;
    return answer;
  };
  return { known, find };
}

interface Page {
  readonly title?: string;
  readonly index?: number;
  readonly pageimage?: string;
  readonly thumbnail?: { readonly source?: string };
}

interface Metadata {
  readonly Artist?: { readonly value?: string };
  readonly LicenseShortName?: { readonly value?: string };
  readonly LicenseUrl?: { readonly value?: string };
}

async function ask(
  place: PhotoPlace,
  wiki: string,
  fetch: typeof globalThis.fetch,
): Promise<PlacePhoto | null> {
  // Only the name's words: anything else is the search's own syntax.
  const name = wordsOf(place.name).join(" ");
  if (name === "") return null;
  const { lat, lon } = place.geo;
  const found = (await query(wiki, fetch, {
    generator: "search",
    gsrsearch: `${name} nearcoord:${RADIUS},${lat.toFixed(3)},${lon.toFixed(3)}`,
    gsrlimit: "3",
    prop: "pageimages",
    piprop: "thumbnail|name",
    pithumbsize: "960",
    pilicense: "free",
  })) as { query?: { pages?: readonly Page[] } };
  const page = (found.query?.pages ?? [])
    .toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .find(
      (candidate) =>
        candidate.title &&
        candidate.pageimage &&
        candidate.thumbnail?.source &&
        namesPlace(candidate.title, place.name),
    );
  if (!page) return null;
  const file = `File:${page.pageimage!}`;
  const info = (await query(wiki, fetch, {
    titles: file,
    prop: "imageinfo",
    iiprop: "extmetadata",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl",
  })) as { query?: { pages?: readonly { imageinfo?: readonly { extmetadata?: Metadata }[] }[] } };
  const metadata = info.query?.pages?.[0]?.imageinfo?.[0]?.extmetadata;
  const licence = metadata?.LicenseShortName?.value?.trim();
  // A photo whose licence Commons does not name is not shown.
  if (!licence) return null;
  const url = new URL(page.thumbnail!.source!);
  url.search = "";
  const author = textOf(metadata?.Artist?.value ?? "");
  return {
    url: url.href,
    small: url.href.replace(/\/960px-/, "/500px-"),
    article: `${wiki}/wiki/${encodeURIComponent(page.title!.replaceAll(" ", "_"))}`,
    source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(file.replaceAll(" ", "_"))}`,
    author: author === "" ? null : author,
    licence,
    licenceUrl: metadata?.LicenseUrl?.value?.trim() || null,
  };
}

async function query(
  wiki: string,
  fetch: typeof globalThis.fetch,
  parameters: Record<string, string>,
): Promise<unknown> {
  const url = new URL("/w/api.php", wiki);
  const all = { action: "query", format: "json", formatversion: "2", origin: "*", ...parameters };
  for (const [name, value] of Object.entries(all)) url.searchParams.set(name, value);
  const answer = await fetch(url, { credentials: "omit" });
  if (!answer.ok) throw new Error(`Wikipedia answered ${answer.status}`);
  return answer.json();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

/** Commons' HTML credit as text: its tags gone, its entities read, its spaces one. */
export function textOf(html: string): string {
  return html
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ENTITIES[entity]!)
    .replaceAll(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}
