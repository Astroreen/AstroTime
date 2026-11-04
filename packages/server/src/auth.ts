// Who sends a request (docs/plans/server.md#D282): HTTP Basic against the
// users' scrypt hashes, and a limit on failed sign-ins per address.
import { createHash } from "node:crypto";

import type { ServerDatabase, User } from "./database.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";

/** Failed sign-ins from one address in a window before it is refused. */
const FAILURES = 10;
const WINDOW_MS = 60_000;
/** Addresses tracked before the stale ones are forgotten. */
const TRACKED = 10_000;
/** Credentials remembered as checked, so a sync's requests cost one scrypt, not one each. */
const REMEMBERED = 1_000;

export type SignIn =
  | { readonly type: "user"; readonly user: User }
  | { readonly type: "none" }
  | { readonly type: "refused" }
  /** Too many failures from the address: try again in `seconds`. */
  | { readonly type: "limited"; readonly seconds: number };

export class Gate {
  private readonly database: ServerDatabase;
  private readonly now: () => number;
  /** Per address, when its window began and how many failures it holds. */
  private readonly failures = new Map<string, { since: number; count: number }>();
  /** Per address, the checks it has running: each could be a failure. */
  private readonly pending = new Map<string, number>();
  /** A hash of name and password, to the password hash it was checked against. */
  private readonly checked = new Map<string, string>();
  /** Checks running now by the same key: requests with one password share one scrypt. */
  private readonly running = new Map<string, Promise<User | null>>();

  constructor(database: ServerDatabase, now: () => number) {
    this.database = database;
    this.now = now;
  }

  /**
   * The user a request's `Authorization` names, if its password is theirs.
   * `address` `null`: a caller that cannot tell clients apart, which gets no
   * limit rather than one bucket that locks every user out at once.
   *
   * Only a refused password is a failure, counted when its check ends; a
   * success gives nothing back. Checks still running count against the
   * limit too, so guesses sent at once meet it as one after another do,
   * while a client's many requests with one password are one check.
   */
  async signIn(header: string | null, address: string | null): Promise<SignIn> {
    const limited = address === null ? 0 : this.limited(address);
    if (limited > 0) return { type: "limited", seconds: limited };
    const credentials = basic(header);
    if (!credentials) return { type: "none" };
    const key = createHash("sha256")
      .update(`${credentials.name}\0${credentials.password}`)
      .digest("base64");
    let check = this.running.get(key);
    if (!check) {
      check = this.settle(credentials, key, address);
      this.running.set(key, check);
    }
    const user = await check;
    return user ? { type: "user", user } : { type: "refused" };
  }

  /** A check with its bookkeeping, done before anyone waiting on it reads the answer. */
  private async settle(
    credentials: { name: string; password: string },
    key: string,
    address: string | null,
  ): Promise<User | null> {
    if (address !== null) this.pending.set(address, (this.pending.get(address) ?? 0) + 1);
    try {
      const user = await this.check(credentials, key);
      if (!user && address !== null) this.fail(address);
      return user;
    } finally {
      this.running.delete(key);
      if (address !== null) {
        const left = (this.pending.get(address) ?? 1) - 1;
        if (left > 0) this.pending.set(address, left);
        else this.pending.delete(address);
      }
    }
  }

  /** The user whose password this is, or `null`. */
  private async check(credentials: { name: string; password: string }, key: string) {
    const user = await this.database.exclusive(() => this.database.user(credentials.name));
    // A changed password (`setPassword`) is checked again.
    if (user && this.checked.get(key) === user.password) return user;
    // An unknown name costs a hash as a known one does, so the time tells neither.
    const hash = user?.password ?? (await standInHash());
    if (!(await verifyPassword(credentials.password, hash)) || !user) return null;
    if (this.checked.size >= REMEMBERED) this.checked.clear();
    this.checked.set(key, user.password);
    return user;
  }

  /** Seconds until `address` may sign in again; 0 when it may now. */
  private limited(address: string): number {
    const entry = this.failures.get(address);
    const fresh = entry && this.now() - entry.since < WINDOW_MS ? entry : null;
    if ((fresh?.count ?? 0) + (this.pending.get(address) ?? 0) < FAILURES) return 0;
    // Held by checks still running: their failures would start a window now.
    return fresh ? Math.ceil((fresh.since + WINDOW_MS - this.now()) / 1000) : WINDOW_MS / 1000;
  }

  private fail(address: string): void {
    const now = this.now();
    if (this.failures.size >= TRACKED) {
      for (const [at, entry] of this.failures)
        if (now - entry.since >= WINDOW_MS) this.failures.delete(at);
      // All fresh: the oldest windows go, so the map stays bounded.
      for (const at of this.failures.keys()) {
        if (this.failures.size < TRACKED) break;
        this.failures.delete(at);
      }
    }
    const entry = this.failures.get(address);
    if (entry && now - entry.since < WINDOW_MS) entry.count++;
    else this.failures.set(address, { since: now, count: 1 });
  }
}

let standIn: Promise<string> | null = null;
/** A hash of no one's password, to check an unknown name against. */
function standInHash(): Promise<string> {
  standIn ??= hashPassword(crypto.randomUUID());
  return standIn;
}

/** A Basic `Authorization` header's name and password (RFC 7617, UTF-8). */
function basic(header: string | null): { name: string; password: string } | null {
  const match = header && /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
  if (!match) return null;
  const decoded = Buffer.from(match[1]!, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon < 0 ? null : { name: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}
