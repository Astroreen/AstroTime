// The interface every provider implements (docs/plans/foundation.md#D4) and
// the sync engine (`@astrotime/sync`) drives. CalDAV is the first; nothing
// in it is WebDAV-shaped.

/** A calendar as the server describes it. */
export interface RemoteCalendar {
  /** The calendar's address on the server; stable across renames. */
  readonly url: string;
  readonly name: string;
  readonly color: string | null;
  readonly components: readonly ("VEVENT" | "VTODO")[];
  /** What the user may do in it (docs/plans/foundation.md#D37). */
  readonly rights: CalendarRights;
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
  | { readonly ok: true; readonly href: string; readonly etag: string | null }
  /** `conflict`: the object changed on the server first (412); `gone`: it no longer exists. */
  | { readonly ok: false; readonly reason: "conflict" | "gone" };

export interface Provider {
  calendars(): Promise<RemoteCalendar[]>;
  /**
   * What changed in a calendar since `state`. `known` holds every href the
   * device has with its ETag, for servers (or expired tokens) that can only
   * list everything.
   */
  changes(
    calendarUrl: string,
    state: SyncState,
    known: ReadonlyMap<string, string | null>,
  ): Promise<Changes>;
  fetch(href: string): Promise<RemoteObject | null>;
  /** Creates an object at `href`; fails with `conflict` if one is there already. */
  create(href: string, ics: string): Promise<WriteResult>;
  /** Replaces the object if the server still has `etag`. */
  update(href: string, ics: string, etag: string | null): Promise<WriteResult>;
  /** Removes the object if the server still has `etag`. */
  remove(href: string, etag: string | null): Promise<WriteResult>;
}

/** A provider could not reach its server; local changes wait for the next sync. */
export class OfflineError extends Error {
  override name = "OfflineError";
}

/** The server refused the credentials; no sync can go on until they change. */
export class AuthError extends Error {
  override name = "AuthError";
}
