// Android's OAuth redirect (docs/plans/providers.md#D254): the service's page
// in a Custom Tab, its answer back at the app's own scheme, which the
// manifest's intent filter hands to the app (`appUrlOpen`).
import type { OAuthRedirect } from "@astrotime/oauth";

/** The app's id as a scheme, one slash: as Google asks of Android clients, and Microsoft takes. */
export const OAUTH_REDIRECT = "io.github.astroreen.astrotime:/oauth";

/** What the redirect uses of `@capacitor/app` and `@capacitor/browser`. */
export interface OAuthPlugins {
  readonly app: {
    addListener(
      event: "appUrlOpen",
      listener: (event: { readonly url: string }) => void,
    ): Promise<{ remove(): Promise<void> }>;
  };
  readonly browser: {
    open(options: { readonly url: string }): Promise<void>;
    close(): Promise<void>;
    addListener(
      event: "browserFinished",
      listener: () => void,
    ): Promise<{ remove(): Promise<void> }>;
  };
}

/**
 * How long after the tab closed an answer may still come: Android may tell
 * the tab closed before it hands the app the redirect that closed it.
 */
const ANSWER_AFTER_CLOSE_MS = 1500;

export function androidOAuth(
  { app, browser }: OAuthPlugins,
  /** Runs `then` once an answer could no longer be coming; injected so tests decide when. */
  later: (then: () => void) => void = (then) => void setTimeout(then, ANSWER_AFTER_CLOSE_MS),
): OAuthRedirect {
  return {
    async begin() {
      let finish: (url: string | null) => void = () => {};
      const answer = new Promise<string | null>((resolve) => (finish = resolve));
      const listening = [
        app.addListener("appUrlOpen", ({ url }) => {
          if (url.startsWith(`${OAUTH_REDIRECT}?`)) done(url);
        }),
        // The user closed the tab: no answer, unless the redirect that closed
        // it is still on its way to the app.
        browser.addListener("browserFinished", () => later(() => done(null))),
      ];
      let settled = false;
      const done = (url: string | null) => {
        if (settled) return;
        settled = true;
        finish(url);
        for (const listener of listening) void listener.then((handle) => handle.remove());
        if (url !== null) void browser.close().catch(() => {});
      };
      await Promise.all(listening);
      return {
        redirectUri: OAUTH_REDIRECT,
        async open(url) {
          await browser.open({ url });
          return answer;
        },
        cancel: () => done(null),
      };
    },
  };
}
