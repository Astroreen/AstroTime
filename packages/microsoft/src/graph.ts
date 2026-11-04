// Microsoft Graph as the providers ask it (docs/plans/providers.md#D253): JSON
// with the account's bearer token, renewed once when refused (`send`), sent
// to Graph only; every time asked in UTC and every body as text (`Prefer`),
// each time read by its own zone all the same; pages followed by their
// `@odata.nextLink`; writes against the item's `@odata.etag` (`If-Match`).
import { Authorization, send, type HttpClient, type TokenSource } from "@astrotime/caldav";
import { ianaName, isKnownTimeZone, wallClockIn, zonedToEpoch } from "@astrotime/core/time";

export const GRAPH = "https://graph.microsoft.com/v1.0/";
const ORIGIN = new URL(GRAPH).origin;
/** More pages than a mailbox has: a listing longer is Graph's fault, refused rather than taken as whole. */
const MAX_PAGES = 1000;

export class Graph {
  private readonly http: HttpClient;
  private readonly authorization: Authorization;

  constructor(http: HttpClient, tokens: TokenSource) {
    this.http = http;
    this.authorization = new Authorization(tokens);
  }

  async json<T>(
    method: string,
    url: string,
    options: {
      readonly body?: unknown;
      readonly etag?: string | null;
      readonly accept?: readonly number[];
    } = {},
  ): Promise<{ readonly status: number; readonly value: T | null }> {
    // The bearer token goes to Graph and nowhere else (a page link elsewhere, plain http).
    if (new URL(url).origin !== ORIGIN)
      throw new Error(`Not Microsoft Graph: ${new URL(url).origin}`);
    const response = await send(
      this.http,
      this.authorization,
      {
        method,
        url,
        headers: {
          Accept: "application/json",
          Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"',
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(options.etag ? { "If-Match": options.etag } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      },
      options.accept ?? [],
    );
    return {
      status: response.status,
      value: response.body ? (JSON.parse(response.body) as T) : null,
    };
  }

  /**
   * Every item of a collection, page after page. A listing that comes back
   * to a page it gave, or goes on past `MAX_PAGES`, is refused, never taken
   * as the whole collection (what it misses would be removed here).
   */
  async all<T>(url: string): Promise<T[]> {
    const items: T[] = [];
    const seen = new Set<string>();
    let next: string | undefined = url;
    while (next) {
      if (seen.has(next)) throw new Error("Graph gave a page it had given already.");
      if (seen.size >= MAX_PAGES) throw new Error(`Graph gave more than ${MAX_PAGES} pages.`);
      seen.add(next);
      const page: { value?: T[]; "@odata.nextLink"?: string } | null = (
        await this.json<{ value?: T[]; "@odata.nextLink"?: string }>("GET", next)
      ).value;
      items.push(...(page?.value ?? []));
      next = page?.["@odata.nextLink"];
    }
    return items;
  }
}

/**
 * Graph's ETags are weak (`W/"…"`), its only ones, and its `If-Match` takes
 * them. The engine writes unconditionally for a weak ETag once it has
 * compared what Graph has with the base (D37), which leaves a window for an
 * edit made there meanwhile; kept as `~"…"`, they are sent as `W/"…"`, and
 * Graph refuses a write over such an edit (`412`).
 */
export const keptEtag = (etag: string | null | undefined): string | null =>
  etag ? etag.replace(/^W\//, "~") : null;
export const sentEtag = (etag: string | null): string | null =>
  etag ? etag.replace(/^~/, "W/") : null;

/**
 * Graph's `{ dateTime, timeZone }`: a wall clock in its zone, UTC when
 * `Prefer` was heeded (To Do's due dates keep their own).
 */
export interface GraphTime {
  readonly dateTime: string;
  readonly timeZone: string;
}

/**
 * The IANA zone a Graph zone name stands for (an IANA name, a Windows one);
 * `UTC` for Graph's own (`tzone://Microsoft/Utc`) and for one no zone
 * database knows (`Customized Time Zone`).
 */
export function zoneOf(name: string | undefined): string {
  if (!name) return "UTC";
  const iana = ianaName(name);
  return iana !== "UTC" && isKnownTimeZone(iana) ? iana : "UTC";
}

/** A Graph time as the RFC 3339 UTC instant (`…Z`) it is in its own zone. */
export function utcOf(time: GraphTime): string {
  const local = time.dateTime.replace(/\.\d+$/, "").replace(/Z$/, "");
  const zone = zoneOf(time.timeZone);
  if (zone === "UTC") return `${local}Z`;
  return new Date(zonedToEpoch(local, zone)).toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * A day as iCalendar's DATE (`20261106`) from its midnight's instant: that
 * instant's day in `zone`, the item's own; Vilnius's 6 November starts on
 * the 5th in UTC. A zone not known here (UTC in its place) takes the
 * nearest midnight, right for every offset within 12 hours.
 */
export function dayIn(instant: string, zone: string): string {
  const epoch = Date.parse(instant);
  return (
    zone === "UTC" ? new Date(epoch + 12 * 3_600_000).toISOString() : wallClockIn(epoch, zone)
  )
    .slice(0, 10)
    .replaceAll("-", "");
}
