// The web app's service worker (docs/plans/foundation.md#D124): the app's
// files of this version, kept so the app starts with no network, and its
// page, from the network first, from the cache when there is none. Built to
// /sw.js as one classic script (its import is bundled in); the build fills in
// the two constants below (apps/web/service-worker.ts). CalDAV through
// /dav-proxy/ and anything else that is not the app's is never touched.
import { namedFiles, presetKey, presetOf, routeOf, withoutPreset, withPresetBack } from "./page.ts";

declare const self: ServiceWorkerGlobalScope;
/** Every file of this version, by path under the app's base; the base itself is the page. */
declare const ASTROTIME_PRECACHE: readonly string[];
/** This version: a hash of its files. */
declare const ASTROTIME_VERSION: string;
/** A build for the tests (`ASTROTIME_SW_TEST_HOOKS=1`), which lets a page set the navigation bound. */
declare const ASTROTIME_TEST_HOOKS: boolean;

const PREFIX = "astrotime-";
const CACHE = `${PREFIX}${ASTROTIME_VERSION}`;
const FILES = new Set(ASTROTIME_PRECACHE);
/** The versions kept, newest last, and the tabs that run the one before (`Kept`). */
const VERSIONS = `${PREFIX}versions`;
/** The app's base path, from the worker's scope; the page's own path. */
const BASE = new URL(self.registration.scope).pathname;
/** Where the preset of the latest network page is kept, beside the page, in this version's cache. */
const PRESET = presetKey(BASE);

/** What `VERSIONS` holds: the versions' caches, newest last, and the tabs open as this one activated. */
interface Kept {
  readonly versions: string[];
  readonly older: string[];
}

/**
 * How long a navigation waits for the network's answer to begin before the
 * kept page answers: on a connection that stalls (lie-fi), a fetch may
 * settle only after tens of seconds. The network's answer, when it comes,
 * still refreshes the cache. In a build for the tests a page may set it
 * (`astrotime-navigation-bound`), so that none waits on time passing; the
 * value lives in the worker's memory, so it holds until the browser stops
 * the idle worker, which a test that sets it right before a reload outruns.
 */
let navigationBound = 3_000;

/**
 * Whether an answer may be kept as the page: the server's own page itself,
 * never a redirect's end (a login page of a single sign-on in front, a
 * slash added) nor an opaque or cross-origin answer, which a navigation
 * would refuse.
 */
function keepable(answer: Response): boolean {
  return (
    answer.ok &&
    !answer.redirected &&
    answer.type === "basic" &&
    (answer.headers.get("Content-Type") ?? "").startsWith("text/html")
  );
}

/**
 * Keeps the network's page in `cache`: without a deployment's preset (D123),
 * which is kept apart and given back to the kept page each time it answers,
 * so a slow or absent network starts on the same sign-in as the server's
 * page; and without a length its body no longer has. Its policy, nonce and
 * all, stays with it, as one answer (D110). A page newer than this version's
 * list (a rolling deploy) names files it does not have: kept, it could not
 * start offline, so it is refused.
 */
async function keep(cache: Cache, answer: Response): Promise<void> {
  const text = await answer.text();
  const html = withoutPreset(text);
  const missing = namedFiles(html).filter((path) => !FILES.has(path));
  if (missing.length > 0)
    throw new Error(`The page names files this version does not have: ${missing.join(", ")}`);
  const headers = new Headers(answer.headers);
  headers.delete("Content-Length");
  await cache.put(BASE, new Response(html, { status: answer.status, headers }));
  await cache.put(PRESET, new Response(presetOf(text)));
}

/** The kept page, with the preset the latest network page had; none before the install kept one. */
async function keptPage(): Promise<Response | undefined> {
  const cache = await caches.open(CACHE);
  const [page, preset] = await Promise.all([cache.match(BASE), cache.match(PRESET)]);
  if (!page) return undefined;
  const html = withPresetBack(await page.text(), preset ? await preset.text() : "");
  return new Response(html, { status: page.status, headers: page.headers });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        // Hashed names never change their content: whatever answers is this version's.
        await cache.addAll([...FILES].filter((path) => path !== BASE));
        const page = await fetch(BASE, { cache: "no-store" });
        if (!keepable(page))
          throw new Error(`The app's page is not one to keep (${page.status}, ${page.type}).`);
        await keep(cache, page);
      } catch (error) {
        // A version that cannot start offline is no version: none of it stays.
        await caches.delete(CACHE);
        throw error;
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  // This version and the one before stay: a tab its user has not reloaded
  // runs the older page, and may still ask for its files. Those tabs are the
  // ones open when the user asked for this version (`olderTabs`); one that
  // reloads is a new tab. Activated on its own, with every tab closed, there
  // are none. Older versions go.
  event.waitUntil(
    (async () => {
      const before = await kept();
      const versions = [...before.versions.filter((name) => name !== CACHE), CACHE].slice(-2);
      const store = await caches.open(VERSIONS);
      await store.put(BASE, Response.json({ versions, older: olderTabs } satisfies Kept));
      for (const name of await caches.keys())
        if (name.startsWith(PREFIX) && name !== VERSIONS && !versions.includes(name))
          await caches.delete(name);
    })(),
  );
});

/** The tabs open when the user asked for this version: they run the older page. */
let olderTabs: string[] = [];

self.addEventListener("message", (event) => {
  // The user chose to reload into the version waiting (D124): the tabs open
  // now are on the older page, taken before this version takes them over.
  if (event.data === "astrotime-update") {
    event.waitUntil(
      (async () => {
        const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        olderTabs = open.map((client) => client.id);
        await self.skipWaiting();
      })(),
    );
    return;
  }
  if (!ASTROTIME_TEST_HOOKS) return;
  const data = event.data as { type?: unknown; ms?: unknown } | null;
  const { ms } = data ?? {};
  if (data?.type !== "astrotime-navigation-bound" || typeof ms !== "number") return;
  if (!Number.isFinite(ms) || ms < 0) return;
  navigationBound = Math.min(ms, 10_000);
  event.ports[0]?.postMessage("set");
});

/** A navigation: the network's page if it begins to answer within the bound, else the kept one. */
async function navigate(event: FetchEvent): Promise<Response> {
  // The network's page, kept in the background when it may be (a copy, as
  // the page reads the answer itself): the newest to start from next time.
  let refreshed: Promise<void> = Promise.resolve();
  const network = fetch(event.request).then((answer) => {
    if (keepable(answer)) {
      const copy = answer.clone();
      refreshed = caches
        .open(CACHE)
        .then((cache) => keep(cache, copy))
        .catch(() => {});
    }
    return answer;
  });
  event.waitUntil(network.then(() => refreshed).catch(() => {}));
  const settled = await Promise.race([
    network.then(
      (answer) => ({ answer }),
      (error: unknown) => ({ error }),
    ),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), navigationBound)),
  ]);
  // Not a byte yet: the kept page now, the network's for the next load.
  if (settled === null) return (await keptPage()) ?? network;
  if ("error" in settled) {
    const page = await keptPage();
    if (page) return page;
    throw settled.error;
  }
  // A server error (a reverse proxy's 502, 503 or 504 while the container is down).
  const { answer } = settled;
  return answer.status >= 500 ? ((await keptPage()) ?? answer) : answer;
}

/** The versions kept and the tabs on the one before, as the last activation left them. */
async function kept(): Promise<Kept> {
  const listed = await (await caches.open(VERSIONS)).match(BASE);
  const value = listed ? ((await listed.json()) as Partial<Kept>) : {};
  return { versions: value.versions ?? [], older: value.older ?? [] };
}

/**
 * A file this version does not list: the version before's, only for a tab
 * still on it (open when this version activated) and only from that
 * version's cache; anything else, or what it does not have, from the network.
 */
async function olderFile(event: FetchEvent, pathname: string): Promise<Response> {
  const { versions, older } = await kept();
  const before = versions.find((name) => name !== CACHE);
  if (before && older.includes(event.clientId)) {
    const file = await caches.match(pathname, { cacheName: before });
    if (file) return file;
  }
  return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  switch (routeOf(url.pathname, request.mode === "navigate", BASE, FILES)) {
    case "page":
      return event.respondWith(navigate(event));
    case "file":
      // This version's own file, from its own cache only.
      return event.respondWith(
        caches.match(url.pathname, { cacheName: CACHE }).then((file) => file ?? fetch(request)),
      );
    case "older":
      return event.respondWith(olderFile(event, url.pathname));
    default:
    // The CalDAV proxy, the page's own path to a script, anything else: the network's.
  }
});
