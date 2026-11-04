// The web's OAuth redirect (docs/plans/providers.md#D254): the service's
// page in a window of its own, its answer back at `oauth.html`, which posts
// its address to this page over a BroadcastChannel of the app's origin and
// closes. The app's tab keeps its state: nothing reloads.
//
// The window is opened empty in the click itself (`openSignInWindow`, before
// anything is awaited), so no popup blocker holds it, its `opener` cut at
// once so the service's page cannot reach back into the app, and sent to the
// service once the authorization URL is made.
import type { OAuthRedirect } from "@astrotime/oauth";

/** The channel `oauth.html` posts the redirect's address on (public/oauth.js). */
export const OAUTH_CHANNEL = "astrotime-oauth";

/** What the redirect uses of the sign-in's window. */
export interface SignInWindow {
  readonly location: { href: string };
  opener: unknown;
  close(): void;
}

/**
 * The browser would not open the sign-in's window (a popup blocker): the
 * sign-in says so, with a link the user opens themselves.
 */
export class PopupBlockedError extends Error {
  override name = "PopupBlockedError";
  /** The service's page, for the link. */
  readonly url: string;
  constructor(url: string) {
    super("The browser did not open the sign-in's window.");
    this.url = url;
  }
}

export function webOAuth(
  base: string,
  /** The window `openSignInWindow` opened in the click; `null` when the browser refused it. */
  popup: SignInWindow | null,
  channel: () => BroadcastChannel = () => new BroadcastChannel(OAUTH_CHANNEL),
): OAuthRedirect {
  return {
    async begin() {
      // Cut from the app before it goes anywhere: the service's page cannot reach back.
      if (popup) popup.opener = null;
      const redirectUri = new URL("oauth.html", base).href;
      const heard = channel();
      let finish: (url: string | null) => void = () => {};
      const answer = new Promise<string | null>((resolve) => (finish = resolve));
      let settled = false;
      const done = (url: string | null) => {
        if (settled) return;
        settled = true;
        heard.close();
        finish(url);
      };
      // Only this redirect's answer: another sign-in's carries another state,
      // which the sign-in refuses (`codeOf`).
      heard.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (typeof event.data === "string" && event.data.startsWith(`${redirectUri}?`))
          done(event.data);
      });
      return {
        redirectUri,
        open(url) {
          if (!popup) {
            done(null);
            return Promise.reject(new PopupBlockedError(url));
          }
          popup.location.href = url;
          return answer;
        },
        cancel() {
          popup?.close();
          done(null);
        },
      };
    },
  };
}
