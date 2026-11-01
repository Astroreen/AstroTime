// Background sync's page (docs/plans/android.md#D67), which `SyncWorker`
// loads in a WebView of its own with no activity, on the app's origin: it
// runs one sync and says to native when it is over, however it ended.
import { Store } from "@astrotime/storage";
import { webDriver } from "@astrotime/storage/web";

import { remindersLock, syncLock } from "../locks.ts";
import { preferences } from "../preferences.ts";
import { chromiumVersion, MINIMUM_WEBVIEW } from "../webview.ts";
import { channel, type NativePort } from "./channel.ts";
import { backgroundSync } from "./run.ts";

/** The object `SyncWorker` injects, under this name. */
const port = (globalThis as { AstroTimeBackground?: NativePort }).AstroTimeBackground;

if (port) {
  const native = channel(port);
  // Anything that escapes the run still ends it, never leaving native waiting.
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
