// What the service worker reads of the app's page (docs/plans/foundation.md#D124),
// apart from the worker so it is tested on its own. It imports nothing: a
// module the app shares would become a chunk of both, and the worker must be
// one classic script. The preset's names are `@astrotime/caldav`'s
// PRESET_MARK and PRESET_META, which page.test.ts holds these to.

export const PRESET_MARK = {
  start: "<!-- astrotime-preset -->",
  end: "<!-- /astrotime-preset -->",
} as const;
export const PRESET_META = {
  server: "astrotime-server",
  username: "astrotime-username",
  places: "astrotime-places",
} as const;

const escaped = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The preset's block, as the server marks it (D123). */
const BLOCK = new RegExp(`${escaped(PRESET_MARK.start)}[\\s\\S]*?${escaped(PRESET_MARK.end)}`, "g");
/** A preset tag wherever it is and however it is written: any attribute order, quotes, closing. */
const TAG = new RegExp(
  `<meta\\b(?=[^>]*\\bname\\s*=\\s*["']?(?:${Object.values(PRESET_META).map(escaped).join("|")})["'\\s/>])[^>]*>`,
  "gi",
);

/** The page without a deployment's preset, which only the server says, on every load. */
export function withoutPreset(html: string): string {
  return html.replace(BLOCK, "").replace(TAG, "");
}

/** The app's own files the page names (`src` and `href` on the app's origin), by path. */
export function namedFiles(html: string): string[] {
  const paths = new Set<string>();
  for (const [, path] of html.matchAll(/\b(?:src|href)\s*=\s*["'](\/(?!\/)[^"'?#]*)/gi))
    if (path) paths.add(path);
  return [...paths];
}

/**
 * Whether a navigation is one of the app's own pages, under its scope `base`:
 * a route of the single-page app, never the CalDAV proxy, the health check,
 * or a file (a path whose last part has an extension).
 */
export function isAppPage(pathname: string, base: string): boolean {
  if (!pathname.startsWith(base)) return false;
  const rest = pathname.slice(base.length);
  if (rest.startsWith("dav-proxy/") || rest === "dav-proxy" || rest === "healthz") return false;
  return !/\.[^/]+$/.test(rest);
}

/** The page's preset tags as the server wrote them, to give a kept page back; empty without one. */
export function presetOf(html: string): string {
  return [...html.matchAll(BLOCK), ...withoutBlock(html).matchAll(TAG)]
    .map(([found]) => found)
    .join("");
}

const withoutBlock = (html: string) => html.replace(BLOCK, "");

/** A kept page with the preset the latest network page had, in its head. */
export function withPresetBack(html: string, preset: string): string {
  return preset === "" ? html : html.replace("</head>", () => `${preset}</head>`);
}

/**
 * What the worker does with a GET of the app's origin, under its scope `base`
 * (D124): a navigation to one of the app's pages gets the `page`; a file this
 * version lists, its own (`file`); a picture it lists to keep as it is first
 * shown (design D219), kept then (`picture`); another file under `assets/`,
 * the version before's for a tab still on it (`older`); everything else, the
 * page's own path and the kept preset included, goes to the network
 * untouched (`null`).
 */
export function routeOf(
  pathname: string,
  navigation: boolean,
  base: string,
  listed: ReadonlySet<string>,
  pictures: ReadonlySet<string> = new Set(),
): "page" | "file" | "picture" | "older" | null {
  if (navigation) return isAppPage(pathname, base) ? "page" : null;
  if (pathname === base || pathname === presetKey(base)) return null;
  if (listed.has(pathname)) return "file";
  if (pictures.has(pathname)) return "picture";
  return pathname.startsWith(`${base}assets/`) ? "older" : null;
}

/** Where the preset of the latest network page is kept, beside the page. */
export const presetKey = (base: string) => `${base}.astrotime-preset`;

/** What `carryPictures` reads and writes: the kept versions' caches, and this version's. */
interface PictureCaches {
  match(path: string, cacheName: string): Promise<Response | undefined>;
  put(path: string, picture: Response): Promise<void>;
}

/**
 * Gives a new version the pictures a kept version showed (design D219),
 * looked up at once, one version after another per picture. Only an
 * optimisation: a picture that cannot be read or written (a quota, a
 * damaged cache) is left to be fetched when it is next shown, and never
 * fails the install. Resolves with the paths carried.
 */
export async function carryPictures(
  pictures: Iterable<string>,
  versions: readonly string[],
  caches: PictureCaches,
): Promise<string[]> {
  const carried = await Promise.all(
    [...pictures].map(async (path) => {
      try {
        for (const cacheName of versions) {
          const shown = await caches.match(path, cacheName);
          if (shown) {
            await caches.put(path, shown);
            return path;
          }
        }
      } catch {
        // Not carried: fetched again when shown.
      }
      return null;
    }),
  );
  return carried.filter((path) => path !== null);
}

/**
 * Whether an answer for a picture is one to keep (design D219): the app's
 * own (`basic`), and whole (200): never a partial one (206), an error, or a
 * redirect's end.
 */
export function keepsPicture(answer: Pick<Response, "status" | "type">): boolean {
  return answer.status === 200 && answer.type === "basic";
}
