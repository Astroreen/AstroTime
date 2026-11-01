// The web app's service worker (docs/plans/foundation.md#D124): the app's
// files of this version, kept so the app starts with no network, and its
// page, from the network first, from the cache when there is none. Built to
// /sw.js as one classic script (its import is bundled in); the build fills in
// the two constants below (apps/web/service-worker.ts). CalDAV through
// /dav-proxy/ and anything else that is not the app's is never touched.
import { isAppPage, namedFiles, presetOf, withoutPreset, withPresetBack } from "./page.ts";

declare const self: ServiceWorkerGlobalScope;
/** Every file of this version, by path; `/` is the page. */
declare const ASTROTIME_PRECACHE: readonly string[];
/** This version: a hash of its files. */
declare const ASTROTIME_VERSION: string;

const PREFIX = "astrotime-";
const CACHE = `${PREFIX}${ASTROTIME_VERSION}`;
const FILES = new Set(ASTROTIME_PRECACHE);
/** The versions kept, newest last: this one and the one before, for pages it still runs. */
const VERSIONS = `${PREFIX}versions`;
/** Where the preset of the latest network page is kept, beside the page, in this version's cache. */
const PRESET = "/.astrotime-preset";

/**
 * How long a navigation waits for the network's answer to begin before the
 * kept page answers: on a connection that stalls (lie-fi), a fetch may
 * settle only after tens of seconds. The network's answer, when it comes,
 * still refreshes the cache. A page may set it (`astrotime-navigation-bound`),
 * which the tests do so that none waits on time passing.
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
  await cache.put("/", new Response(html, { status: answer.status, headers }));
  await cache.put(PRESET, new Response(presetOf(text)));
}

/** The kept page, with the preset the latest network page had; none before the install kept one. */
async function keptPage(): Promise<Response | undefined> {
  const cache = await caches.open(CACHE);
  const [page, preset] = await Promise.all([cache.match("/"), cache.match(PRESET)]);
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
        await cache.addAll([...FILES].filter((path) => path !== "/"));
        const page = await fetch("/", { cache: "no-store" });
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
  // runs the older page, and may still ask for its files. Older ones go.
  event.waitUntil(
    (async () => {
      const store = await caches.open(VERSIONS);
      const listed = await store.match("/");
      const before = listed ? ((await listed.json()) as string[]) : [];
      const kept = [...before.filter((name) => name !== CACHE), CACHE].slice(-2);
      await store.put("/", Response.json(kept));
      for (const name of await caches.keys())
        if (name.startsWith(PREFIX) && name !== VERSIONS && !kept.includes(name))
          await caches.delete(name);
    })(),
  );
});

self.addEventListener("message", (event) => {
  // The user chose to reload into the version waiting (D124).
  if (event.data === "astrotime-update") void self.skipWaiting();
  const data = event.data as { type?: unknown; ms?: unknown } | null;
  if (data?.type === "astrotime-navigation-bound" && typeof data.ms === "number") {
    navigationBound = data.ms;
    event.ports[0]?.postMessage("set");
  }
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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const base = new URL(self.registration.scope).pathname;
  if (request.mode === "navigate") {
    // Only the app's own pages; CalDAV's proxy and anything else go to the network untouched.
    if (isAppPage(url.pathname, base)) event.respondWith(navigate(event));
    return;
  }
  // The page answers navigations only; a script's fetch of it goes to the server.
  if (url.pathname === "/" || url.pathname === PRESET) return;
  if (FILES.has(url.pathname)) {
    event.respondWith(
      caches.match(url.pathname, { cacheName: CACHE }).then((kept) => kept ?? fetch(request)),
    );
    return;
  }
  // A file of the version before, for a tab that still runs its page: from
  // its cache while it is kept, else from the network.
  if (url.pathname.startsWith(`${base}assets/`)) {
    event.respondWith(caches.match(url.pathname).then((kept) => kept ?? fetch(request)));
  }
});
