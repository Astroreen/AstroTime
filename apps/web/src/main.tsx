// The web app: its platform (`platform.ts`) and the browser's languages
// around the shared UI (docs/plans/foundation.md#D22).
import { Store } from "@astrotime/storage";
import { webDriver } from "@astrotime/storage/web";
import { AstroTime } from "@astrotime/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { webPlatform } from "./platform.ts";
import "./index.css";

const root = document.querySelector("#root");
if (!root) throw new Error("#root is missing from index.html");

const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
// The nonce the server gave this page for the styles Base UI adds
// (docs/plans/foundation.md#D110); the browser keeps it from the DOM's attribute.
const nonce = document.querySelector<HTMLMetaElement>("meta[property=csp-nonce]")?.nonce;

async function openStore(): Promise<Store> {
  const store = await Store.open(await webDriver());
  // `?demo` in the dev server fills the store with demo data around today;
  // the production build leaves this out, demo module and all.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("demo")) {
    const { loadDemo } = await import("@astrotime/ui/demo");
    await loadDemo(store, { languages, timeZone });
  }
  return store;
}

createRoot(root).render(
  <StrictMode>
    <AstroTime
      platform={webPlatform(openStore())}
      languages={languages}
      timeZone={timeZone}
      {...(nonce ? { nonce } : {})}
    />
  </StrictMode>,
);
