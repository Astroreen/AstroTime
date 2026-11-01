// Background sync's page (docs/plans/android.md#D67), which `SyncWorker`
// loads in a WebView of its own with no activity, on the app's origin: it
// runs one sync and says to native when it is over, however it ended.
// Without native's object it cannot say so; it says it in its title instead,
// which native hears without the object, and the run ends at once.
import { Store } from "@astrotime/storage";
import { webDriver } from "@astrotime/storage/web";

import { remindersLock, syncLock } from "../locks.ts";
import { preferences } from "../preferences.ts";
import { chromiumVersion, MINIMUM_WEBVIEW } from "../webview.ts";
import { channel, type NativePort } from "./channel.ts";
import { backgroundSync } from "./run.ts";

/** The object `SyncWorker` injects, under this name. */
const port = (globalThis as { AstroTimeBackground?: NativePort }).AstroTimeBackground;

/** The title that tells native the object is missing (`HeadlessRun`'s `NO_PORT`). */
const NO_PORT = "astrotime-background:no-port";

// The page runs: from here its own handlers say what goes wrong (`background.html`).
(globalThis as { astrotimeBackgroundStarted?: boolean }).astrotimeBackgroundStarted = true;

if (!port) {
  document.title = NO_PORT;
} else {
  const native = channel(port);
  // Anything that escapes the run still ends it, never leaving native waiting.
  // These may say done more than once (an error after the run's own done):
  // native takes the first and ignores the rest.
  const fail = (error: unknown) =>
    native.tell("done", { error: error instanceof Error ? error.message : String(error) });
  globalThis.addEventListener("error", (event) => fail(event.error ?? event.message));
  globalThis.addEventListener("unhandledrejection", (event) => fail(event.reason));
  const run = async () => {
    // Too old for the store: the open app says so; here nothing is tried.
    const version = chromiumVersion(navigator.userAgent);
    if (version !== null && version < MINIMUM_WEBVIEW) {
      throw new Error(`WebView ${version} is older than ${MINIMUM_WEBVIEW}.`);
    }
    return backgroundSync({
      native,
      openStore: async () => Store.open(await webDriver()),
      preferences,
      languages: navigator.languages.length > 0 ? navigator.languages : [navigator.language],
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      syncLock,
      remindersLock,
    });
  };
  run().then((report) => native.tell("done", { report }), fail);
}
