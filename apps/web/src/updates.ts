// The web app's service worker from the page's side (docs/plans/foundation.md#D124):
// registered in the build, and a newer version, once installed and waiting,
// told to the UI, which offers to reload into it. Only the tab whose user
// asked reloads; every other tab, the new version running it now, offers
// the same and reloads when its user asks, never by itself (an edit dialog
// open in it keeps its text).
import type { AppUpdates } from "@astrotime/ui";

/** How often a page in front of the user asks for a newer version: one small request, mostly a 304. */
const CHECK_EVERY_MS = 60 * 60_000;

export interface ServiceWorkerUpdates extends AppUpdates {
  /** Registers the worker; a failure is logged, and the app runs as it would without one. */
  register(): Promise<void>;
}

export function serviceWorkerUpdates(
  container: ServiceWorkerContainer,
  options: {
    reload: () => void;
    /** The app's base path (Vite's `BASE_URL`): the worker is `sw.js` there, its scope the app's. */
    base?: string;
    now?: () => number;
    document?: Pick<Document, "visibilityState" | "addEventListener">;
  },
): ServiceWorkerUpdates {
  const {
    reload,
    base = "/",
    now = () => Date.now(),
    document: page = globalThis.document,
  } = options;
  const listeners = new Set<() => void>();
  let registration: ServiceWorkerRegistration | null = null;
  let waiting = false;
  let checked = now();
  // Controlled from the start: a change of controller is a new version taking
  // over. The first install takes over nothing.
  const controlled = container.controller !== null;
  /** This tab's user asked for the new version. */
  let asked = false;
  /** The new version runs this tab now: Reload only loads it. */
  let taken = false;
  container.addEventListener("controllerchange", () => {
    if (!controlled) return;
    if (asked) return reload();
    taken = true;
    found();
  });

  const found = () => {
    if (waiting || !controlled) return;
    waiting = true;
    for (const listener of listeners) listener();
  };
  const watch = (worker: ServiceWorker | null) => {
    if (!worker) return;
    if (worker.state === "installed") found();
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") found();
    });
  };

  return {
    get waiting() {
      return waiting;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    apply() {
      if (taken) return reload();
      const waitingWorker = registration?.waiting;
      if (!waitingWorker) return;
      asked = true;
      // A worker has no origin to name; the second argument is what it is handed.
      waitingWorker.postMessage("astrotime-update", []);
    },
    async register() {
      try {
        registration = await container.register(`${base}sw.js`, { scope: base });
      } catch (error) {
        console.error(error);
        return;
      }
      // A browser that blocks workers (Playwright's `serviceWorkers: "block"`,
      // some embedders) answers with none: the app runs as it would without.
      if (!registration) return;
      const current = registration;
      if (current.waiting) found();
      watch(current.installing);
      current.addEventListener("updatefound", () => watch(current.installing));
      // A tab left open for days still hears of a new version, when in front.
      page?.addEventListener("visibilitychange", () => {
        if (page.visibilityState !== "visible" || now() - checked < CHECK_EVERY_MS) return;
        checked = now();
        current.update().catch(() => {});
      });
    },
  };
}
