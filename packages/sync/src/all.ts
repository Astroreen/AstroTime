import {
  CalDavProvider,
  ProxyRefusedError,
  revokeAppPassword,
  type Credentials,
  type HttpClient,
} from "@astrotime/caldav";
import { AuthError, OfflineError, type Provider, type SecretStore } from "@astrotime/core";
import type { Account, Store } from "@astrotime/storage";

import { syncAccount, type SyncReport } from "./sync.ts";

/**
 * What syncing every account needs from a platform
 * (docs/plans/android.md#D60): the local store, where the credentials are
 * kept, and how an account's provider is opened (`connectCalDav` with the
 * platform's `HttpClient`).
 */
export interface SyncContext {
  readonly store: Store;
  readonly secrets: SecretStore;
  readonly connect: Connect;
  /**
   * Keeps the syncs of one store apart where several instances of it share
   * one database (the web's tabs, docs/plans/foundation.md#D91); without it,
   * this instance is the store's only one.
   */
  readonly lock?: SyncLock;
}

/**
 * Runs `work` once no other instance of the store is syncing, waiting for
 * the one that is, and holds the others off until `work` ends.
 */
export type SyncLock = <T>(work: () => Promise<T>) => Promise<T>;

const alone = <T>(context: Pick<SyncContext, "lock">, work: () => Promise<T>): Promise<T> =>
  context.lock ? context.lock(work) : work();

/** Opens the provider of an account with its credentials. */
export type Connect = (account: Account, credentials: Credentials) => Promise<Provider>;

/** CalDAV accounts through the platform's HTTP client, from the home discovery found. */
export function connectCalDav(http: HttpClient): Connect {
  return async (account, credentials) => {
    const home =
      account.homeUrl ??
      (await CalDavProvider.discover(http, account.serverUrl, credentials)).homeUrl;
    return new CalDavProvider(http, credentials, home);
  };
}

/**
 * How one account's sync ended. `signed-out`: the server refused the
 * credentials, or none are saved: the user signs in again. `refused`: the web
 * proxy does not carry this server (D20, D39). `offline`: the server could not
 * be reached; local changes wait. `failed`: anything else, in English in
 * `detail`. A sync that stopped carries what it did until then in `report`.
 */
export type AccountSync =
  | { readonly accountId: string; readonly status: "synced"; readonly report: SyncReport }
  | {
      readonly accountId: string;
      readonly status: "signed-out" | "refused" | "offline" | "failed";
      readonly detail: string;
      readonly report: SyncReport | null;
    };

export interface SyncAllReport {
  /** Every account that syncs, in the store's order; the demo's never does. */
  readonly accounts: readonly AccountSync[];
  readonly finishedAt: number;
}

interface Runs {
  current: Promise<SyncAllReport> | null;
  next: Promise<SyncAllReport> | null;
  /** Accounts on their way out: a sync that starts now leaves them alone. */
  readonly removing: Map<string, number>;
}

/** The sync running on each store, and the one waiting to start after it. */
const runs = new WeakMap<Store, Runs>();

function runsOf(store: Store): Runs {
  let found = runs.get(store);
  if (!found) {
    found = { current: null, next: null, removing: new Map() };
    runs.set(store, found);
  }
  return found;
}

const ignore = () => {};

/**
 * Syncs every account, one after another, and reports how each went; it
 * never throws for an account (docs/plans/foundation.md#D90). A call while a
 * sync runs joins it instead of starting a second. With `fresh`, the caller
 * needs a sync that starts after the call (a local change, an account just
 * added): it gets the running one's successor, which every such call during
 * the run shares. With the context's `lock`, a sync waits for another
 * instance's sync of the store to end (D91).
 */
export function syncAll(
  context: SyncContext,
  options: { readonly fresh?: boolean } = {},
): Promise<SyncAllReport> {
  const state = runsOf(context.store);
  if (!state.current) return state.next ?? begin(context, state);
  if (!options.fresh) return state.current;
  state.next ??= state.current.then(ignore, ignore).then(() => {
    state.next = null;
    return begin(context, state);
  });
  return state.next;
}

function begin(context: SyncContext, state: Runs): Promise<SyncAllReport> {
  // After another instance's sync, not beside it: one pending change goes up once.
  const run = alone(context, () => everyAccount(context, state.removing));
  state.current = run;
  const done = () => {
    if (state.current === run) state.current = null;
  };
  run.then(done, done);
  return run;
}

async function everyAccount(
  context: SyncContext,
  removing: ReadonlyMap<string, number>,
): Promise<SyncAllReport> {
  const accounts: AccountSync[] = [];
  for (const account of await context.store.accounts()) {
    // The demo's items live in the store alone.
    if (account.provider !== "caldav" || removing.has(account.id)) continue;
    accounts.push(await syncOne(context, account));
  }
  return { accounts, finishedAt: Date.now() };
}

async function syncOne(context: SyncContext, account: Account): Promise<AccountSync> {
  const accountId = account.id;
  try {
    const credentials = await readCredentials(context.secrets, accountId);
    if (!credentials) {
      return {
        accountId,
        status: "signed-out",
        detail: "No credentials are saved for this account.",
        report: null,
      };
    }
    const provider = await context.connect(account, credentials);
    return {
      accountId,
      status: "synced",
      report: await syncAccount(context.store, provider, accountId),
    };
  } catch (error) {
    const report = (error as { report?: SyncReport } | null)?.report ?? null;
    const detail = error instanceof Error ? error.message : String(error);
    const status =
      error instanceof AuthError
        ? "signed-out"
        : error instanceof OfflineError
          ? "offline"
          : error instanceof ProxyRefusedError
            ? "refused"
            : "failed";
    return { accountId, status, detail, report };
  }
}

// Accounts and their credentials. The credentials are the platform's
// (`SecretStore`), never the store's (foundation D36); the key and the JSON
// are spelled here only.

const keyOf = (accountId: string) => `account:${accountId}`;

async function readCredentials(
  secrets: SecretStore,
  accountId: string,
): Promise<Credentials | null> {
  return (await readSecret(secrets, accountId))?.credentials ?? null;
}

/** The credentials kept for an account, and whether Login Flow v2 gave its password. */
async function readSecret(
  secrets: SecretStore,
  accountId: string,
): Promise<{ readonly credentials: Credentials; readonly loginFlow: boolean } | null> {
  const value = await secrets.get(keyOf(accountId));
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as {
      username?: unknown;
      password?: unknown;
      loginFlow?: unknown;
    };
    if (typeof parsed.username === "string" && typeof parsed.password === "string") {
      return {
        credentials: { username: parsed.username, password: parsed.password },
        loginFlow: parsed.loginFlow === true,
      };
    }
  } catch {
    // Unreadable: as if none were saved, so the user signs in again.
  }
  return null;
}

/**
 * Keeps an account the user signed in to: the account in the store, its
 * credentials in the platform's secret store, with whether Login Flow v2
 * gave the password (an app password, revoked when the account goes).
 * Signing in to an account that is here already (the same calendar home and
 * user) replaces its password instead, as "sign in again" does; the store
 * looks and adds in one transaction, so two sign-ins at once add one. An app
 * password Login Flow v2 gave the password replaced is revoked with `http`,
 * unwaited: `replaced` says how that went.
 */
export async function saveAccount(
  context: Pick<SyncContext, "store" | "secrets"> & { readonly http?: HttpClient },
  input: {
    readonly name: string;
    readonly serverUrl: string;
    readonly homeUrl: string;
    readonly credentials: Credentials;
    /** The password is an app password from Nextcloud's Login Flow v2. */
    readonly loginFlow?: boolean;
  },
): Promise<{
  readonly account: Account;
  readonly added: boolean;
  readonly replaced: Promise<AppPasswordRevocation>;
}> {
  const { store, secrets } = context;
  const secret = JSON.stringify({
    username: input.credentials.username,
    password: input.credentials.password,
    ...(input.loginFlow ? { loginFlow: true } : {}),
  });
  const { account, added } = await store.findOrAddAccount({
    name: input.name,
    serverUrl: input.serverUrl,
    username: input.credentials.username,
    homeUrl: input.homeUrl,
  });
  // An old secret that cannot be read only leaves its app password unrevoked:
  // signing in again is how the user repairs broken credentials.
  const old = added ? null : await readSecret(secrets, account.id).catch(() => null);
  try {
    await secrets.set(keyOf(account.id), secret);
  } catch (error) {
    if (added) await store.removeAccount(account.id);
    throw error;
  }
  // The device no longer uses the old app password: it leaves no way in behind.
  let replaced: Promise<AppPasswordRevocation> = Promise.resolve("none");
  if (old?.loginFlow && old.credentials.password !== input.credentials.password) {
    replaced = context.http
      ? revokeAppPassword(context.http, account.serverUrl, old.credentials).then(
          () => "revoked" as const,
          () => "kept" as const,
        )
      : Promise.resolve("kept");
  }
  return { account, added, replaced };
}

/**
 * What became of an account's app password when it was removed: `revoked`
 * on the server, `kept` there (the server could not be reached, or would
 * not; the user can revoke it in Nextcloud's security settings), or `none`:
 * its password was no app password of Login Flow v2.
 */
export type AppPasswordRevocation = "revoked" | "kept" | "none";

/**
 * Removes an account from this device: its credentials first (an account
 * left behind asks to sign in again; a password left behind would be
 * invisible), then its calendars and items. Syncs that start from now on
 * leave it alone, and the running one and the one queued after it end
 * first, as does another instance's (the context's `lock`), so nothing of the
 * account is written while it goes. Then, with `http`, an app password Login
 * Flow v2 gave it is revoked on the server, as far as that can be done.
 */
export async function removeAccount(
  context: Pick<SyncContext, "store" | "secrets" | "lock"> & {
    readonly http?: HttpClient;
    /** How long to wait for the server's revocation (tests set 0). */
    readonly revokeWaitMs?: number;
  },
  accountId: string,
): Promise<AppPasswordRevocation> {
  const state = runsOf(context.store);
  // Counted, so overlapping removals of one account do not end each other's.
  state.removing.set(accountId, (state.removing.get(accountId) ?? 0) + 1);
  let removed: { account: Account | undefined; secret: Awaited<ReturnType<typeof readSecret>> };
  try {
    // A sync begun before this call may be inside the account; any later one skips it.
    await Promise.all([state.current, state.next].map((run) => run?.catch(ignore)));
    // Another instance's sync may be inside it too; the next one finds it gone.
    removed = await alone(context, async () => {
      const account = (await context.store.accounts()).find((a) => a.id === accountId);
      const secret = await readSecret(context.secrets, accountId);
      await context.secrets.delete(keyOf(accountId));
      await context.store.removeAccount(accountId);
      return { account, secret };
    });
  } finally {
    const left = (state.removing.get(accountId) ?? 1) - 1;
    if (left > 0) state.removing.set(accountId, left);
    else state.removing.delete(accountId);
  }
  // After the account is gone from here: the server is waited on only a
  // little; past that the revocation goes on, and the user hears it is not
  // known to be revoked.
  const { account, secret } = removed;
  if (!secret?.loginFlow || !account) return "none";
  if (!context.http) return "kept";
  const revoking = revokeAppPassword(context.http, account.serverUrl, secret.credentials).then(
    () => "revoked" as const,
    () => "kept" as const,
  );
  let stop: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<"kept">((resolve) => {
    stop = setTimeout(() => resolve("kept"), context.revokeWaitMs ?? REVOKE_WAIT_MS);
  });
  try {
    return await Promise.race([revoking, waited]);
  } finally {
    clearTimeout(stop);
  }
}

/** How long removing an account waits for the server to revoke its app password. */
const REVOKE_WAIT_MS = 15_000;
