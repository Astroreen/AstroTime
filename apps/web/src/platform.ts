// The web app's platform (docs/plans/android.md#D60): the web store, HTTP
// through the CORS proxy on the app's own origin (docs/plans/foundation.md#D39:
// `/dav-proxy/` in the dev server and in the image alike), credentials in
// IndexedDB (D89), Login Flow's page in a new tab, preferences in localStorage,
// one sync at a time across the tabs (D91), and reminders as notifications
// while the app is open (D101).
import { fetchClient, throughProxy } from "@astrotime/caldav";
import type { Store } from "@astrotime/storage";
import type { Platform } from "@astrotime/ui";

import { preferences } from "./preferences.ts";
import { webReminders } from "./reminders.ts";
import { indexedDbSecrets } from "./secrets.ts";

/** Where the proxy is on the app's origin, as `dav-proxy.ts` and `apps/proxy` serve it. */
const DAV_PROXY_PREFIX = "/dav-proxy/";

/**
 * `store` is the web store named `name` on OPFS (`webDriver`'s), which every
 * tab of the origin opens (D98).
 */
export function webPlatform(store: Promise<Store>, name: string): Platform {
  return {
    store,
    http: fetchClient({ via: throughProxy(DAV_PROXY_PREFIX) }),
    secrets: indexedDbSecrets(),
    // A tab of its own, which cannot reach back into this one.
    openExternal: (url) => void window.open(url, "_blank", "noopener,noreferrer"),
    preferences,
    syncLock: tabsSyncLock(name),
    reminders: webReminders(),
  };
}

/**
 * Every tab runs the UI's sync triggers on the one store, so a sync waits
 * for another tab's to end: a Web Lock per store around each, which a tab
 * that closes lets go (docs/plans/foundation.md#D91).
 */
function tabsSyncLock(name: string): NonNullable<Platform["syncLock"]> {
  return (work) => navigator.locks.request(`astrotime-sync:${name}`, work);
}
