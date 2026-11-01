// Adding an account (docs/plans/foundation.md#D19, D92): by password on any
// CalDAV server, or through Nextcloud's Login Flow v2. The steps and their
// errors live here, outside React, so they are tested without a browser.
import {
  CalDavProvider,
  CertificateError,
  NoCalendarHomeError,
  ProxyRefusedError,
  resumeLoginFlow,
  revokeAppPassword,
  startLoginFlow,
  type Credentials,
  type HttpClient,
  type LoginFlow,
  type LoginFlowState,
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
  | { readonly step: "done"; readonly account: Account; readonly added: boolean }
  /** The Login Flow this page took up again ended in another (D121). */
  | { readonly step: "elsewhere" };

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

/** Where a Login Flow under way is kept, in the platform's `pendingSignIn` (D121). */
export const PENDING_FLOW = "login-flow";

/**
 * A Login Flow kept in `pendingSignIn`, under its token: waiting for the
 * user's approval until `deadline`, or approved, with the app password
 * Nextcloud gave, until the account and its secret are saved.
 */
type PendingFlow =
  | (LoginFlowState & { readonly step: "waiting"; readonly deadline: number })
  | ({ readonly step: "approved"; readonly token: string; readonly server: string } & Credentials);

function readPending(json: string | null): PendingFlow | null {
  if (json === null) return null;
  try {
    const value = JSON.parse(json) as Record<string, unknown> | null;
    const text = (key: string) => (typeof value?.[key] === "string" ? value[key] : null);
    const [token, server] = [text("token"), text("server")];
    if (token === null || server === null) return null;
    if (value?.["step"] === "approved") {
      const [username, password] = [text("username"), text("password")];
      if (username === null || password === null) return null;
      return { step: "approved", token, server, username, password };
    }
    const [loginUrl, endpoint, deadline] = [
      text("loginUrl"),
      text("endpoint"),
      value?.["deadline"],
    ];
    if (value?.["step"] !== "waiting" || loginUrl === null || endpoint === null) return null;
    if (typeof deadline !== "number") return null;
    return { step: "waiting", token, server, loginUrl, endpoint, deadline };
  } catch {
    return null;
  }
}

/** Runs `work` alone among the pages of this origin: the kept flow is read and changed whole. */
function underLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request("astrotime-login-flow", work) : work();
}

type ApprovedFlow = Extract<PendingFlow, { step: "approved" }>;

/**
 * Keeps `flow`, replacing what was kept: the latest flow started is the one
 * taken up. An approval of another flow it replaces, which a page left
 * behind unsaved, is handed back, so its app password is revoked rather
 * than lost.
 */
function keepFlow(pending: SecretStore, flow: PendingFlow): Promise<ApprovedFlow | null> {
  return underLock(async () => {
    const before = readPending(await pending.get(PENDING_FLOW));
    await pending.set(PENDING_FLOW, JSON.stringify(flow));
    return before?.step === "approved" && before.token !== flow.token ? before : null;
  });
}

/**
 * Forgets the kept flow if it is still the one with `token`, read and
 * deleted under one Web Lock, so another page's newer flow stays.
 */
function forgetFlow(pending: SecretStore, token: string): Promise<void> {
  return underLock(async () => {
    if (readPending(await pending.get(PENDING_FLOW))?.token === token)
      await pending.delete(PENDING_FLOW);
  });
}

/**
 * Whether a page that just started has a Login Flow to take up: one waiting
 * within its token's life, or one approved and not yet saved. What is kept
 * but past its life, or unreadable, is forgotten here.
 */
export async function hasPendingFlow(pending: SecretStore, now = Date.now()): Promise<boolean> {
  return underLock(async () => {
    const raw = await pending.get(PENDING_FLOW);
    if (raw === null) return false;
    const flow = readPending(raw);
    if (flow && (flow.step === "approved" || now < flow.deadline)) return true;
    await pending.delete(PENDING_FLOW);
    return false;
  });
}

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
  /**
   * The platform's `pendingSignIn`: where a Login Flow under way is kept, so
   * a page the browser discarded while the user approved takes it up again
   * (`resume`, D121).
   */
  readonly pending?: SecretStore;
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
  /** The token of the Login Flow this attempt keeps in `pending`. */
  #kept: string | null = null;
  /** Login Flow's approval, kept until its account is saved (D121). */
  #approved: { token: string; server: string; credentials: Credentials } | null = null;
  /** Saving `#approved`'s account: a cancel leaves it to the save. */
  #finishing = false;

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

  /**
   * Nextcloud: the user approves on their server's page and AstroTime gets
   * an app password. An approval this page holds still, whose account could
   * not be saved (the server unreachable), is saved again instead.
   */
  async withNextcloud(input: { server: string }) {
    const signal = this.#begin();
    const server = serverAddress(input.server);
    if (!server) return this.#fail(signal, "address");
    const end = this.#options.signingInTo?.(server);
    try {
      const held = this.#approved;
      if (held && new URL(held.server).host === new URL(server).host)
        await this.#saveApproved(signal, held.token, held.server, held.credentials);
      else await this.#loginFlow(signal, server);
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
    const deadline = this.#clock.now() + FLOW_LIFETIME_MS;
    // An approval held from before goes, revoked: this is a new flow.
    await this.#abandon();
    try {
      await this.#keep(signal, { step: "waiting", ...flow.state, deadline });
    } catch (error) {
      // Kept or not, the flow goes on in this page.
      console.error(error);
    }
    if (signal.aborted) return;
    this.#set({ step: "waiting", loginUrl: flow.loginUrl });
    this.#options.openExternal(flow.loginUrl);
    await this.#await(signal, flow, server, deadline);
  }

  /**
   * Takes up a Login Flow a page before this one started (D121): the browser
   * discarded it, or the system ended the app, while the user approved on
   * Nextcloud's page. Nextcloud's page is not opened again, but `reopen`
   * opens it. False when none is under way.
   */
  async resume(): Promise<boolean> {
    const { pending } = this.#options;
    if (!pending) return false;
    const signal = this.#begin();
    let kept: PendingFlow | null;
    try {
      kept = readPending(await pending.get(PENDING_FLOW));
    } catch (error) {
      console.error(error);
      kept = null;
    }
    if (signal.aborted) return false;
    if (!kept || (kept.step === "waiting" && this.#clock.now() >= kept.deadline)) {
      if (kept)
        await forgetFlow(pending, kept.token).catch((error: unknown) => console.error(error));
      this.#set({ step: "idle" });
      return false;
    }
    this.#kept = kept.token;
    const end = this.#options.signingInTo?.(kept.server);
    try {
      if (kept.step === "approved") {
        // Approved, but its page went before the account was saved: saved now.
        const { token, server, username, password } = kept;
        await this.#saveApproved(signal, token, server, { username, password });
      } else {
        const { deadline, server, loginUrl, endpoint, token } = kept;
        const state = { server, loginUrl, endpoint, token };
        this.#set({ step: "waiting", loginUrl: state.loginUrl });
        await this.#await(
          signal,
          resumeLoginFlow(this.#options.http, state),
          state.server,
          deadline,
        );
      }
    } finally {
      end?.();
    }
    return true;
  }

  /** Polls until the user approves, the token expires, or another page ends the flow. */
  async #await(signal: AbortSignal, flow: LoginFlow, server: string, deadline: number) {
    const token = flow.state.token;
    try {
      for (;;) {
        // Another page took it up too, and ended it (approved there, or cancelled).
        if (this.#kept === token && !(await this.#stillKept(token))) {
          if (signal.aborted) return;
          this.#kept = null;
          return this.#set({ step: "elsewhere" });
        }
        if (signal.aborted) return;
        let approved: Awaited<ReturnType<LoginFlow["poll"]>> = null;
        try {
          approved = await flow.poll();
        } catch (error) {
          // A moment without a network: the page waits, and so do we.
          if (!(error instanceof OfflineError)) throw error;
        }
        if (signal.aborted) return;
        if (approved) {
          const { server: approvedServer, ...credentials } = approved;
          const named = serverAddress(approvedServer) ?? server;
          // The token is spent; the app password is kept in its place until
          // its account is saved, so a page that goes meanwhile loses nothing.
          const { pending } = this.#options;
          if (pending && this.#kept === token) {
            try {
              const displaced = await keepFlow(pending, {
                step: "approved",
                token,
                server: named,
                ...credentials,
              });
              if (displaced) await this.#revoke(displaced);
            } catch (error) {
              console.error(error);
            }
          }
          return await this.#saveApproved(signal, token, named, credentials);
        }
        if (this.#clock.now() >= deadline) {
          await this.#forget(token);
          return this.#fail(signal, "expired");
        }
        await this.#nap(signal);
        if (signal.aborted) return;
      }
    } catch (error) {
      await this.#forget(token);
      this.#fail(signal, problemOf(error, "failed"), error);
    }
  }

  /**
   * Saves the account Login Flow's approval signs in to. The approval is
   * forgotten once the account and its secret are saved; if they cannot be,
   * the app password is revoked, except when the server could not be
   * reached: then it is held, and the next try (this page's, or the next
   * page's) saves it.
   */
  async #saveApproved(
    signal: AbortSignal,
    token: string,
    server: string,
    credentials: Credentials,
  ): Promise<void> {
    this.#approved = { token, server, credentials };
    this.#set({ step: "checking" });
    this.#finishing = true;
    try {
      await this.#finish(signal, server, credentials, {
        loginFlow: true,
        saved: () => {
          this.#approved = null;
          return this.#forget(token);
        },
      });
    } catch (error) {
      if (!(error instanceof OfflineError)) await this.#abandon();
      this.#fail(signal, problemOf(error, "failed"), error);
    } finally {
      this.#finishing = false;
    }
    // Cancelled before it was saved: the app password, made for nothing, goes.
    if (signal.aborted && this.#approved?.token === token) await this.#abandon();
  }

  /** Revokes an approval held and forgets it (D121); the server unreachable, it stays valid there. */
  async #abandon(): Promise<void> {
    const held = this.#approved;
    if (!held) return;
    this.#approved = null;
    await this.#revoke({ server: held.server, ...held.credentials });
    await this.#forget(held.token);
  }

  /** Revokes an app password Login Flow gave; the server unreachable, it stays valid there. */
  async #revoke(approval: { server: string } & Credentials): Promise<void> {
    const { server, username, password } = approval;
    await revokeAppPassword(this.#options.http, server, { username, password }).catch(
      (error: unknown) => console.error(error),
    );
  }

  /** Keeps the flow in `pending`, for a page loaded after this one (D121). */
  async #keep(signal: AbortSignal, flow: PendingFlow): Promise<void> {
    const { pending } = this.#options;
    if (!pending) return;
    const displaced = await keepFlow(pending, flow);
    if (displaced) await this.#revoke(displaced);
    if (signal.aborted) return forgetFlow(pending, flow.token);
    this.#kept = flow.token;
  }

  async #stillKept(token: string): Promise<boolean> {
    const { pending } = this.#options;
    if (!pending) return true;
    try {
      return readPending(await pending.get(PENDING_FLOW))?.token === token;
    } catch {
      return true;
    }
  }

  /** Forgets the kept flow, if it is still the one with `token`: a later one, another page's, stays. */
  async #forget(token: string): Promise<void> {
    const { pending } = this.#options;
    if (this.#kept === token) this.#kept = null;
    if (!pending) return;
    await forgetFlow(pending, token).catch((error: unknown) => console.error(error));
  }

  /** Opens Nextcloud's page again (the first one was blocked, or closed). */
  reopen(): void {
    if (this.#state.step === "waiting") this.#options.openExternal(this.#state.loginUrl);
  }

  /** Polls at once: the user came back to AstroTime, likely from approving. */
  pollNow(): void {
    this.#wake?.();
  }

  /**
   * Stops the attempt; nothing it was doing changes the state any more.
   * Resolves once a Login Flow it kept is forgotten (D121).
   */
  cancel(): Promise<void> {
    this.#attempt?.abort();
    this.#attempt = null;
    this.#set({ step: "idle" });
    // Its account being saved: the save, cancelled, sees to the approval.
    if (this.#finishing) return Promise.resolve();
    // An approval held revoked; a flow it kept is over for every page; one
    // it was still reading stays.
    if (this.#approved) return this.#abandon();
    return this.#kept === null ? Promise.resolve() : this.#forget(this.#kept);
  }

  #begin(): AbortSignal {
    this.#attempt?.abort();
    this.#attempt = new AbortController();
    this.#set({ step: "checking" });
    return this.#attempt.signal;
  }

  async #finish(
    signal: AbortSignal,
    server: string,
    credentials: Credentials,
    {
      loginFlow = false,
      saved: onSaved,
    }: { loginFlow?: boolean; saved?: () => Promise<void> } = {},
  ) {
    const { http, store, secrets, signingInTo } = this.#options;
    // Once saved, the account is one of the platform's own.
    const end = signingInTo?.(server);
    let saved: Awaited<ReturnType<typeof saveAccount>>;
    try {
      const { homeUrl } = await CalDavProvider.discover(http, server, credentials);
      if (signal.aborted) return;
      saved = await saveAccount(
        { store, secrets, http },
        {
          name: accountName(credentials.username, server),
          serverUrl: server,
          homeUrl,
          credentials,
          loginFlow,
        },
      );
    } finally {
      end?.();
    }
    await onSaved?.();
    const { account, added } = saved;
    if (signal.aborted) {
      // Cancelled while it was saved: an account it added goes again. One it
      // signed in to again keeps its new password, as the user meant it to.
      // Login Flow's app password, made for nothing, is revoked.
      if (added) await removeAccount({ store, secrets, http }, account.id);
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
