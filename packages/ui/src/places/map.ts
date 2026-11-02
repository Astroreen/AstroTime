// The place card's map and links (docs/plans/design.md#D177): a few of
// OpenStreetMap's raster tiles around the place with a pin, no map library;
// "Open in maps" as OpenStreetMap's page, or Android's `geo:` URI.
import type { Geo } from "@astrotime/core";

const TILE = 256;

/** Close enough to see the street, far enough to see the streets around it. */
const ZOOM = 16;

/** A tile of the map and where it goes in the map's box, in CSS pixels from its top left. */
export interface Tile {
  readonly src: string;
  readonly left: number;
  readonly top: number;
}

/**
 * The tiles that cover a `width` × `height` box centred on `geo`, from the
 * tile server at `tiles` (`https://tile.openstreetmap.org/`); the pin goes
 * in the box's centre.
 */
export function tilesAround(geo: Geo, width: number, height: number, tiles: string): Tile[] {
  const n = 2 ** ZOOM;
  const lat = (Math.max(-85.0511, Math.min(85.0511, geo.lat)) * Math.PI) / 180;
  const x = ((geo.lon + 180) / 360) * n * TILE;
  const y = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n * TILE;
  const [left, top] = [x - width / 2, y - height / 2];
  const result: Tile[] = [];
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height - 1) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width - 1) / TILE); tx++) {
      const wrapped = ((tx % n) + n) % n;
      result.push({
        src: new URL(`${ZOOM}/${wrapped}/${ty}.png`, tiles).href,
        left: Math.round(tx * TILE - left),
        top: Math.round(ty * TILE - top),
      });
    }
  }
  return result;
}

/** How "Open in maps" opens a place: OpenStreetMap's page, or the `geo:` URI Android hands a maps app. */
export type MapLinks = "web" | "geo";

/** "Open in maps" for a place: its point when it has one, else a search for its text. */
export function mapsLink(text: string, geo: Geo | null, links: MapLinks): string {
  if (links === "geo") {
    // The label sits in parentheses, which encodeURIComponent leaves as they are.
    const label = encodeURIComponent(text).replaceAll("(", "%28").replaceAll(")", "%29");
    return geo
      ? `geo:${geo.lat},${geo.lon}?q=${geo.lat},${geo.lon}(${label})`
      : `geo:0,0?q=${label}`;
  }
  return geo
    ? `https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}#map=17/${geo.lat}/${geo.lon}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(text)}`;
}

/**
 * A place's name and address from its `LOCATION`: Apple writes them on two
 * lines, AstroTime and Google as "name, address".
 */
export function nameAndAddress(location: string): { name: string; address: string } {
  const text = location.trim();
  const at = text.includes("\n") ? text.indexOf("\n") : text.indexOf(", ");
  if (at < 0) return { name: text, address: "" };
  const gap = text[at] === "\n" ? 1 : 2;
  return { name: text.slice(0, at).trim(), address: text.slice(at + gap).trim() };
}
