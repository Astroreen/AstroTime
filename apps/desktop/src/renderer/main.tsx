// The desktop app's page: its platform (`platform.ts`) and the system's
// languages around the shared UI (docs/plans/foundation.md#D22), as the web
// app's (apps/web/src/main.tsx).
import { Store } from "@astrotime/storage";
import { portDriver } from "@astrotime/storage/port";
import { AstroTime } from "@astrotime/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import type { Bridge } from "../bridge.ts";
import { desktopPlatform, storePort } from "./platform.ts";
import "./index.css";

declare global {
  interface Window {
    /** The preload's bridge (src/preload). */
    readonly astrotime: Bridge;
  }
}

const root = document.querySelector("#root");
if (!root) throw new Error("#root is missing from index.html");

const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
// The nonce the main process gave this page for the styles Base UI adds
// (docs/plans/desktop.md#D71); the browser keeps it from the DOM's attribute.
const nonce = document.querySelector<HTMLMetaElement>("meta[property=csp-nonce]")?.nonce;

const bridge = window.astrotime;
const store = storePort(bridge).then((port) => Store.open(portDriver(port)));

createRoot(root).render(
  <StrictMode>
    <AstroTime
      platform={desktopPlatform(bridge, store)}
      languages={languages}
      timeZone={timeZone}
      {...(nonce ? { nonce } : {})}
    />
  </StrictMode>,
);
