// Accounts as the dialogs name them (design D313): by name, and two of one
// name (one login on two servers) by their server too, its path as well when
// they share a host.
import type { Account } from "@astrotime/storage";

const where = (account: Account, withPath: boolean): string | null => {
  try {
    const url = new URL(account.serverUrl);
    const path = url.pathname.replace(/\/$/, "");
    return withPath && path ? `${url.host}${path}` : url.host;
  } catch {
    return null;
  }
};

/** Each account's label by its id: `nameOf`'s, and its server's beside a twin's. */
export function accountLabels(
  accounts: readonly Account[],
  nameOf: (account: Account) => string,
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const account of accounts) {
    const name = nameOf(account);
    const twins = accounts.filter((one) => one.id !== account.id && nameOf(one) === name);
    if (twins.length === 0) {
      labels.set(account.id, name);
      continue;
    }
    const host = where(account, false);
    const sameHost = twins.some((one) => where(one, false) === host);
    const server = where(account, sameHost);
    labels.set(account.id, server ? `${name} (${server})` : name);
  }
  return labels;
}
