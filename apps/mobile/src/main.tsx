// The Android app: its platform (`platform.ts`) and the WebView's languages
// around the shared UI (docs/plans/android.md#D61), as apps/web does.
import { Store } from "@astrotime/storage";
import { webDriver } from "@astrotime/storage/web";
import { AstroTime } from "@astrotime/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { mobilePlatform } from "./platform.ts";
import "./index.css";

const root = document.querySelector("#root");
if (!root) throw new Error("#root is missing from index.html");

const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function openStore(): Promise<Store> {
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
