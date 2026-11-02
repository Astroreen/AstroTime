// A single-user deployment's preset (docs/plans/foundation.md#D123): the
// CalDAV server, and the user name, the person who runs an AstroTime names
// for whoever opens it, so signing in asks only for the password. The image's
// server and the dev server put it in the page as two <meta> tags; it holds
// nothing secret, since anyone who reaches the page reads it.

/** The CalDAV server and user name the deployment names; `username` null: typed by the user. */
export interface Preset {
  readonly server: string;
  readonly username: string | null;
}

/**
 * The comments the preset's tags sit between, so whatever keeps the page
 * (the web app's service worker, D124) can leave them out whole.
 */
export const PRESET_MARK = {
  start: "<!-- astrotime-preset -->",
  end: "<!-- /astrotime-preset -->",
} as const;

/** The <meta> names the page carries the preset under. */
export const PRESET_META = {
  server: "astrotime-server",
  username: "astrotime-username",
  places: "astrotime-places",
} as const;

/**
 * Places on the map (docs/plans/foundation.md#D178): the Photon geocoder
 * Location searches, the public one unless a deployment names its own, and
 * OpenStreetMap's tiles the place card's map is drawn from. The deployment
 * names them with the preset, since its server sends the page's policy too.
 */
export const PLACES = {
  photon: "https://photon.komoot.io/api/",
  tiles: "https://tile.openstreetmap.org/",
} as const;

/** What the page's `astrotime-places` tag says when the deployment turned places off. */
export const PLACES_OFF = "off";

/**
 * The Photon Location searches, from `ASTROTIME_PLACES_URL`: unset, the
 * public one; `off`, none (no search, and no map in the place card); else a
 * self-hosted Photon's `/api/` address. Throws on one that is no web address.
 */
export function placesFrom(env: Record<string, string | undefined>): string | null {
  const typed = env["ASTROTIME_PLACES_URL"]?.trim() ?? "";
  if (typed === "") return PLACES.photon;
  if (typed.toLowerCase() === PLACES_OFF) return null;
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    url = new URL("invalid:");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error(
      `ASTROTIME_PLACES_URL: "${typed}" is not a Photon address like https://photon.example.com/api/, nor "off"`,
    );
  }
  url.hash = "";
  url.search = "";
  return url.href;
}

/**
 * The preset from the environment: `ASTROTIME_SERVER_URL` (an http or https
 * address) and `ASTROTIME_USERNAME`; none without a server. Throws on a
 * server that is no web address, or a user name without a server, so a
 * typo stops the server rather than show an app that cannot sign in.
 */
export function presetFrom(env: Record<string, string | undefined>): Preset | null {
  const typed = env["ASTROTIME_SERVER_URL"]?.trim() ?? "";
  const username = env["ASTROTIME_USERNAME"]?.trim() || null;
  if (typed === "") {
    if (username !== null)
      throw new Error("ASTROTIME_USERNAME needs ASTROTIME_SERVER_URL, the server it signs in to.");
    return null;
  }
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    url = new URL("invalid:");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error(
      `ASTROTIME_SERVER_URL: "${typed}" is not a server address like https://cloud.example.com`,
    );
  }
  url.hash = "";
  url.search = "";
  return { server: url.href, username };
}

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * The preset as the page's <meta> tags, to go before `</head>`, with the
 * place search when it is not the public Photon (`placesFrom`'s); empty
 * when there is nothing to say.
 */
export function presetTags(preset: Preset | null, places: string | null = PLACES.photon): string {
  const tag = (name: string, value: string) => `<meta name="${name}" content="${escape(value)}" />`;
  const tags = [
    ...(preset ? [tag(PRESET_META.server, preset.server)] : []),
    ...(preset && preset.username !== null ? [tag(PRESET_META.username, preset.username)] : []),
    ...(places === PLACES.photon ? [] : [tag(PRESET_META.places, places ?? PLACES_OFF)]),
  ];
  return tags.length === 0 ? "" : [PRESET_MARK.start, ...tags, PRESET_MARK.end].join("");
}

/**
 * The page's HTML with the preset in its head; as it was without one. A
 * replacer function, so `$&`, `$'` and the like in a preset stay as written.
 */
export function withPreset(
  html: string,
  preset: Preset | null,
  places: string | null = PLACES.photon,
): string {
  const tags = presetTags(preset, places);
  return tags ? html.replace("</head>", () => `${tags}</head>`) : html;
}
