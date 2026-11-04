// Subscriptions in the sync (docs/plans/providers.md#D251, D263): adding
// one from an address, opening its provider for a sync, reading its file at
// most hourly (or as the file asks, if longer) unless the user asks, and the
// user applying a file whose removals were held. Loaded only when an account
// of the kind is added or syncs (D255), with `@astrotime/ics`.
import type { HttpClient } from "@astrotime/caldav";
import { calendarUrlOf, IcsProvider, subscriptionAddress, type Subscription } from "@astrotime/ics";
import type { Account, Store } from "@astrotime/storage";

import type { AccountSync, SyncContext } from "./all.ts";
import { keyOf } from "./secret.ts";

/** The shortest wait between two reads of a subscription's file, unless the user asks. */
export const SUBSCRIPTION_EVERY_MS = 60 * 60_000;

/** A subscription's secret: its address, and the file version the user applied (D263). */
function parseSubscription(secret: string | null): Subscription | null {
  if (secret === null) return null;
  try {
    const parsed = JSON.parse(secret) as { subscription?: unknown; apply?: unknown };
    if (typeof parsed.subscription !== "string") return null;
    return {
      url: parsed.subscription,
      apply: typeof parsed.apply === "string" ? parsed.apply : null,
    };
  } catch {
    return null;
  }
}

/** Each store's subscriptions read lately: until when they are left alone, and what they said. */
const recently = new WeakMap<Store, Map<string, { until: number; last: AccountSync }>>();

/** A subscription's last sync, while its file is not to be read again yet (none when `retry`). */
export function recent(store: Store, accountId: string, now: number, retry: boolean) {
  const read = recently.get(store)?.get(accountId);
  return read && !retry && now < read.until ? read.last : null;
}

/**
 * Keeps a subscription's sync, and leaves its file alone for the hour, or as
 * long as it asks; only a clean sync: one that said a problem (a held
 * removal) is read again at the next chance (D263).
 */
export function remember(
  store: Store,
  last: AccountSync,
  provider: IcsProvider,
  now: number,
): void {
  if (last.status !== "synced" || last.report.errors.length > 0) {
    forget(store, last.accountId);
    return;
  }
  let reads = recently.get(store);
  if (!reads) recently.set(store, (reads = new Map()));
  reads.set(last.accountId, {
    until: now + Math.max(SUBSCRIPTION_EVERY_MS, provider.refresh ?? 0),
    last,
  });
}

/** A subscription read again at the next chance: its last sync failed, or said a problem. */
export function forget(store: Store, accountId: string): void {
  recently.get(store)?.delete(accountId);
}

/** A subscription's provider for a sync; `null` when no address is saved for it. */
export async function open(
  context: Pick<SyncContext, "store" | "secrets"> & { readonly http?: HttpClient },
  account: Account,
  secret: string | null,
): Promise<IcsProvider | null> {
  const subscription = parseSubscription(secret);
  if (!subscription || !context.http || !account.homeUrl) return null;
  const [kept] = await context.store.calendars(account.id);
  return new IcsProvider(context.http, subscription, account.homeUrl, kept ?? null);
}

/**
 * Adds a subscription from what the user typed: the file read once, so a
 * wrong address (a page, no calendar, refused) is said before anything is
 * kept; then the account, named by the file, with its address in the
 * secret store, never in the store's row (D251). Subscribing again to the
 * same address finds the account it has.
 */
export async function addSubscription(
  context: Pick<SyncContext, "store" | "secrets"> & { readonly http: HttpClient },
  typed: string,
): Promise<{ readonly account: Account; readonly added: boolean } | null> {
  const url = subscriptionAddress(typed);
  if (!url) return null;
  const calendarUrl = calendarUrlOf(url);
  const [calendar] = await new IcsProvider(
    context.http,
    { url, apply: null },
    calendarUrl,
    null,
  ).calendars();
  const found = await context.store.findOrAddAccount({
    provider: "ics",
    name: calendar!.name,
    // Its origin alone: the rest of the address may hold a secret (D251).
    serverUrl: new URL(url).origin,
    username: null,
    homeUrl: calendarUrl,
  });
  try {
    await context.secrets.set(
      keyOf(found.account.id),
      JSON.stringify({ subscription: url, apply: null }),
    );
  } catch (error) {
    if (found.added) await context.store.removeAccount(found.account.id);
    throw error;
  }
  return found;
}

/**
 * After a sync, a held removal the user applied is used up: the next file
 * that removes as much asks again, even one the same as before (D263).
 */
export async function settle(
  context: Pick<SyncContext, "secrets">,
  accountId: string,
  provider: IcsProvider,
): Promise<void> {
  const used = provider.subscription.apply;
  if (used === null) return;
  // Read again now: a "Remove them" pressed while this sync ran, for a newer
  // file, wrote its own version, which stays for the next sync; only the
  // version this sync used is cleared.
  const now = parseSubscription(await context.secrets.get(keyOf(accountId)));
  if (!now || now.apply !== used) return;
  await context.secrets.set(
    keyOf(accountId),
    JSON.stringify({ subscription: now.url, apply: null }),
  );
}

/**
 * The user applies a subscription's file whose removals were held (D263):
 * that version, and only it, goes through at the next sync.
 */
export async function applyHeld(
  context: Pick<SyncContext, "secrets">,
  accountId: string,
  version: string,
): Promise<void> {
  const subscription = parseSubscription(await context.secrets.get(keyOf(accountId)));
  if (!subscription) return;
  await context.secrets.set(
    keyOf(accountId),
    JSON.stringify({ subscription: subscription.url, apply: version }),
  );
}
