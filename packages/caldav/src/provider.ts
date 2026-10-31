import type {
  Changes,
  Provider,
  RemoteCalendar,
  RemoteObject,
  SyncState,
  WriteResult,
} from "@astrotime/core";

import {
  AuthError,
  HttpError,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from "./http.ts";
import {
  attribute,
  children,
  multiget,
  parseMultistatus,
  propfind,
  syncCollection,
  text,
  type DavResponse,
} from "./xml.ts";

export interface Credentials {
  readonly username: string;
  /** A password, or a Nextcloud app password (docs/plans/foundation.md#D19). */
  readonly password: string;
}

/** Where discovery found an account's calendars. */
export interface Discovery {
  readonly principalUrl: string;
  readonly homeUrl: string;
}

const MULTIGET_BATCH = 100;
/** Truncated sync-collection answers followed before falling back to a full listing. */
const MAX_SYNC_PAGES = 50;

function basic({ username, password }: Credentials): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return `Basic ${btoa(Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(""))}`;
}

/** `#RRGGBBAA` (Apple, Nextcloud) to `#RRGGBB`; anything else as it is. */
function color(value: string | null): string | null {
  return value && /^#[0-9a-f]{8}$/i.test(value) ? value.slice(0, 7) : value;
}

/**
 * One spelling of an href, so the device and the server compare equal:
 * servers differ on percent-encoding (`a%40b.ics` and `a@b.ics` are one
 * resource). Each path segment is decoded and encoded again.
 */
export function canonicalHref(href: string, base?: string): string {
  const url = new URL(href, base);
  url.pathname = url.pathname
    .split("/")
    .map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return segment;
      }
    })
    .join("/");
  return url.href;
}

/** Calendar URLs end in a slash; servers are not consistent about it in hrefs. */
function collection(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * The CalDAV provider (RFC 4791, RFC 6578, RFC 6764). Every URL it takes and
 * returns is absolute; hrefs from the server are resolved against the URL
 * that answered.
 */
export class CalDavProvider implements Provider {
  private readonly http: HttpClient;
  private readonly authorization: string;
  readonly homeUrl: string;

  constructor(http: HttpClient, credentials: Credentials, homeUrl: string) {
    this.http = http;
    this.authorization = basic(credentials);
    this.homeUrl = collection(homeUrl);
  }

  /**
   * Finds the calendar home of an account: through `/.well-known/caldav`
   * (RFC 6764), then the address itself (Nextcloud's `remote.php/dav`, or a
   * Radicale root).
   */
  static async discover(
    http: HttpClient,
    serverUrl: string,
    credentials: Credentials,
  ): Promise<Discovery> {
    const authorization = basic(credentials);
    const candidates = [new URL("/.well-known/caldav", serverUrl).href, serverUrl];
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const principal = await propfindOne(http, authorization, candidate, [
          "d:current-user-principal",
        ]);
        const principalHref = text(principal.response?.props["current-user-principal"]);
        if (!principalHref) continue;
        // The credentials go no further than the origin that answered: a
        // principal or a home the server names elsewhere is not followed.
        const origin = new URL(principal.url).origin;
        const principalUrl = new URL(principalHref, principal.url).href;
        if (new URL(principalUrl).origin !== origin) continue;
        const home = await propfindOne(http, authorization, principalUrl, ["c:calendar-home-set"]);
        const homeHref = text(home.response?.props["calendar-home-set"]);
        const homeUrl = homeHref ? collection(new URL(homeHref, home.url).href) : null;
        if (homeUrl && new URL(homeUrl).origin === origin) return { principalUrl, homeUrl };
      } catch (error) {
        if (error instanceof AuthError) throw error;
        lastError = error;
      }
    }
    throw new Error(`No CalDAV calendar home found at ${serverUrl}.`, { cause: lastError });
  }

  async calendars(): Promise<RemoteCalendar[]> {
    const response = await this.request({
      method: "PROPFIND",
      url: this.homeUrl,
      headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
      body: propfind([
        "d:resourcetype",
        "d:displayname",
        "ic:calendar-color",
        "c:supported-calendar-component-set",
        "d:current-user-privilege-set",
        "nc:deleted-at",
      ]),
    });
    return (
      parseMultistatus(response.body)
        .responses.filter((r) => children(r.props["resourcetype"]).includes("calendar"))
        // Nextcloud 31 lists deleted calendars from its trash bin with `deleted-at` and
        // without the calendar resourcetype; both are checked, should either change.
        .filter((r) => !text(r.props["deleted-at"]))
        .filter((r) => this.own(r.href, response.url) !== null)
        .map((r) => toCalendar(r, response.url))
    );
  }

  async changes(
    calendarUrl: string,
    state: SyncState,
    known: ReadonlyMap<string, string | null>,
  ): Promise<Changes> {
    const url = collection(calendarUrl);
    if (state.syncToken) {
      const removed = new Set<string>();
      const changed = new Set<string>();
      let token = state.syncToken;
      // A server may truncate its answer (RFC 6578 §3.6: 507 on the
      // collection itself) and give a token to continue from; we ask again
      // until it is complete.
      for (let page = 0; page < MAX_SYNC_PAGES; page++) {
        const response = await this.request(
          {
            method: "REPORT",
            url,
            headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
            body: syncCollection(token, ["d:getetag"]),
          },
          // An expired or unknown token (RFC 6578 §3.2) falls back to a full listing.
          [403, 409, 410],
        );
        if (response.status >= 300) break;
        const status = parseMultistatus(response.body);
        let truncated = false;
        for (const r of status.responses) {
          const href = this.own(r.href, response.url);
          if (href === null) continue;
          if (collection(href) === url) {
            truncated ||= r.status === 507;
            continue;
          }
          if (r.status === 404) {
            removed.add(href);
            changed.delete(href);
          } else if (!known.has(href) || known.get(href) !== text(r.props["getetag"])) {
            changed.add(href);
            removed.delete(href);
          }
        }
        if (!status.syncToken) break;
        token = status.syncToken;
        if (!truncated) {
          const got = await this.multiget(url, [...changed]);
          return {
            changed: got.objects,
            removed: [...removed, ...got.removed],
            syncToken: got.incomplete ? null : token,
            ctag: null,
          };
        }
      }
    }

    // A full listing: every href with its ETag, compared with what the device has.
    const response = await this.request({
      method: "PROPFIND",
      url,
      headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
      body: propfind(["d:getetag", "d:resourcetype", "d:sync-token", "cs:getctag"]),
    });
    const status = parseMultistatus(response.body);
    const listed = new Map<string, string | null>();
    let syncToken: string | null = null;
    let ctag: string | null = null;
    for (const r of status.responses) {
      const href = this.own(r.href, response.url);
      if (href === null) continue;
      if (collection(href) === url) {
        syncToken = text(r.props["sync-token"]);
        ctag = text(r.props["getctag"]);
        continue;
      }
      if (children(r.props["resourcetype"]).includes("collection")) continue;
      listed.set(href, text(r.props["getetag"]));
    }
    const changed = [...listed]
      .filter(([href, etag]) => !known.has(href) || known.get(href) !== etag)
      .map(([href]) => href);
    const removed = [...known.keys()].filter((href) => !listed.has(href));
    const got = await this.multiget(url, changed);
    return {
      changed: got.objects,
      removed: [...removed, ...got.removed],
      syncToken: got.incomplete ? null : syncToken,
      ctag: got.incomplete ? null : ctag,
    };
  }

  async fetch(href: string): Promise<RemoteObject | null> {
    const response = await this.request(
      { method: "GET", url: this.wire(href), headers: { Accept: "text/calendar" } },
      [404, 410],
    );
    if (response.status >= 400) return null;
    return { href, etag: response.header("etag"), ics: response.body };
  }

  async create(href: string, ics: string): Promise<WriteResult> {
    return this.write(href, ics, { "If-None-Match": "*" });
  }

  async update(href: string, ics: string, etag: string | null): Promise<WriteResult> {
    return this.write(href, ics, etag ? { "If-Match": etag } : {});
  }

  async remove(href: string, etag: string | null): Promise<WriteResult> {
    const response = await this.request(
      { method: "DELETE", url: this.wire(href), headers: etag ? { "If-Match": etag } : {} },
      [404, 410, 412],
    );
    if (response.status === 412) return { ok: false, reason: "conflict" };
    // Already gone is what we wanted.
    return { ok: true, href, etag: null };
  }

  private async write(
    href: string,
    ics: string,
    condition: Record<string, string>,
  ): Promise<WriteResult> {
    const response = await this.request(
      {
        method: "PUT",
        url: this.wire(href),
        headers: { "Content-Type": "text/calendar; charset=utf-8", ...condition },
        body: ics,
      },
      [404, 410, 412],
    );
    if (response.status === 412) return { ok: false, reason: "conflict" };
    if (response.status >= 400) return { ok: false, reason: "gone" };
    // A server that changes what it stores (or a weak ETag) gives no ETag; the next sync fetches it.
    const etag = response.header("etag");
    return { ok: true, href, etag: etag && !etag.startsWith("W/") ? etag : null };
  }

  /**
   * The objects at `hrefs`, by multiget. One the multiget leaves out is
   * fetched on its own; gone, it counts as removed. Anything still missing
   * makes the result `incomplete`, and the caller keeps no sync token, so the
   * next sync lists everything again instead of never seeing it.
   */
  private async multiget(
    calendarUrl: string,
    hrefs: readonly string[],
  ): Promise<{ objects: RemoteObject[]; removed: string[]; incomplete: boolean }> {
    const objects: RemoteObject[] = [];
    for (let i = 0; i < hrefs.length; i += MULTIGET_BATCH) {
      const batch = hrefs.slice(i, i + MULTIGET_BATCH);
      const response = await this.request({
        method: "REPORT",
        url: calendarUrl,
        headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
        body: multiget(batch.map((href) => new URL(this.wire(href)).pathname)),
      });
      for (const r of parseMultistatus(response.body).responses) {
        const ics = text(r.props["calendar-data"]);
        const href = this.own(r.href, response.url);
        if (ics && href) objects.push({ href, etag: text(r.props["getetag"]), ics });
      }
    }
    const got = new Set(objects.map((o) => o.href));
    const removed: string[] = [];
    let incomplete = false;
    for (const href of hrefs.filter((h) => !got.has(h))) {
      const object = await this.fetch(href).catch(() => undefined);
      if (object === null) removed.push(href);
      else if (object) objects.push(object);
      else incomplete = true;
    }
    return { objects, removed, incomplete };
  }

  /**
   * Every request goes to the calendar home's origin: an href the server
   * names on another origin never gets the credentials.
   */
  private request(request: HttpRequest, accept: readonly number[] = []): Promise<HttpResponse> {
    if (new URL(request.url).origin !== new URL(this.homeUrl).origin) {
      return Promise.reject(
        new Error(
          `${request.url} is not on ${new URL(this.homeUrl).origin}; its credentials stay home.`,
        ),
      );
    }
    return send(this.http, this.authorization, request, accept);
  }

  /** An href from the server, resolved; `null` when it points to another origin. */
  private own(href: string, base: string): string | null {
    const url = canonicalHref(href, base);
    if (new URL(url).origin !== new URL(this.homeUrl).origin) return null;
    // Compared in one spelling, asked for in the server's own.
    this.spelling.set(url, new URL(href, base).pathname);
    return url;
  }

  /** How the server spells each href it named (see `own`). */
  private readonly spelling = new Map<string, string>();

  /** An href as the server spells it, for a request about it. */
  private wire(href: string): string {
    const path = this.spelling.get(href);
    return path ? new URL(path, href).href : href;
  }
}

async function send(
  http: HttpClient,
  authorization: string,
  request: HttpRequest,
  accept: readonly number[],
): Promise<HttpResponse> {
  const response = await http({
    ...request,
    headers: { ...request.headers, Authorization: authorization },
  });
  if (response.status === 401) throw new AuthError(request);
  if (response.status >= 400 && !accept.includes(response.status))
    throw new HttpError(request, response);
  return response;
}

async function propfindOne(
  http: HttpClient,
  authorization: string,
  url: string,
  props: readonly string[],
): Promise<{ url: string; response: DavResponse | undefined }> {
  const response = await send(
    http,
    authorization,
    {
      method: "PROPFIND",
      url,
      headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body: propfind(props),
    },
    [],
  );
  return { url: response.url, response: parseMultistatus(response.body).responses[0] };
}

function toCalendar(response: DavResponse, base: string): RemoteCalendar {
  const components = componentsOf(response.props["supported-calendar-component-set"]);
  const privileges = JSON.stringify(response.props["current-user-privilege-set"] ?? {});
  return {
    url: collection(canonicalHref(response.href, base)),
    name:
      text(response.props["displayname"]) ??
      decodeURIComponent(new URL(response.href, base).pathname.split("/").findLast(Boolean) ?? ""),
    color: color(text(response.props["calendar-color"])),
    components,
    // No privilege set means the server does not say; take it as writable.
    readOnly:
      response.props["current-user-privilege-set"] !== undefined &&
      !/"(write|write-content|all)"/.test(privileges),
  };
}

function componentsOf(set: unknown): ("VEVENT" | "VTODO")[] {
  const comps =
    (set && typeof set === "object" ? (set as { comp?: unknown[] }).comp : undefined) ?? [];
  const names = comps.map((comp) => attribute(comp, "name")?.toUpperCase());
  const known = names.filter((n): n is "VEVENT" | "VTODO" => n === "VEVENT" || n === "VTODO");
  // Without the set, RFC 4791 §5.2.3 says any component may be stored.
  return comps.length === 0 ? ["VEVENT", "VTODO"] : known;
}
