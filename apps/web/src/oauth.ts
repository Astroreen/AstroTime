// The web's OAuth redirect (docs/plans/providers.md#D254): the service's
// page in a window of its own, its answer back at `oauth.html`, which posts
// its address to this page over a BroadcastChannel of the app's origin and
// closes. The app's tab keeps its state: nothing reloads.
import type { OAuthRedirect } from "@astrotime/oauth";

/** The channel `oauth.html` posts the redirect's address on (public/oauth.js). */
export const OAUTH_CHANNEL = "astrotime-oauth";

export function webOAuth(
  base: string = document.baseURI,
  open: (url: string) => void = (url) =>
    void window.open(url, "astrotime-oauth", "popup,width=520,height=720,noopener"),
  channel: () => BroadcastChannel = () => new BroadcastChannel(OAUTH_CHANNEL),
): OAuthRedirect {
  return {
    async begin() {
      const redirectUri = new URL("oauth.html", base).href;
      const heard = channel();
      let finish: (url: string | null) => void = () => {};
      const answer = new Promise<string | null>((resolve) => (finish = resolve));
      const done = (url: string | null) => {
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
          open(url);
          return answer;
        },
        cancel: () => done(null),
      };
    },
  };
}
