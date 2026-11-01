// The Android app's platform (docs/plans/android.md#D60): the web store in
// the WebView (D63), HTTP through AstroTime's OkHttp plugin (D62), credentials
// under a Keystore key (D64), Login Flow's page in a Custom Tab (D65), the
// back button (D68), preferences in the WebView's localStorage, reminders
// as local notifications (D66), and the Web Locks it shares with background
// sync's WebView (D67).
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import type { Store } from "@astrotime/storage";
import type { Platform } from "@astrotime/ui";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

import { cleartextOrigins, nativeClient, SigningIn, type NativeHttp } from "./http.ts";
import { remindersLock, syncLock } from "./locks.ts";
import { preferences } from "./preferences.ts";
import { androidReminders } from "./reminders.ts";
import { keystoreSecrets } from "./secrets.ts";
import { backButton } from "./shell.ts";

const http = registerPlugin<NativeHttp>("AstroTimeHttp");

export function mobilePlatform(store: Promise<Store>): Platform {
  const signingIn = new SigningIn();
  const secrets = keystoreSecrets(SecureStorage);
  return {
    store,
    http: nativeClient(http, async () =>
      cleartextOrigins(await (await store).accounts(), signingIn.servers),
    ),
    secrets,
    // The system may end the app while the Custom Tab is in front; its next
    // start takes the Login Flow up again (foundation D121).
    pendingSignIn: secrets,
    // A Custom Tab, where the user's browser keeps their passwords and second
    // factor. The app is frozen while the tab is in front (Android 14 and
    // later), so the user comes back, and the poll on return ends the sign-in.
    // No Custom Tab or browser to open it: the system's own handling of the link.
    openExternal: (url) => void Browser.open({ url }).catch(() => window.open(url, "_blank")),
    signingInTo: (server) => signingIn.begin(server),
    onBack: backButton(App),
    preferences,
    // Background sync opens the same store in a WebView of its own (D67).
    syncLock,
    reminders: androidReminders({
      native: LocalNotifications,
      preferences,
      lock: remindersLock,
      // Back in front: the permissions may have changed in the system's settings.
      onResume: (listener) =>
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") listener();
        }),
    }),
  };
}
