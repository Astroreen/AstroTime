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
  /** A hash of name and password, to the password hash it was checked against. */
  private readonly checked = new Map<string, string>();

  constructor(database: ServerDatabase, now: () => number) {
    this.database = database;
    this.now = now;
  }

  /** The user a request's `Authorization` names, if its password is theirs. */
  async signIn(header: string | null, address: string): Promise<SignIn> {
    const limited = this.limited(address);
    if (limited > 0) return { type: "limited", seconds: limited };
    const credentials = basic(header);
    if (!credentials) return { type: "none" };
    const user = await this.database.user(credentials.name);
    const key = createHash("sha256")
      .update(`${credentials.name}\0${credentials.password}`)
      .digest("base64");
    // A changed password (`setPassword`) is checked again.
    if (user && this.checked.get(key) === user.password) return { type: "user", user };
    // An unknown name costs a hash as a known one does, so the time tells neither.
    const hash = user?.password ?? (await standInHash());
    if ((await verifyPassword(credentials.password, hash)) && user) {
      if (this.checked.size >= REMEMBERED) this.checked.clear();
      this.checked.set(key, user.password);
      return { type: "user", user };
    }
    this.fail(address);
    return { type: "refused" };
  }

  /** Seconds until `address` may sign in again; 0 when it may now. */
  private limited(address: string): number {
    const entry = this.failures.get(address);
    if (!entry || entry.count < FAILURES) return 0;
    const left = entry.since + WINDOW_MS - this.now();
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  private fail(address: string): void {
    const now = this.now();
    if (this.failures.size >= TRACKED) {
      for (const [at, entry] of this.failures)
        if (now - entry.since >= WINDOW_MS) this.failures.delete(at);
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
