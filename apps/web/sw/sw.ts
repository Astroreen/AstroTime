// The web app's service worker (docs/plans/foundation.md#D124): the app's
// files of this version, kept so the app starts with no network, and its
// page, from the network first, from the cache when there is none. Built to
// /sw.js as one classic script (its import is bundled in); the build fills in
// the two constants below (apps/web/service-worker.ts). CalDAV through
// /dav-proxy/ and anything else that is not the app's is never touched.
import { isAppPage, namedFiles, withoutPreset } from "./page.ts";

declare const self: ServiceWorkerGlobalScope;
/** Every file of this version, by path; `/` is the page. */
declare const ASTROTIME_PRECACHE: readonly string[];
/** This version: a hash of its files. */
declare const ASTROTIME_VERSION: string;

const PREFIX = "astrotime-";
const CACHE = `${PREFIX}${ASTROTIME_VERSION}`;
const FILES = new Set(ASTROTIME_PRECACHE);

/**
 * The page as kept: without a deployment's preset (D123), which is the
 * server's to say on every load, and without a length its body no longer has.
 * Its policy, nonce and all, stays with it, as one answer (D110).
 */
async function keptPage(response: Response): Promise<Response> {
  const html = withoutPreset(await response.text());
  // A page newer than this version's list (a rolling deploy) names files it
  // does not have: kept, it could not start offline. The install fails, and
  // the next one, of the version that has them, keeps it.
  const missing = namedFiles(html).filter((path) => !FILES.has(path));
  if (missing.length > 0)
    throw new Error(`The page names files this version does not have: ${missing.join(", ")}`);
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Hashed names never change their content: whatever answers is this version's.
      await cache.addAll([...FILES].filter((path) => path !== "/"));
      const page = await fetch("/", { cache: "no-store" });
      if (!page.ok) throw new Error(`The app's page answered ${page.status}.`);
      await cache.put("/", await keptPage(page));
    })(),
  );
});

self.addEventListener("activate", (event) => {
  // An older version's files go once this one runs every page.
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    })(),
  );
});

self.addEventListener("message", (event) => {
  // The user chose to reload into the version waiting (D124).
  if (event.data === "astrotime-update") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    // Only the app's own pages; CalDAV's proxy and anything else go to the network untouched.
    if (!isAppPage(url.pathname, new URL(self.registration.scope).pathname)) return;
    // The server's page while it answers (a fresh nonce and the preset); this
    // version's when there is no network, or when what answers is a server
    // error (a reverse proxy's 502, 503 or 504 while the container is down).
    const kept = () => caches.match("/", { cacheName: CACHE });
    event.respondWith(
      fetch(request).then(
        async (answer) => (answer.status >= 500 ? ((await kept()) ?? answer) : answer),
        async (error: unknown) => {
          const page = await kept();
          if (page) return page;
          throw error;
        },
      ),
    );
    return;
  }
  if (!FILES.has(url.pathname)) return;
  event.respondWith(
    caches.match(url.pathname, { cacheName: CACHE }).then((kept) => kept ?? fetch(request)),
  );
});
