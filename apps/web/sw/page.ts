// What the service worker reads of the app's page (docs/plans/foundation.md#D124),
// apart from the worker so it is tested on its own. It imports nothing: a
// module the app shares would become a chunk of both, and the worker must be
// one classic script. The preset's names are `@astrotime/caldav`'s
// PRESET_MARK and PRESET_META, which page.test.ts holds these to.

export const PRESET_MARK = {
  start: "<!-- astrotime-preset -->",
  end: "<!-- /astrotime-preset -->",
} as const;
export const PRESET_META = { server: "astrotime-server", username: "astrotime-username" } as const;

const escaped = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The preset's block, as the server marks it (D123). */
const BLOCK = new RegExp(`${escaped(PRESET_MARK.start)}[\\s\\S]*?${escaped(PRESET_MARK.end)}`, "g");
/** A preset tag wherever it is and however it is written: any attribute order, quotes, closing. */
const TAG = new RegExp(
  `<meta\\b(?=[^>]*\\bname\\s*=\\s*["']?(?:${escaped(PRESET_META.server)}|${escaped(PRESET_META.username)})["'\\s/>])[^>]*>`,
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
 * version lists, its own (`file`); another file under `assets/`, the version
 * before's for a tab still on it (`older`); everything else, the page's own
 * path and the kept preset included, goes to the network untouched (`null`).
 */
export function routeOf(
  pathname: string,
  navigation: boolean,
  base: string,
  listed: ReadonlySet<string>,
): "page" | "file" | "older" | null {
  if (navigation) return isAppPage(pathname, base) ? "page" : null;
  if (pathname === base || pathname === presetKey(base)) return null;
  if (listed.has(pathname)) return "file";
  return pathname.startsWith(`${base}assets/`) ? "older" : null;
}

/** Where the preset of the latest network page is kept, beside the page. */
export const presetKey = (base: string) => `${base}.astrotime-preset`;
