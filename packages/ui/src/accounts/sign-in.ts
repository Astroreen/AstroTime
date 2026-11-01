// Adding an account (docs/plans/foundation.md#D19, D92): by password on any
// CalDAV server, or through Nextcloud's Login Flow v2. The steps and their
// errors live here, outside React, so they are tested without a browser.
import {
  CalDavProvider,
  CertificateError,
  NoCalendarHomeError,
  ProxyRefusedError,
  startLoginFlow,
  type Credentials,
  type HttpClient,
  type LoginFlow,
} from "@astrotime/caldav";
import { AuthError, OfflineError, type SecretStore } from "@astrotime/core";
import type { Account, Store } from "@astrotime/storage";
import { removeAccount, saveAccount } from "@astrotime/sync";

/** Why signing in did not work, as a code the UI words in the user's language. */
export type SignInProblem =
  /** What was typed is no web address. */
  | "address"
  /** The server refused the user name or password. */
  | "auth"
  /** The server could not be reached. */
  | "offline"
  /** The server's certificate is not trusted here, expired, or for another name (android D62). */
  | "certificate"
  /** The web proxy does not carry this server (D20). */
  | "not-allowed"
  /** The server redirects to another one, at `location` (D39). */
  | "other-server"
  /** The address answers, but is no CalDAV server. */
  | "not-caldav"
  /** The address is no Nextcloud with Login Flow v2. */
  | "not-nextcloud"
  /** Nextcloud's sign-in page was not approved in time. */
  | "expired"
  | "failed";

export type SignInState =
  | { readonly step: "idle" }
  /** Starting Login Flow v2, or finding the calendars. */
  | { readonly step: "checking" }
  /** Login Flow v2: waiting for the user to approve on Nextcloud's page. */
  | { readonly step: "waiting"; readonly loginUrl: string }
  | {
      readonly step: "failed";
      readonly problem: SignInProblem;
      /** The other server's address, for `other-server`. */
      readonly location: string | null;
    }
  /** `added`: a new account; otherwise one already here signed in again. */
  | { readonly step: "done"; readonly account: Account; readonly added: boolean };

/** Waits `ms`, or less when `signal` aborts; injected so tests decide when time passes. */
export interface Clock {
  now(): number;
  wait(ms: number, signal: AbortSignal): Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  wait: (ms, signal) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    }),
};

/** How often Login Flow v2 is polled, and how long its token lives (android D65). */
const POLL_EVERY_MS = 2_000;
export const FLOW_LIFETIME_MS = 20 * 60_000;

/**
 * A web address from what the user typed: `cloud.example.com` is
 * `https://cloud.example.com/`; a path (a Nextcloud in a folder) is kept.
 */
export function serverAddress(typed: string): string | null {
  const text = typed.trim();
  if (text === "") return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (!/^https?:$/.test(url.protocol) || url.hostname === "") return null;
    url.hash = "";
    url.search = "";
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return null;
  }
}

export interface SignInOptions {
  readonly store: Store;
  readonly secrets: SecretStore;
  readonly http: HttpClient;
  readonly openExternal: (url: string) => void;
  /** The platform's `signingInTo`: the server is being signed in to, until the returned function. */
  readonly signingInTo?: (server: string) => () => void;
  readonly clock?: Clock;
}

/** One attempt at adding an account, from the form to the saved account. */
export class SignIn {
  readonly #options: SignInOptions;
  readonly #clock: Clock;
  readonly #listeners = new Set<() => void>();
  #state: SignInState = { step: "idle" };
  #attempt: AbortController | null = null;
  /** Ends the wait between two polls at once. */
  #wake: (() => void) | null = null;

  constructor(options: SignInOptions) {
    this.#options = options;
    this.#clock = options.clock ?? realClock;
  }

  get state(): SignInState {
    return this.#state;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Any CalDAV server: discovery through `/.well-known/caldav` (RFC 6764). */
  async withPassword(input: { server: string; username: string; password: string }) {
    const signal = this.#begin();
    const server = serverAddress(input.server);
    if (!server) return this.#fail(signal, "address");
    try {
      const credentials = { username: input.username.trim(), password: input.password };
      await this.#finish(signal, server, credentials);
    } catch (error) {
      this.#fail(signal, problemOf(error, "failed"), error);
    }
  }

  /** Nextcloud: the user approves on their server's page and AstroTime gets an app password. */
  async withNextcloud(input: { server: string }) {
    const signal = this.#begin();
    const server = serverAddress(input.server);
    if (!server) return this.#fail(signal, "address");
    const end = this.#options.signingInTo?.(server);
    try {
      await this.#loginFlow(signal, server);
    } finally {
      end?.();
    }
  }

  async #loginFlow(signal: AbortSignal, server: string) {
    let flow: LoginFlow;
    try {
      flow = await startLoginFlow(this.#options.http, server);
    } catch (error) {
      return this.#fail(signal, problemOf(error, "not-nextcloud"), error);
    }
    if (signal.aborted) return;
    this.#set({ step: "waiting", loginUrl: flow.loginUrl });
    this.#options.openExternal(flow.loginUrl);
    const deadline = this.#clock.now() + FLOW_LIFETIME_MS;
    try {
      for (;;) {
        let approved: Awaited<ReturnType<LoginFlow["poll"]>> = null;
        try {
          approved = await flow.poll();
        } catch (error) {
          // A moment without a network: the page waits, and so do we.
          if (!(error instanceof OfflineError)) throw error;
        }
        if (signal.aborted) return;
        if (approved) {
          this.#set({ step: "checking" });
          const { server: approvedServer, ...credentials } = approved;
          return await this.#finish(signal, serverAddress(approvedServer) ?? server, credentials);
        }
        if (this.#clock.now() >= deadline) return this.#fail(signal, "expired");
        await this.#nap(signal);
        if (signal.aborted) return;
      }
    } catch (error) {
      this.#fail(signal, problemOf(error, "failed"), error);
    }
  }

  /** Opens Nextcloud's page again (the first one was blocked, or closed). */
  reopen(): void {
    if (this.#state.step === "waiting") this.#options.openExternal(this.#state.loginUrl);
  }

  /** Polls at once: the user came back to AstroTime, likely from approving. */
  pollNow(): void {
    this.#wake?.();
  }

  /** Stops the attempt; nothing it was doing changes the state any more. */
  cancel(): void {
    this.#attempt?.abort();
    this.#attempt = null;
    this.#set({ step: "idle" });
  }

  #begin(): AbortSignal {
    this.#attempt?.abort();
    this.#attempt = new AbortController();
    this.#set({ step: "checking" });
    return this.#attempt.signal;
  }

  async #finish(signal: AbortSignal, server: string, credentials: Credentials) {
    const { http, store, secrets, signingInTo } = this.#options;
    // Once saved, the account is one of the platform's own.
    const end = signingInTo?.(server);
    let saved: Awaited<ReturnType<typeof saveAccount>>;
    try {
      const { homeUrl } = await CalDavProvider.discover(http, server, credentials);
      if (signal.aborted) return;
      saved = await saveAccount(
        { store, secrets },
        {
          name: accountName(credentials.username, server),
          serverUrl: server,
          homeUrl,
          credentials,
        },
      );
    } finally {
      end?.();
    }
    const { account, added } = saved;
    if (signal.aborted) {
      // Cancelled while it was saved: an account it added goes again. One it
      // signed in to again keeps its new password, as the user meant it to.
      if (added) await removeAccount({ store, secrets }, account.id);
      return;
    }
    this.#set({ step: "done", account, added });
  }

  async #nap(signal: AbortSignal): Promise<void> {
    const woken = new AbortController();
    const stop = () => woken.abort();
    signal.addEventListener("abort", stop);
    this.#wake = stop;
    try {
      await this.#clock.wait(POLL_EVERY_MS, woken.signal);
    } finally {
      signal.removeEventListener("abort", stop);
      this.#wake = null;
    }
  }

  #fail(signal: AbortSignal, problem: SignInProblem, error?: unknown): void {
    if (signal.aborted) return;
    if (problem === "failed") console.error(error);
    const location = error instanceof ProxyRefusedError ? error.location : null;
    this.#set({ step: "failed", problem, location });
  }

  #set(state: SignInState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}

/** `astro@cloud.example.com`; a user name that is an address already stays as it is. */
function accountName(username: string, server: string): string {
  return username.includes("@") ? username : `${username}@${new URL(server).host}`;
}

/** The error's code; `otherwise` for what the step itself failed on. */
function problemOf(error: unknown, otherwise: SignInProblem): SignInProblem {
  if (error instanceof AuthError) return "auth";
  if (error instanceof OfflineError) return "offline";
  if (error instanceof CertificateError) return "certificate";
  if (error instanceof ProxyRefusedError)
    return error.reason === "other-server" ? "other-server" : "not-allowed";
  if (error instanceof NoCalendarHomeError) return "not-caldav";
  return otherwise;
}
