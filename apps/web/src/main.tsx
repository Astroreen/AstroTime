// The web app: its platform (`platform.ts`) and the browser's languages
// around the shared UI (docs/plans/foundation.md#D22).
import { PLACES, PLACES_OFF, PRESET_META, type Preset } from "@astrotime/caldav";
import { Store } from "@astrotime/storage";
import { webDriver } from "@astrotime/storage/web";
import { AstroTime } from "@astrotime/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { webPlatform } from "./platform.ts";
import { serviceWorkerUpdates } from "./updates.ts";
import "./index.css";

const root = document.querySelector("#root");
if (!root) throw new Error("#root is missing from index.html");

const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
// The nonce the server gave this page for the styles Base UI adds
// (docs/plans/foundation.md#D110); the browser keeps it from the DOM's attribute.
const nonce = document.querySelector<HTMLMetaElement>("meta[property=csp-nonce]")?.nonce;
// The server and user name a single-user deployment names (docs/plans/foundation.md#D123).
const meta = (name: string) =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || null;
const presetServer = meta(PRESET_META.server);
const preset: Preset | undefined = presetServer
  ? { server: presetServer, username: meta(PRESET_META.username) }
  : undefined;
// The place search the deployment names: its own Photon, "off", or none
// said, the public one (docs/plans/foundation.md#D178).
const photon = meta(PRESET_META.places) ?? PLACES.photon;
const places = photon === PLACES_OFF ? undefined : { photon, tiles: PLACES.tiles };

/** The web store's name on OPFS. */
const STORE = "astrotime";

async function openStore(): Promise<Store> {
  const store = await Store.open(await webDriver(STORE));
  // `?demo` in the dev server fills the store with demo data around today;
  // the production build leaves this out, demo module and all.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("demo")) {
    const { loadDemo } = await import("@astrotime/ui/demo");
    await loadDemo(store, { languages, timeZone });
  }
  return store;
}

// The built app keeps its files for starting with no network, and hears of a
// newer version (docs/plans/foundation.md#D124); the dev server has neither.
const updates =
  import.meta.env.PROD && "serviceWorker" in navigator
    ? serviceWorkerUpdates(navigator.serviceWorker, {
        reload: () => location.reload(),
        base: import.meta.env.BASE_URL,
      })
    : undefined;
void updates?.register();

createRoot(root).render(
  <StrictMode>
    <AstroTime
      platform={{
        ...webPlatform(openStore(), STORE, preset),
        ...(updates ? { updates } : {}),
        ...(places ? { places } : {}),
      }}
      languages={languages}
      timeZone={timeZone}
      {...(nonce ? { nonce } : {})}
    />
  </StrictMode>,
);
