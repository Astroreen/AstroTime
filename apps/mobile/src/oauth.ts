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

export function androidOAuth({ app, browser }: OAuthPlugins): OAuthRedirect {
  return {
    async begin() {
      let finish: (url: string | null) => void = () => {};
      const answer = new Promise<string | null>((resolve) => (finish = resolve));
      const listening = [
        app.addListener("appUrlOpen", ({ url }) => {
          if (url.startsWith(`${OAUTH_REDIRECT}?`)) done(url);
        }),
        // The user closed the tab without an answer.
        browser.addListener("browserFinished", () => done(null)),
      ];
      const done = (url: string | null) => {
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
