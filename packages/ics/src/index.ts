// Subscriptions (docs/plans/providers.md#D251): a read-only calendar from an
// ICS address, kept fresh by one conditional GET. The file is split into one
// calendar object per UID (`@astrotime/core/split`), each kept under the
// href `<calendar>#<UID>`. Loaded only when an account of its kind syncs or
// is added (D255): it imports the modules it needs, never a package's index,
// so its chunk takes nothing else off the first load.
import type { HttpClient } from "@astrotime/caldav";
import {
  AuthError,
  NO_RIGHTS,
  ServerBusyError,
  retryAfter,
  type Changes,
  type Provider,
  type RemoteCalendar,
  type RemoteObject,
  type SyncState,
  type WriteResult,
} from "@astrotime/core/provider";
import { NotCalendarError, splitCalendar, type SplitCalendar } from "@astrotime/core/split";

/**
 * What a subscription's secret holds (the platform's secret store, never
 * the store's row, D251): its address, which may hold a secret (Google's
 * "secret address"), and the version of the file the user agreed to apply
 * though it removes many items (`HeldRemovalError`).
 */
export interface Subscription {
  readonly url: string;
  readonly apply: string | null;
}

/** A sync removing this many of a calendar's items, or more, at once is held (D251, D263). */
const HELD_SHARE = 0.5;
/** Calendars smaller than this are held only when they would lose every item. */
const HELD_SMALLEST = 20;

/**
 * The file would remove every item of a calendar that had some, or more
 * than half of one of 20 or more: nothing is removed until the user applies
 * this version (`version`) of it (D251, providers D263).
 */
export class HeldRemovalError extends Error {
  override name = "HeldRemovalError";
  /** As the sync engine reports it (`SyncReport.errors`). */
  readonly problem = "held-removal";
  readonly held: { readonly count: number; readonly version: string };
  constructor(count: number, version: string) {
    super(`The calendar's file would remove ${count} items; held until the user applies it.`);
    this.held = { count, version };
  }
}

/** The address of an ICS file from what the user typed: `webcal://` read as `https://`. */
export function subscriptionAddress(typed: string): string | null {
  const text = typed.trim().replace(/^webcals?:\/\//i, "https://");
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (!/^https?:$/.test(url.protocol) || url.hostname === "") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The calendar's own address in the store: the subscription's, hashed, since it may hold a secret. */
export async function calendarUrlOf(url: string): Promise<string> {
  return `ics:${(await sha256(url)).slice(0, 32)}`;
}

/**
 * The sync's view of the file, kept as the calendar's `syncToken`: the
 * answer's validators for the next conditional GET, and the hash of its
 * text, so an equal token means the same file (foundation D127), whether
 * the server gives validators or not. `ctag` is the hash alone.
 */
interface Validators {
  readonly etag: string | null;
  readonly modified: string | null;
  readonly hash: string | null;
}

const validatorsOf = (state: SyncState | undefined): Validators => {
  try {
    const parsed = JSON.parse(state?.syncToken ?? "null") as Partial<Validators> | null;
    return {
      etag: parsed?.etag ?? null,
      modified: parsed?.modified ?? null,
      hash: parsed?.hash ?? null,
    };
  } catch {
    return { etag: null, modified: null, hash: null };
  }
};

/** One subscription, as a provider: one read-only calendar from one file. */
export class IcsProvider implements Provider {
  private readonly http: HttpClient;
  private readonly subscription: Subscription;
  private readonly calendarUrl: string;
  /** What the store keeps of the calendar: its name, colour and state, for a `304`. */
  private readonly kept: (Pick<RemoteCalendar, "name" | "color"> & SyncState) | null;
  private file: {
    readonly split: SplitCalendar;
    readonly hash: string;
    readonly state: SyncState;
  } | null = null;
  private objects: Map<string, RemoteObject> | null = null;

  constructor(
    http: HttpClient,
    subscription: Subscription,
    calendarUrl: string,
    kept: (Pick<RemoteCalendar, "name" | "color"> & SyncState) | null,
  ) {
    this.http = http;
    this.subscription = subscription;
    this.calendarUrl = calendarUrl;
    this.kept = kept;
  }

  /** How often the file asks to be read at most, in milliseconds, once it was read. */
  get refresh(): number | null {
    return this.file?.split.refresh ?? null;
  }

  calendars(): Promise<RemoteCalendar[]> {
    return this.read(true);
  }

  /** One GET of the file; `conditional`, with the validators of what the store has. */
  private async read(conditional: boolean): Promise<RemoteCalendar[]> {
    const { etag, modified } = validatorsOf(this.kept ?? undefined);
    const headers: Record<string, string> = { Accept: "text/calendar, */*;q=0.5" };
    // Validators only while the store has what they validate.
    if (conditional && this.kept?.ctag) {
      if (etag) headers["If-None-Match"] = etag;
      if (modified) headers["If-Modified-Since"] = modified;
    }
    const response = await this.http({ method: "GET", url: this.subscription.url, headers });
    if (response.status === 304 && this.kept)
      return [this.calendar(this.kept.name, this.kept.color, this.kept)];
    if (response.status === 401 || response.status === 403)
      throw new AuthError(`The subscription's server refused it (${response.status}).`);
    if (response.status === 429 || response.status >= 500)
      throw new ServerBusyError(
        `The subscription's server answered ${response.status}.`,
        retryAfter(response.header("retry-after")),
      );
    if (response.status !== 200)
      throw new Error(`The subscription's server answered ${response.status}.`);
    // Not one VCALENDAR (a sign-in page, a cut file): a failed sync that
    // changes nothing (NotCalendarError, D251).
    const split = splitCalendar(response.body);
    const hash = await sha256(response.body);
    const validators: Validators = {
      etag: response.header("etag"),
      modified: response.header("last-modified"),
      hash,
    };
    const state: SyncState = { syncToken: JSON.stringify(validators), ctag: hash };
    this.file = { split, hash, state };
    return [this.calendar(split.name ?? new URL(this.subscription.url).host, split.color, state)];
  }

  private calendar(name: string, color: string | null, state: SyncState): RemoteCalendar {
    return {
      url: this.calendarUrl,
      name,
      color,
      components: ["VEVENT", "VTODO"],
      rights: NO_RIGHTS,
      state: { syncToken: state.syncToken, ctag: state.ctag },
    };
  }

  /** The file's objects by href, each with the hash of its text as its ETag. */
  private async parsed(): Promise<Map<string, RemoteObject>> {
    if (this.objects) return this.objects;
    // After a 304 the engine asks nothing more (the listing's state is the
    // store's); asked anyway, the file is read again without validators.
    if (!this.file) await this.read(false);
    if (!this.file) throw new Error("The subscription's file was not read.");
    const objects = new Map<string, RemoteObject>();
    for (const object of this.file.split.objects) {
      // VJOURNAL and other kinds the views do not show are left out.
      if (object.kind !== "VEVENT" && object.kind !== "VTODO") continue;
      const href = `${this.calendarUrl}#${encodeURIComponent(object.uid)}`;
      objects.set(href, { href, etag: await sha256(object.ics), ics: object.ics });
    }
    this.objects = objects;
    return objects;
  }

  async changes(
    _calendarUrl: string,
    _state: SyncState,
    known: ReadonlyMap<string, string | null>,
  ): Promise<Changes> {
    const objects = await this.parsed();
    const changed = [...objects.values()].filter(
      (object) => known.get(object.href) !== object.etag,
    );
    const removed = [...known.keys()].filter((href) => !objects.has(href));
    const held =
      removed.length > 0 &&
      (removed.length === known.size ||
        (known.size >= HELD_SMALLEST && removed.length > known.size * HELD_SHARE));
    const version = this.file!.hash;
    if (held && this.subscription.apply !== version)
      throw new HeldRemovalError(removed.length, version);
    return { changed, removed, ...this.file!.state };
  }

  async fetch(href: string): Promise<RemoteObject | null> {
    return (await this.parsed()).get(href) ?? null;
  }

  // A subscription is read-only: the sync engine never writes to one
  // (NO_RIGHTS, foundation D37); a write that reached here is refused.
  create(): Promise<WriteResult> {
    return Promise.reject(new Error("A subscription is read-only."));
  }

  update(): Promise<WriteResult> {
    return Promise.reject(new Error("A subscription is read-only."));
  }

  remove(): Promise<WriteResult> {
    return Promise.reject(new Error("A subscription is read-only."));
  }
}

export { NotCalendarError };
