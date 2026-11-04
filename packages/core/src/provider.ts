// The interface every provider implements (docs/plans/foundation.md#D4) and
// the sync engine (`@astrotime/sync`) drives. CalDAV is the first; nothing
// in it is WebDAV-shaped.
import type { NewAttachment } from "./attachments.ts";

/** A calendar as the server describes it. */
export interface RemoteCalendar {
  /** The calendar's address on the server; stable across renames. */
  readonly url: string;
  readonly name: string;
  readonly color: string | null;
  readonly components: readonly ("VEVENT" | "VTODO")[];
  /** What the user may do in it (docs/plans/foundation.md#D37). */
  readonly rights: CalendarRights;
  /**
   * Its sync token and ctag as the listing read them, when the server names
   * them there: equal to what the device kept, nothing in it changed since
   * (docs/plans/foundation.md#D127).
   */
  readonly state?: SyncState;
}

/**
 * What the user may do to a calendar's items, as its server grants it:
 * add new ones, change the ones it holds, delete them. A read-only
 * calendar grants none.
 */
export interface CalendarRights {
  readonly create: boolean;
  readonly edit: boolean;
  readonly delete: boolean;
}

/** A calendar the user owns, or one whose server does not say. */
export const ALL_RIGHTS: CalendarRights = { create: true, edit: true, delete: true };
/** A read-only calendar. */
export const NO_RIGHTS: CalendarRights = { create: false, edit: false, delete: false };

/** One calendar object resource on the server. */
export interface RemoteObject {
  /** Absolute URL. */
  readonly href: string;
  readonly etag: string | null;
  readonly ics: string;
}

/** What the sync engine remembers of a calendar between syncs. */
export interface SyncState {
  readonly syncToken: string | null;
  readonly ctag: string | null;
}

export interface Changes extends SyncState {
  /** Objects created or changed on the server since the last sync. */
  readonly changed: readonly RemoteObject[];
  /** Absolute URLs of objects removed on the server since the last sync. */
  readonly removed: readonly string[];
}

export type WriteResult =
  | {
      readonly ok: true;
      readonly href: string;
      readonly etag: string | null;
      /**
       * What the item says that the service could not keep (Google Tasks
       * keeps no priority, no reminders), by property: written without it,
       * and said so (providers D252).
       */
      readonly dropped?: readonly string[];
    }
  /** `conflict`: the object changed on the server first (412); `gone`: it no longer exists. */
  | { readonly ok: false; readonly reason: "conflict" | "gone" };

/**
 * Someone the account's server knows (design D208): a user of the same
 * Nextcloud, found by name or e-mail for a mention in a description.
 */
export interface Person {
  readonly name: string;
  readonly email: string | null;
}

/** A calendar or task list to make on an account's server (docs/plans/providers.md#D275). */
export interface NewCalendar {
  readonly name: string;
  /** `#rrggbb`; a service whose colours are its own (Graph's, Google's) is given none. */
  readonly color: string | null;
  /** What it holds: events, or tasks (a task list). */
  readonly component: "VEVENT" | "VTODO";
}

export interface Provider {
  calendars(): Promise<RemoteCalendar[]>;
  /**
   * Makes a calendar or task list on the server, at once, and gives it as
   * `calendars()` will list it (docs/plans/providers.md#D275). A provider
   * that makes none leaves it out.
   */
  makeCalendar?(calendar: NewCalendar): Promise<RemoteCalendar>;
  /**
   * People whose name or e-mail holds `query`, as the server finds them;
   * none where it finds nobody (design D208). A provider without people
   * leaves it out.
   */
  people?(query: string): Promise<Person[]>;
  /**
   * What changed in a calendar since `state`. `known` holds every href the
   * device has with its ETag, for servers (or expired tokens) that can only
   * list everything. `listed` is the calendar's state as this sync's
   * `calendars()` read it (`RemoteCalendar.state`), from which a provider
   * may choose how to ask (docs/plans/foundation.md#D127).
   */
  changes(
    calendarUrl: string,
    state: SyncState,
    known: ReadonlyMap<string, string | null>,
    listed?: SyncState,
  ): Promise<Changes>;
  fetch(href: string): Promise<RemoteObject | null>;
  /** Creates an object at `href`; fails with `conflict` if one is there already. */
  create(href: string, ics: string): Promise<WriteResult>;
  /** Replaces the object if the server still has `etag`. */
  update(href: string, ics: string, etag: string | null): Promise<WriteResult>;
  /** Removes the object if the server still has `etag`. */
  remove(href: string, etag: string | null): Promise<WriteResult>;
}

/** A file or a folder of the account's files (docs/plans/foundation.md#D231). */
export interface RemoteFile {
  /** Its path in the user's files, `/Calendar/Q3.pdf`. */
  readonly path: string;
  readonly name: string;
  readonly folder: boolean;
  /** Its media type, as the server says it. */
  readonly type: string | null;
  readonly size: number | null;
  /** The `ATTACH` it becomes on an item, as the server's own calendar app writes it; none for a folder. */
  readonly attachment: NewAttachment | null;
}

/** An account's files, as the edit dialog browses them (docs/plans/foundation.md#D231). */
export interface FileStore {
  /** What a folder holds, folders first, each by name; `/` is the top. */
  list(path: string): Promise<RemoteFile[]>;
  /**
   * Uploads a file from the device where the server's calendar app keeps
   * what it attaches (docs/plans/foundation.md#D232), under a name not
   * taken; resolves with the file as listed.
   */
  upload(name: string, type: string, bytes: Uint8Array): Promise<RemoteFile>;
}

/**
 * A listing of calendars that could read only part of an account (one of
 * its APIs failing: Google's Tasks API not enabled, a scope not given):
 * what it read, and the address prefixes of what it could not, which the
 * sync leaves as they are, said (docs/plans/providers.md#D252).
 */
export class PartialListing extends Error {
  override name = "PartialListing";
  readonly calendars: readonly RemoteCalendar[];
  readonly unread: readonly { readonly prefix: string; readonly error: unknown }[];
  constructor(
    calendars: readonly RemoteCalendar[],
    unread: readonly { readonly prefix: string; readonly error: unknown }[],
  ) {
    super(
      `Part of the account could not be listed: ${unread.map((part) => part.prefix).join(", ")}.`,
    );
    this.calendars = calendars;
    this.unread = unread;
  }
}

/** A provider could not reach its server; local changes wait for the next sync. */
export class OfflineError extends Error {
  override name = "OfflineError";
}

/**
 * The server asks to be left alone for a while: `429 Too Many Requests` or
 * `503 Service Unavailable` (docs/plans/foundation.md#D128). A sync stops on
 * it as when offline; `retryAfterMs` is its `Retry-After`, if it said one.
 */
export class ServerBusyError extends OfflineError {
  override name = "ServerBusyError";
  readonly retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * A `Retry-After` header (RFC 9110 §10.2.3) as milliseconds from `now`:
 * seconds, or an HTTP date; `null` when absent or unreadable.
 */
export function retryAfter(header: string | null, now = Date.now()): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** The server refused the credentials; no sync can go on until they change. */
export class AuthError extends Error {
  override name = "AuthError";
}
