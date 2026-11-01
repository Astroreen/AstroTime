// The desktop's platform (docs/plans/android.md#D60), the page's half: the
// store on a port to its process (docs/plans/desktop.md#D73), HTTP through the
// main process (D72), credentials in the keyring's care (D74), the system browser,
// preferences in localStorage, reminders shown by the main process (D76), and
// the shell that lives on with its window closed: its theme, its close, its
// sync triggers (D75). One window, one store: no sync lock (foundation D91).
import type { HttpClient } from "@astrotime/caldav";
import { OfflineError } from "@astrotime/core";
import type { Store } from "@astrotime/storage";
import { localPreferences, UnprotectedPrompt, type Platform } from "@astrotime/ui";

import { STORE_PORT, type Bridge } from "../bridge.ts";
import { desktopReminders } from "./reminders.ts";
import { desktopSecrets } from "./secrets.ts";

export function desktopPlatform(bridge: Bridge, store: Promise<Store>): Platform {
  const unprotectedPrompt = new UnprotectedPrompt();
  return {
    store,
    http: bridgeHttp(bridge),
    secrets: desktopSecrets(bridge.secrets, unprotectedPrompt),
    unprotectedPrompt,
    openExternal: (url) => bridge.openExternal(url),
    preferences: localPreferences,
    reminders: desktopReminders(bridge.reminders),
    shell: (state) => bridge.shell(state),
    onSyncRequest: (listener) => bridge.onSyncRequest(listener),
  };
}

/** The `HttpClient` on the main process's: an answer, or `OfflineError`. */
function bridgeHttp(bridge: Bridge): HttpClient {
  return async (request) => {
    const answer = await bridge.http(request);
    if ("offline" in answer) throw new OfflineError(answer.offline);
    return {
      status: answer.status,
      url: answer.url,
      header: (name) => answer.headers[name.toLowerCase()] ?? null,
      body: answer.body,
    };
  };
}

/**
 * A port to the store's process: asked of the main process through the
 * bridge, it comes from the preload as a message from this page's own origin.
 */
export function storePort(bridge: Bridge): Promise<MessagePort> {
  return new Promise((resolve) => {
    const receive = (event: MessageEvent) => {
      const [port] = event.ports;
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data !== STORE_PORT || !port) return;
      window.removeEventListener("message", receive);
      resolve(port);
    };
    window.addEventListener("message", receive);
    bridge.connectStore();
  });
}
