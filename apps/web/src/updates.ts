// The web app's service worker from the page's side (docs/plans/foundation.md#D124):
// registered in the build, and a newer version, once installed and waiting,
// told to the UI, which offers to reload into it. A page loads the version
// that runs; a reload the user asked for moves every tab to the new one,
// since an older tab's files are no longer kept.
import type { AppUpdates } from "@astrotime/ui";

/** How often a page in front of the user asks for a newer version: one small request, mostly a 304. */
const CHECK_EVERY_MS = 60 * 60_000;

export interface ServiceWorkerUpdates extends AppUpdates {
  /** Registers `/sw.js`; a failure is logged, and the app runs as it would without one. */
  register(): Promise<void>;
}

export function serviceWorkerUpdates(
  container: ServiceWorkerContainer,
  options: { reload: () => void; now?: () => number; document?: Document },
): ServiceWorkerUpdates {
  const { reload, now = () => Date.now(), document: page = globalThis.document } = options;
  const listeners = new Set<() => void>();
  let registration: ServiceWorkerRegistration | null = null;
  let waiting = false;
  let checked = now();
  // Controlled from the start: a change of controller is a new version taking
  // over, and the page reloads into it. The first install takes over nothing.
  const controlled = container.controller !== null;
  container.addEventListener("controllerchange", () => {
    if (controlled) reload();
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
      registration?.waiting?.postMessage("astrotime-update");
    },
    async register() {
      try {
        registration = await container.register("/sw.js", { scope: "/" });
      } catch (error) {
        console.error(error);
        return;
      }
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
