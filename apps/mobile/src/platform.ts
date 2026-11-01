// The Android app's platform (docs/plans/android.md#D60): the web store in
// the WebView (D63), HTTP through AstroTime's OkHttp plugin (D62), credentials
// in memory until PR A2 (D64), Login Flow's page in the system browser and
// preferences in the WebView's localStorage.
import type { Store } from "@astrotime/storage";
import type { Platform } from "@astrotime/ui";
import { registerPlugin } from "@capacitor/core";

import { cleartextOrigins, nativeClient, type NativeHttp } from "./http.ts";
import { preferences } from "./preferences.ts";
import { noReminders } from "./reminders.ts";
import { memorySecrets } from "./secrets.ts";

const plugin = registerPlugin<NativeHttp>("AstroTimeHttp");

export function mobilePlatform(store: Promise<Store>): Platform {
  // The servers being signed in to, once each per sign-in under way.
  const signingIn: string[] = [];
  return {
    store,
    http: nativeClient(plugin, async () =>
      cleartextOrigins(await (await store).accounts(), signingIn),
    ),
    secrets: memorySecrets(),
    // A page outside the app's origin leaves the WebView for the system
    // browser (Capacitor's navigation rule); PR A2 opens a Custom Tab (D65).
    openExternal: (url) => void window.open(url, "_blank"),
    signingInTo: (server) => {
      signingIn.push(server);
      return () => void signingIn.splice(signingIn.indexOf(server), 1);
    },
    preferences,
    reminders: noReminders,
  };
}
