// The web app's platform (docs/plans/android.md#D60): the web store, HTTP
// through the CORS proxy on the app's own origin (docs/plans/foundation.md#D39:
// `/dav-proxy/` in the dev server and in the image alike), credentials in
// IndexedDB (D89), Login Flow's page in a new tab, preferences in localStorage.
import { fetchClient, throughProxy } from "@astrotime/caldav";
import type { Store } from "@astrotime/storage";
import type { Platform } from "@astrotime/ui";

import { preferences } from "./preferences.ts";
import { indexedDbSecrets } from "./secrets.ts";

/** Where the proxy is on the app's origin, as `dav-proxy.ts` and `apps/proxy` serve it. */
const DAV_PROXY_PREFIX = "/dav-proxy/";

export function webPlatform(store: Promise<Store>): Platform {
  return {
    store,
    http: fetchClient({ via: throughProxy(DAV_PROXY_PREFIX) }),
    secrets: indexedDbSecrets(),
    // A tab of its own, which cannot reach back into this one.
    openExternal: (url) => void window.open(url, "_blank", "noopener,noreferrer"),
    preferences,
  };
}
