// What the preload hands the page (docs/plans/desktop.md#D71): one object,
// `window.astrotime`, with exactly what the desktop's adapters need, and the
// IPC channels behind it. The main process checks every argument and that
// the sender is the app's own page.
import type { HttpRequest } from "@astrotime/caldav";

/** The app's pages are served here (`protocol.handle`, never `file://`). */
export const APP_SCHEME = "app";
export const APP_HOST = "astrotime";
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/`;

export const CHANNELS = {
  /** One HTTP exchange through the main process, redirects followed (D72). */
  http: "astrotime:http",
  /** Opens an http(s) URL in the system browser. */
  openExternal: "astrotime:open-external",
  /** Asks for a port to the store's process; it comes back on the same channel (D73). */
  store: "astrotime:store",
} as const;

/** The data of the window message that carries the store's port to the page. */
export const STORE_PORT = "astrotime:store-port";

/** An answer as it crosses IPC: headers by lower-case name, repeated ones joined with ", ". */
export type HttpAnswer =
  | {
      readonly status: number;
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: string;
    }
  /** The server could not be reached, or the answer broke off. */
  | { readonly offline: string };

export interface Bridge {
  http(request: HttpRequest): Promise<HttpAnswer>;
  openExternal(url: string): void;
  /** The port arrives as a window message from the app's own origin, data `STORE_PORT`. */
  connectStore(): void;
}
