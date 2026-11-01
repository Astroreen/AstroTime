// The Android app: its platform (`platform.ts`) and the WebView's languages
// around the shared UI (docs/plans/android.md#D61), as apps/web does.
import { OutdatedWebViewError, Store } from "@astrotime/storage";
import { webDriver } from "@astrotime/storage/web";
import { AstroTime } from "@astrotime/ui";
import { registerPlugin } from "@capacitor/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { mobilePlatform } from "./platform.ts";
import { followTheme, type NativeShell } from "./shell.ts";
import { chromiumVersion, MINIMUM_WEBVIEW } from "./webview.ts";
import "./index.css";

const root = document.querySelector("#root");
if (!root) throw new Error("#root is missing from index.html");

const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// The system bars follow the theme the app shows (D68).
followTheme(registerPlugin<NativeShell>("AstroTimeShell"));

async function openStore(): Promise<Store> {
  // Too old for the store: the UI says to update the WebView (D61).
  const version = chromiumVersion(navigator.userAgent);
  if (version !== null && version < MINIMUM_WEBVIEW)
    throw new OutdatedWebViewError(version, MINIMUM_WEBVIEW);
  // The store is the WebView's OPFS: asking keeps it from being evicted
  // under storage pressure, if the WebView honours it (D63). The answer goes
  // to the log (logcat's Capacitor/Console).
  void navigator.storage
    ?.persist?.()
    .then((granted) =>
      console.info(`AstroTime: persistent storage ${granted ? "granted" : "refused"}`),
    );
  return Store.open(await webDriver());
}

createRoot(root).render(
  <StrictMode>
    <AstroTime platform={mobilePlatform(openStore())} languages={languages} timeZone={timeZone} />
  </StrictMode>,
);
