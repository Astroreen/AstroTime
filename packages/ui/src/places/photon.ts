// The place search Location offers (docs/plans/design.md#D175): a Photon
// geocoder over OpenStreetMap, which allows search as you type. What the
// user types goes to it, from the page itself, never through the DAV proxy
// (foundation D178); its answers are kept per query, so a query typed again
// asks nothing.
import type { Geo, Place } from "@astrotime/core";
import { placeText } from "@astrotime/core";

/** The shortest query sent: one or two letters match half the world. */
export const MIN_QUERY = 3;

/** The places a search shows. */
const LIMIT = 6;

/** The languages the public Photon names places in; any other gets each place's own name. */
const LANGUAGES = new Set(["en", "de", "fr"]);

/** Queries kept, the oldest forgotten first. */
const KEPT = 100;

interface SearchOptions {
  /** The UI's language (`en`, `ru`). */
  readonly language: string;
  /** Places near here come first; none, the whole world alike. */
  readonly near: Geo | null;
  readonly signal?: AbortSignal;
}

/** Places for a query; none for one shorter than `MIN_QUERY`. Rejects when the service fails or the search is aborted. */
export type PlaceSearch = (query: string, options: SearchOptions) => Promise<readonly Place[]>;

/** A Photon feature's properties, the ones read (GeocodeJSON). */
interface Properties {
  readonly name?: string;
  readonly housenumber?: string;
  readonly street?: string;
  readonly postcode?: string;
  readonly city?: string;
  readonly locality?: string;
  readonly district?: string;
  readonly state?: string;
  readonly country?: string;
}

interface Feature {
  readonly properties?: Properties;
  readonly geometry?: { readonly type?: string; readonly coordinates?: readonly unknown[] };
}

/** The search of the Photon at `endpoint` (its `/api/` address). */
export function photon(
  endpoint: string,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): PlaceSearch {
  const kept = new Map<string, readonly Place[]>();
  return async (query, { language, near, signal }) => {
    const q = query.trim().replaceAll(/\s+/g, " ");
    if (q.length < MIN_QUERY) return [];
    const lang = LANGUAGES.has(language) ? language : "default";
    // The bias rounded to a tenth of a degree: a town, for the cache and for privacy.
    const bias = near && { lat: near.lat.toFixed(1), lon: near.lon.toFixed(1) };
    const key = JSON.stringify([q.toLowerCase(), lang, bias]);
    const known = kept.get(key);
    if (known) {
      kept.delete(key);
      kept.set(key, known);
      return known;
    }
    const url = new URL(endpoint);
    url.searchParams.set("q", q);
    url.searchParams.set("lang", lang);
    url.searchParams.set("limit", String(LIMIT));
    if (bias) {
      url.searchParams.set("lat", bias.lat);
      url.searchParams.set("lon", bias.lon);
    }
    const answer = await fetch(url, { signal: signal ?? null, credentials: "omit" });
    if (!answer.ok) throw new Error(`Photon answered ${answer.status}`);
    const places = placesOf(await answer.json());
    kept.set(key, places);
    if (kept.size > KEPT) kept.delete(kept.keys().next().value!);
    return places;
  };
}

/** The places of a Photon answer, each text once: Photon lists a place's node and way alike. */
export function placesOf(answer: unknown): Place[] {
  const features = (answer as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const places = new Map<string, Place>();
  for (const feature of features as Feature[]) {
    const place = placeOf(feature);
    if (place && !places.has(placeText(place))) places.set(placeText(place), place);
  }
  return [...places.values()];
}

function placeOf({ properties: p = {}, geometry }: Feature): Place | null {
  const [lon, lat] = (geometry?.type === "Point" && geometry.coordinates) || [];
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  const street = [p.street, p.housenumber].filter(Boolean).join(" ");
  const town = p.city ?? p.locality ?? p.district;
  const lines = [
    street,
    [p.postcode, town].filter(Boolean).join(" "),
    town ? "" : p.state,
    p.country,
  ];
  const name = (p.name ?? street).trim();
  const address = lines
    .map((line) => line?.trim() ?? "")
    .filter((line, index, all) => line && line !== name && all.indexOf(line) === index)
    .join(", ");
  if (!name && !address) return null;
  return { name, address, geo: { lat, lon } };
}
