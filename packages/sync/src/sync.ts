import {
  AuthError,
  CalendarObjectError,
  mergeObjects,
  OfflineError,
  sameObjects,
  type Provider,
  type RemoteObject,
  type SyncState,
  type WriteResult,
} from "@astrotime/core";
import type { Calendar, Store, StoredObject } from "@astrotime/storage";

/**
 * What went wrong for one object or calendar, as a code the UI words in the
 * user's language (AGENTS.md rule 5); `detail` is English, for the logs.
 */
export type Problem =
  | "read-only"
  | "no-create"
  | "deletion-reverted"
  | "no-place"
  | "taken-unreadable"
  | "calendar-gone-unsent"
  | "failed";

class SyncProblem extends Error {
  readonly problem: Problem;
  constructor(problem: Problem, detail: string) {
    super(detail);
    this.problem = problem;
  }
}

/** What one sync did, for the UI and the logs. */
export interface SyncReport {
  uploaded: number;
  downloaded: number;
  removed: number;
  /** Local changes the server refused on a field it changed too (D6). */
  conflicts: number;
  /** Objects the server serves that are not valid iCalendar; left on the server untouched (D36). */
  skipped: string[];
  /**
   * What failed for one object or one calendar without stopping the rest
   * (D37); a failed change stays pending for the next sync.
   */
  errors: { href: string; problem: Problem; detail: string }[];
  /** Local changes dropped because the server deleted their object (D38), so the UI can say so. */
  dropped: string[];
}

/**
 * Reconciles one account's calendars in the local store with its provider
 * (docs/plans/foundation.md#D5, D6, D37):
 *
 * 1. the server's calendars replace the account's calendar list;
 * 2. per calendar, local changes go up first, so a refused write is merged
 *    with the server's version before anything comes down;
 * 3. then the server's changes since the last sync come down.
 *
 * `OfflineError` and `AuthError` stop the sync where it is: every local
 * change not yet accepted stays pending for the next one, and the error
 * carries what was done until then as `report`. Any other failure is
 * confined to its object (or, while downloading, its calendar) and reported
 * in `errors`.
 */
export async function syncAccount(
  store: Store,
  provider: Provider,
  accountId: string,
): Promise<SyncReport> {
  const report: SyncReport = {
    uploaded: 0,
    downloaded: 0,
    removed: 0,
    conflicts: 0,
    skipped: [],
    errors: [],
    dropped: [],
  };

  try {
    await run(store, provider, accountId, report);
  } catch (error) {
    if (error instanceof Error) Object.assign(error, { report });
    throw error;
  }
  return report;
}

async function run(store: Store, provider: Provider, accountId: string, report: SyncReport) {
  const remote = await provider.calendars();
  const listed = new Map(remote.map((calendar) => [calendar.url, calendar.state]));
  const urls = new Set(listed.keys());
  // The listing's state is not the device's: it is kept only once the calendar is downloaded.
  for (const { state: _, ...calendar } of remote)
    await store.saveCalendar({ accountId, ...calendar });
  for (const calendar of await store.calendars(accountId)) {
    if (urls.has(calendar.url)) continue;
    // A calendar deleted on the server goes with its objects (D38). One that
    // only went missing from a listing must not take unsent changes with it:
    // it stays, reported, until a listing without it finds it has none.
    const unsent = (await store.pending(calendar.id)).length;
    if (unsent === 0) await store.removeCalendar(calendar.id);
    else
      report.errors.push({
        href: calendar.url,
        problem: "calendar-gone-unsent",
        detail: `${calendar.name}: ${unsent} change(s) not sent`,
      });
  }

  for (const calendar of (await store.calendars(accountId)).filter((c) => urls.has(c.url))) {
    const pending = await store.pending(calendar.id);
    for (const object of pending) {
      await isolated(report, absolute(calendar, object.href), async () => {
        if (allowed(calendar, object.pending))
          await upload(store, provider, calendar, object, report);
        else await settleRefused(store, provider, calendar, object, report);
      });
    }
    // Nothing changed there since its last download, and nothing went up: no request (D127).
    if (pending.length === 0 && unchanged(calendar, listed.get(calendar.url))) continue;
    await isolated(report, calendar.url, () =>
      download(store, provider, calendar, listed.get(calendar.url), report),
    );
  }
}

/**
 * Whether the listing says a calendar is as the device last downloaded it:
 * its sync token, or without one its ctag, is the one kept then (D127). A
 * download that left something out keeps no new one, so it is not skipped.
 */
function unchanged(kept: SyncState, listed: SyncState | undefined): boolean {
  if (!listed) return false;
  if (listed.syncToken !== null) return listed.syncToken === kept.syncToken;
  return listed.ctag !== null && listed.ctag === kept.ctag;
}

async function isolated(
  report: SyncReport,
  href: string,
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (error instanceof OfflineError || error instanceof AuthError) throw error;
    report.errors.push({
      href,
      problem: error instanceof SyncProblem ? error.problem : "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * A stored href made absolute. The provider spells every href it returns one
 * way (`canonicalHref` in `@astrotime/caldav`), and a local creation's
 * `encodeURIComponent(uid).ics` is spelled that way already.
 */
function absolute(calendar: Calendar, href: string): string {
  return new URL(href, calendar.url).href;
}

/** The server's objects stored in one transaction of the store (D99). */
const DOWNLOAD_BATCH = 500;

/** Whether the calendar's rights let a pending change of this kind go up (D37). */
function allowed(calendar: Calendar, pending: StoredObject["pending"]): boolean {
  const { rights } = calendar;
  if (pending === "create") return rights.create;
  if (pending === "delete") return rights.delete;
  return rights.edit;
}

/**
 * A change the calendar's rights do not let us make: the server's version
 * comes back, and an edit of ours goes to the Conflicts list, where the user
 * can copy it elsewhere. A creation has no server version to come back to;
 * it stays pending, reported, until the calendar takes new items.
 */
async function settleRefused(
  store: Store,
  provider: Provider,
  calendar: Calendar,
  object: StoredObject,
  report: SyncReport,
) {
  const { rights } = calendar;
  const readOnly = !rights.create && !rights.edit && !rights.delete;
  if (object.pending === "create")
    throw readOnly
      ? new SyncProblem("read-only", `${calendar.name} is read-only on the server`)
      : new SyncProblem("no-create", `${calendar.name} takes no new items on the server`);
  const server = await provider.fetch(absolute(calendar, object.href));
  if (!server) {
    await store.removeObject(object.id);
    if (object.pending !== "delete") report.dropped.push(absolute(calendar, object.href));
    return;
  }
  if (object.pending === "update") {
    await store.addConflict(object.id, object.ics);
    report.conflicts++;
  }
  // A deletion the server will not take: the item comes back, and the user is told.
  if (object.pending === "delete") {
    report.errors.push({
      href: server.href,
      problem: "deletion-reverted",
      detail: readOnly
        ? `${calendar.name} is read-only on the server`
        : `${calendar.name} lets no item be deleted on the server`,
    });
  }
  try {
    await store.saveFromServer(calendar.id, server, { replacePending: object });
  } catch (error) {
    // Not iCalendar (D36): nothing to give way to; ours stays, the object is reported.
    if (!(error instanceof CalendarObjectError)) throw error;
    if (!report.skipped.includes(server.href)) report.skipped.push(server.href);
  }
}

async function upload(
  store: Store,
  provider: Provider,
  calendar: Calendar,
  object: StoredObject,
  report: SyncReport,
) {
  const href = absolute(calendar, object.href);
  if (object.pending === "delete") {
    const etag = await currentEtag(provider, href, object);
    const result: WriteResult =
      etag === CHANGED
        ? { ok: false, reason: "conflict" }
        : etag === GONE
          ? { ok: true, href, etag: null }
          : await provider.remove(href, etag);
    if (result.ok) {
      await store.removeObject(object.id);
      report.uploaded++;
    } else {
      // Changed on the server since: the change wins over our deletion (D38).
      const server = await provider.fetch(href);
      if (server) await saveServerVersion(store, calendar, server, report, object);
      else await store.removeObject(object.id);
    }
    return;
  }

  if (object.pending === "create") {
    const result = await provider.create(href, object.ics);
    if (result.ok) {
      await store.markSynced(object.id, { href: result.href, etag: result.etag, ics: object.ics });
      report.uploaded++;
      return;
    }
    // A creation has no server copy to be deleted (D38 does not apply): a
    // missing calendar or a bad href keeps it pending, reported.
    if (result.reason === "gone")
      throw new SyncProblem("no-place", `The server has no place for ${href}`);
    // Something is at the href already: our own earlier upload whose answer
    // was lost, or another object. Ours is recognised; otherwise the server's
    // stays and ours goes to the Conflicts list.
    const server = await provider.fetch(href);
    if (!server)
      throw new SyncProblem(
        "taken-unreadable",
        `${href} is taken on the server, but cannot be read`,
      );
    if (!sameObjects(server.ics, object.ics)) {
      await store.addConflict(object.id, object.ics);
      report.conflicts++;
    }
    // Our row moves to the server's href first, so the server's version replaces it,
    // unless it was edited meanwhile: markSynced keeps that edit pending for the next sync.
    await store.markSynced(object.id, { href: server.href, etag: server.etag, ics: object.ics });
    const now = await store.object(object.id);
    if (now && now.pending !== "none") {
      // Its base is the server's version, which the edit will be merged with.
      await store.rebase(now.id, now.ics, { ics: now.ics, etag: server.etag, baseIcs: server.ics });
      return;
    }
    if (now) await saveServerVersion(store, calendar, server, report, now);
    return;
  }

  let uploaded = object.ics;
  const etag = await currentEtag(provider, href, object);
  let result: WriteResult =
    etag === CHANGED
      ? { ok: false, reason: "conflict" }
      : etag === GONE
        ? { ok: false, reason: "gone" }
        : await provider.update(href, object.ics, etag);
  if (!result.ok && result.reason === "conflict") {
    const server = await provider.fetch(href);
    if (!server) {
      result = { ok: false, reason: "gone" };
    } else {
      // Without a base nobody can tell whose change a field is: unless both
      // sides agree, the server's version stays and ours is a conflict.
      if (object.baseIcs === null) {
        if (!sameObjects(server.ics, object.ics)) {
          await store.addConflict(object.id, object.ics);
          report.conflicts++;
        }
        await saveServerVersion(store, calendar, server, report, object);
        return;
      }
      // Merge onto what the server has now, and try once more against its ETag.
      const merge = mergeObjects(object.baseIcs, object.ics, server.ics);
      const rebased = await store.rebase(object.id, object.ics, {
        ics: merge.ics,
        etag: server.etag,
        baseIcs: server.ics,
      });
      // Edited again on this device meanwhile: the next sync merges that edit.
      if (!rebased) return;
      // Recorded once: the rebased change no longer clashes with this server version.
      if (merge.conflict) {
        await store.addConflict(object.id, object.ics);
        report.conflicts++;
      }
      // Without a strong ETag the retry could overwrite a change made since
      // the fetch; the next sync compares with the new base first (currentEtag).
      if (server.etag === null || server.etag.startsWith("W/")) return;
      uploaded = merge.ics;
      result = await provider.update(href, merge.ics, server.etag);
      // Refused again: it changed once more meanwhile; the next sync merges the rebased change.
      if (!result.ok && result.reason === "conflict") return;
    }
  }
  if (result.ok) {
    await store.markSynced(object.id, { href: result.href, etag: result.etag, ics: uploaded });
    report.uploaded++;
  } else {
    // Deleted on the server while we edited it: the deletion wins (D38).
    await store.removeObject(object.id);
    report.dropped.push(href);
  }
}

/** `currentEtag`'s answers: the server's copy is no longer our change's base, or no longer there. */
const CHANGED = Symbol("changed");
const GONE = Symbol("gone");

/**
 * The ETag to write against. A server that gave no ETag for our last write
 * (or a weak one) would get an unconditional write that could overwrite a
 * change made there since (D6, D38); its copy is fetched and compared with
 * our change's base instead. A server that never gives ETags gets `null`,
 * after the comparison.
 */
async function currentEtag(
  provider: Provider,
  href: string,
  object: StoredObject,
): Promise<string | null | typeof CHANGED | typeof GONE> {
  // A weak ETag (`W/"…"`) never matches an If-Match: treated as none.
  const weak = (etag: string | null) => etag?.startsWith("W/") ?? false;
  if (object.etag !== null && !weak(object.etag)) return object.etag;
  const server = await provider.fetch(href);
  // Deleted there: an unconditional write would bring it back (D38).
  if (!server) return GONE;
  if (object.baseIcs === null || !sameObjects(server.ics, object.baseIcs)) return CHANGED;
  return weak(server.etag) ? null : server.etag;
}

async function download(
  store: Store,
  provider: Provider,
  calendar: Calendar,
  listed: SyncState | undefined,
  report: SyncReport,
) {
  const local = new Map<
    string,
    { id: string; etag: string | null; pending: StoredObject["pending"] }
  >();
  for (const entry of await store.hrefs(calendar.id)) {
    // A creation that has not reached the server is not the server's to remove.
    if (entry.pending !== "create") local.set(absolute(calendar, entry.href), entry);
  }
  const known = new Map([...local].map(([href, entry]) => [href, entry.etag]));

  const changes = await provider.changes(calendar.url, calendar, known, listed);
  let keepToken = false;
  /** The server's versions of objects with no change of ours: stored in batches. */
  const plain: RemoteObject[] = [];
  for (const object of changes.changed) {
    const mine = local.get(object.href);
    if (mine && mine.pending !== "none") {
      // Our own change is still pending (its upload was refused); it is
      // merged on the next sync. Where the calendar's rights refuse it, it
      // never can be: the server's version shows, ours goes to the Conflicts list.
      if (allowed(calendar, mine.pending)) {
        // Asked again next time: the server keeps reporting it until ours is merged.
        keepToken = true;
        continue;
      }
      const ours = await store.object(mine.id);
      if (ours && ours.pending !== "delete") {
        await store.addConflict(ours.id, ours.ics);
        report.conflicts++;
      }
      try {
        if (ours) await store.saveFromServer(calendar.id, object, { replacePending: ours });
        report.downloaded++;
      } catch (error) {
        if (!(error instanceof CalendarObjectError)) throw error;
        if (!report.skipped.includes(object.href)) report.skipped.push(object.href);
      }
      continue;
    }
    plain.push(object);
  }
  // A transaction and a notification per batch, not per object: a big
  // calendar's first sync is thousands (D99).
  for (let i = 0; i < plain.length; i += DOWNLOAD_BATCH) {
    const batch = plain.slice(i, i + DOWNLOAD_BATCH);
    const { invalid } = await store.saveManyFromServer(calendar.id, batch);
    report.downloaded += batch.length - invalid.length;
    for (const href of invalid) if (!report.skipped.includes(href)) report.skipped.push(href);
  }
  // Edited here since the sync began: that edit is newer than this listing,
  // and the next sync decides it (an upload, then D38); the store removes an
  // object only if its pending change is still the one seen here.
  const gone = changes.removed.flatMap((href) => {
    const mine = local.get(href);
    return mine ? [{ href, ...mine }] : [];
  });
  const removed = new Set(gone.length > 0 ? await store.removeManyFromServer(gone) : []);
  for (const mine of gone.filter((object) => removed.has(object.id))) {
    report.removed++;
    if (mine.pending !== "none") report.dropped.push(mine.href);
  }
  if (!keepToken)
    await store.setSyncState(calendar.id, { syncToken: changes.syncToken, ctag: changes.ctag });
}

/** The server's version replaces ours; one that is not iCalendar is skipped (D36), ours kept. */
async function saveServerVersion(
  store: Store,
  calendar: Calendar,
  server: RemoteObject,
  report: SyncReport,
  seen: Pick<StoredObject, "ics" | "pending">,
) {
  try {
    await store.saveFromServer(calendar.id, server, { replacePending: seen });
  } catch (error) {
    if (!(error instanceof CalendarObjectError)) throw error;
    if (!report.skipped.includes(server.href)) report.skipped.push(server.href);
  }
}
