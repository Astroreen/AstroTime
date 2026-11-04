// AstroTime's own CalDAV server (docs/plans/server.md#D279, D280): a
// `(Request) => Promise<Response>` handler, shaped like `proxyHandler`, over
// the server's database. It serves the subset AstroTime's provider and the
// common clients use; paths are `<prefix>principals/<user>/` and
// `<prefix>calendars/<user>/<calendar>/<object>`.
import { CalendarObject, CalendarObjectError } from "@astrotime/core";

import { Gate } from "./auth.ts";
import type { Calendar, Component, ServerDatabase, StoredObject, User } from "./database.ts";
import { filterOf, inRange } from "./query.ts";
import {
  APPLE,
  BadRequestError,
  CALDAV,
  CALENDARSERVER,
  child,
  DAV,
  failure,
  href,
  keyOf,
  multistatus,
  parseXml,
  response,
  status,
  tag,
  xmlText,
  type Element,
} from "./xml.ts";

export interface ServerOptions {
  readonly database: ServerDatabase;
  /** Where the server is mounted on its origin; `/dav/` by default. */
  readonly prefix?: string;
  /** The clock of the sign-in limit; tests move their own. */
  readonly now?: () => number;
}

/**
 * Who sent a request: the address failed sign-ins are counted by (D282).
 * The caller knows it (the socket's, or its reverse proxy's word); a request
 * without one counts with every other such request.
 */
export interface Client {
  readonly address: string;
}

/** The largest body taken: a calendar object with an inline file or two. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const ALLOW = "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL";
const DAV_CLASSES = "1, 3, calendar-access, extended-mkcol";
/** A sync token: the calendar's id and its change number (RFC 6578 §3.2 asks for a URI). */
const SYNC_TOKEN = /^urn:astrotime:sync:(\d+):(\d+)$/;
const COMPONENTS: readonly Component[] = ["VEVENT", "VTODO"];
/** What the owner of a calendar may do in it: everything (RFC 3744 §3). */
const PRIVILEGES = [
  "all",
  "read",
  "write",
  "write-properties",
  "write-content",
  "bind",
  "unbind",
  "read-current-user-privilege-set",
]
  .map((privilege) => `<d:privilege><d:${privilege}/></d:privilege>`)
  .join("");
const REPORTS = ["c:calendar-multiget", "c:calendar-query", "d:sync-collection"]
  .map((report) => `<d:supported-report><d:report><${report}/></d:report></d:supported-report>`)
  .join("");

/** A property a resource has: its value, made when asked. */
interface Property {
  readonly ns: string;
  readonly name: string;
  readonly value: () => string | Promise<string>;
}

interface Resource {
  readonly path: string;
  readonly properties: ReadonlyMap<string, Property>;
}

/** What a PROPFIND or REPORT asks for (RFC 4918 §9.1). */
type Asked =
  | { readonly type: "all" }
  | { readonly type: "names" }
  | { readonly type: "props"; readonly props: readonly { ns: string; name: string }[] };

type Target =
  | { readonly kind: "root" | "principals" | "calendars" | "principal" | "home" }
  | { readonly kind: "calendar"; readonly slug: string; readonly calendar: Calendar | null }
  | {
      readonly kind: "object";
      readonly calendar: Calendar | null;
      readonly name: string;
      readonly object: StoredObject | null;
    };

const properties = (...list: [string, string, Property["value"]][]) =>
  new Map(list.map(([ns, name, value]) => [keyOf(ns, name), { ns, name, value }]));

export function serverHandler(
  options: ServerOptions,
): (request: Request, client?: Client) => Promise<Response> {
  const { database } = options;
  const prefix = `/${(options.prefix ?? "/dav/").replaceAll(/^\/+|\/+$/g, "")}/`.replace("//", "/");
  const gate = new Gate(database, options.now ?? Date.now);

  return async (request, client) => {
    const url = new URL(request.url);
    // RFC 6764 §5: the well-known address leads to the context path.
    if (url.pathname.replace(/\/$/, "") === "/.well-known/caldav")
      return new Response(null, { status: 301, headers: { Location: prefix } });
    if (!`${url.pathname}/`.startsWith(prefix)) return new Response(null, { status: 404 });
    if (request.method === "OPTIONS")
      return new Response(null, { status: 200, headers: { DAV: DAV_CLASSES, Allow: ALLOW } });

    const signIn = await gate.signIn(request.headers.get("authorization"), client?.address ?? "");
    if (signIn.type === "limited")
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": String(signIn.seconds) },
      });
    if (signIn.type !== "user")
      return new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="AstroTime", charset="UTF-8"' },
      });

    const body = await read(request);
    if (body === null) return new Response(null, { status: 413 });
    try {
      return await database.exclusive(() =>
        new Session(database, prefix, signIn.user, request, url, body).answer(),
      );
    } catch (error) {
      if (error instanceof BadRequestError) return new Response(error.message, { status: 400 });
      throw error;
    }
  };
}

/** A request's body, or `null` past `MAX_BODY_BYTES`. */
async function read(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The ETags an `If-Match` or `If-None-Match` lists; a weak one compares as its strong self. */
const etags = (header: string) => header.split(",").map((etag) => etag.trim().replace(/^W\//, ""));

/**
 * Whether a write's conditions fail on a resource with `etag` (`null`: none
 * there) (RFC 9110 §13.1.1–2): the answer is then 412.
 */
function preconditionFails(request: Request, etag: string | null): boolean {
  const ifMatch = request.headers.get("if-match");
  if (
    ifMatch !== null &&
    (etag === null || (ifMatch.trim() !== "*" && !etags(ifMatch).includes(etag)))
  )
    return true;
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch !== null && etag !== null)
    return ifNoneMatch.trim() === "*" || etags(ifNoneMatch).includes(etag);
  return false;
}

/** One request of a signed-in user, inside the database's `exclusive`. */
class Session {
  private readonly database: ServerDatabase;
  private readonly prefix: string;
  private readonly user: User;
  private readonly request: Request;
  private readonly url: URL;
  private readonly body: Uint8Array;

  constructor(
    database: ServerDatabase,
    prefix: string,
    user: User,
    request: Request,
    url: URL,
    body: Uint8Array,
  ) {
    this.database = database;
    this.prefix = prefix;
    this.user = user;
    this.request = request;
    this.url = url;
    this.body = body;
  }

  async answer(): Promise<Response> {
    const target = await this.target(this.url.pathname);
    switch (this.request.method) {
      case "PROPFIND":
        return this.propfind(target);
      case "REPORT":
        return this.report(target);
      case "GET":
      case "HEAD":
        return this.get(target);
      case "PUT":
        return this.put(target);
      case "DELETE":
        return this.delete(target);
      case "MKCALENDAR":
      case "MKCOL":
        return this.mkcalendar(target);
      case "PROPPATCH":
        return this.proppatch(target);
      default:
        return new Response(null, { status: 405, headers: { Allow: ALLOW } });
    }
  }

  // Paths.

  private get principalPath() {
    return `${this.prefix}principals/${encodeURIComponent(this.user.name)}/`;
  }

  private get homePath() {
    return `${this.prefix}calendars/${encodeURIComponent(this.user.name)}/`;
  }

  private calendarPath(slug: string) {
    return `${this.homePath}${encodeURIComponent(slug)}/`;
  }

  private objectPath(calendar: Calendar, name: string) {
    return `${this.calendarPath(calendar.slug)}${encodeURIComponent(name)}`;
  }

  /**
   * What a path names; `null` for nothing the user may see. Another user's
   * principal and home are as absent as a path that names nothing (D282).
   */
  private async target(pathname: string): Promise<Target | null> {
    const rest = `${pathname}/`.slice(this.prefix.length);
    let segments: string[];
    try {
      segments = rest.split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
      throw new BadRequestError("The path is no percent-encoding.");
    }
    const [area, owner, slug, name, ...more] = segments;
    if (area === undefined) return { kind: "root" };
    if (owner === undefined)
      return area === "principals" || area === "calendars" ? { kind: area } : null;
    if (owner !== this.user.name || more.length > 0) return null;
    if (area === "principals") return slug === undefined ? { kind: "principal" } : null;
    if (area !== "calendars") return null;
    if (slug === undefined) return { kind: "home" };
    const calendar = await this.database.calendar(this.user.id, slug);
    if (name === undefined) return { kind: "calendar", slug, calendar };
    const object = calendar && (await this.database.object(calendar.id, name));
    return { kind: "object", calendar, name, object };
  }

  // Resources and their properties.

  private common(): [string, string, Property["value"]][] {
    return [
      [DAV, "current-user-principal", () => href(this.principalPath)],
      [DAV, "principal-collection-set", () => href(`${this.prefix}principals/`)],
    ];
  }

  private owned(): [string, string, Property["value"]][] {
    return [
      ...this.common(),
      [DAV, "owner", () => href(this.principalPath)],
      [DAV, "current-user-privilege-set", () => PRIVILEGES],
    ];
  }

  private collection(path: string): Resource {
    return {
      path,
      properties: properties(...this.common(), [DAV, "resourcetype", () => tag(DAV, "collection")]),
    };
  }

  private principal(): Resource {
    return {
      path: this.principalPath,
      properties: properties(
        ...this.common(),
        [DAV, "resourcetype", () => tag(DAV, "collection") + tag(DAV, "principal")],
        [DAV, "displayname", () => xmlText(this.user.name)],
        [DAV, "principal-URL", () => href(this.principalPath)],
        [CALDAV, "calendar-home-set", () => href(this.homePath)],
      ),
    };
  }

  private home(): Resource {
    return {
      path: this.homePath,
      properties: properties(...this.owned(), [DAV, "resourcetype", () => tag(DAV, "collection")]),
    };
  }

  private calendar(calendar: Calendar): Resource {
    const token = `urn:astrotime:sync:${calendar.id}:${calendar.sync}`;
    return {
      path: this.calendarPath(calendar.slug),
      properties: properties(
        ...this.owned(),
        [DAV, "resourcetype", () => tag(DAV, "collection") + tag(CALDAV, "calendar")],
        [DAV, "displayname", () => xmlText(calendar.name)],
        [DAV, "sync-token", () => token],
        [CALENDARSERVER, "getctag", () => token],
        [DAV, "supported-report-set", () => REPORTS],
        [
          CALDAV,
          "supported-calendar-component-set",
          () => calendar.components.map((name) => `<c:comp name="${name}"/>`).join(""),
        ],
        ...(calendar.color === null
          ? []
          : [
              [APPLE, "calendar-color", () => xmlText(calendar.color!)] as [
                string,
                string,
                () => string,
              ],
            ]),
      ),
    };
  }

  /** An object; with `withData`, its `calendar-data` too, which only a REPORT gives. */
  private object(calendar: Calendar, object: StoredObject, withData: boolean): Resource {
    return {
      path: this.objectPath(calendar, object.name),
      properties: properties(
        ...this.owned(),
        [DAV, "resourcetype", () => ""],
        [DAV, "getetag", () => xmlText(object.etag)],
        [DAV, "getcontentlength", () => String(object.size)],
        [
          DAV,
          "getcontenttype",
          () => `text/calendar; charset=utf-8; component=${object.component.toLowerCase()}`,
        ],
        ...(withData
          ? [
              [
                CALDAV,
                "calendar-data",
                async () =>
                  xmlText(
                    new TextDecoder().decode(
                      (await this.database.data(calendar.id, object.name)) ?? new Uint8Array(),
                    ),
                  ),
              ] as [string, string, Property["value"]],
            ]
          : []),
      ),
    };
  }

  /** A resource's `<d:response>` with what was asked of it. */
  private async describe(resource: Resource, asked: Asked): Promise<string> {
    const found: string[] = [];
    const missing: string[] = [];
    if (asked.type === "names") {
      for (const { ns, name } of resource.properties.values()) found.push(tag(ns, name));
    } else if (asked.type === "all") {
      for (const { ns, name, value } of resource.properties.values())
        found.push(tag(ns, name, await value()));
    } else {
      for (const { ns, name } of asked.props) {
        const property = resource.properties.get(keyOf(ns, name));
        if (property) found.push(tag(ns, name, await property.value()));
        else missing.push(tag(ns, name));
      }
    }
    return response(
      resource.path,
      new Map([
        [200, found],
        [404, missing],
      ]),
    );
  }

  private xml(): Element | null {
    let text: string;
    try {
      text = utf8.decode(this.body);
    } catch {
      throw new BadRequestError("The body is no UTF-8.");
    }
    return parseXml(text);
  }

  // Methods.

  private async propfind(target: Target | null): Promise<Response> {
    const resource = this.resourceOf(target);
    if (!target || !resource) return new Response(null, { status: 404 });
    const body = this.xml();
    if (body && !(body.ns === DAV && body.name === "propfind"))
      throw new BadRequestError("A PROPFIND's body is a <propfind>.");
    const asked = askedOf(body);
    // Depth infinity (or none) is answered as 1, as SabreDAV does: the tree is two levels deep.
    const depth = this.request.headers.get("depth")?.trim() === "0" ? 0 : 1;
    const resources = [resource];
    if (depth === 1) resources.push(...(await this.members(target)));
    const responses: string[] = [];
    for (const one of resources) responses.push(await this.describe(one, asked));
    return multistatus(responses);
  }

  private resourceOf(target: Target | null): Resource | null {
    switch (target?.kind) {
      case undefined:
        return null;
      case "root":
        return this.collection(this.prefix);
      case "principals":
        return this.collection(`${this.prefix}principals/`);
      case "calendars":
        return this.collection(`${this.prefix}calendars/`);
      case "principal":
        return this.principal();
      case "home":
        return this.home();
      case "calendar":
        return target.calendar && this.calendar(target.calendar);
      case "object":
        return target.calendar && target.object
          ? this.object(target.calendar, target.object, false)
          : null;
    }
  }

  private async members(target: Target): Promise<Resource[]> {
    switch (target.kind) {
      case "root":
        return [
          this.collection(`${this.prefix}principals/`),
          this.collection(`${this.prefix}calendars/`),
        ];
      case "principals":
        return [this.principal()];
      case "calendars":
        return [this.home()];
      case "home":
        return (await this.database.calendars(this.user.id)).map((c) => this.calendar(c));
      case "calendar":
        return target.calendar
          ? (await this.database.objects(target.calendar.id)).map((o) =>
              this.object(target.calendar!, o, false),
            )
          : [];
      default:
        return [];
    }
  }

  private async report(target: Target | null): Promise<Response> {
    if (!target || !this.resourceOf(target)) return new Response(null, { status: 404 });
    const body = this.xml();
    if (!body) throw new BadRequestError("A REPORT has a body.");
    if (target.kind !== "calendar" || !target.calendar)
      return failure(403, DAV, "supported-report");
    const calendar = target.calendar;
    const asked = askedOf(body);
    const key = keyOf(body.ns, body.name);

    if (key === keyOf(CALDAV, "calendar-multiget")) {
      const responses: string[] = [];
      const base = this.calendarPath(calendar.slug);
      for (const one of body.children.filter((c) => c.ns === DAV && c.name === "href")) {
        const path = new URL(one.text.trim(), this.url).pathname;
        let name: string | null = null;
        try {
          const rest = path.startsWith(base) ? decodeURIComponent(path.slice(base.length)) : "";
          name = rest && !rest.includes("/") ? rest : null;
        } catch {
          name = null;
        }
        const object = name === null ? null : await this.database.object(calendar.id, name);
        responses.push(
          object
            ? await this.describe(this.object(calendar, object, true), asked)
            : `<d:response>${href(one.text.trim())}${status(404)}</d:response>`,
        );
      }
      return multistatus(responses);
    }

    if (key === keyOf(CALDAV, "calendar-query")) {
      const filter = filterOf(body);
      const responses: string[] = [];
      for (const object of await this.database.objects(calendar.id)) {
        if (filter.component && object.component !== filter.component) continue;
        if (filter.range) {
          const data = await this.database.data(calendar.id, object.name);
          if (!inRange(new TextDecoder().decode(data ?? new Uint8Array()), filter.range)) continue;
        }
        responses.push(await this.describe(this.object(calendar, object, true), asked));
      }
      return multistatus(responses);
    }

    if (key === keyOf(DAV, "sync-collection")) {
      // RFC 6578: an empty token is a first sync, everything there; another
      // is a change number of this calendar, answered with every name
      // changed after it: there (its properties) or gone (404).
      const token = child(body, DAV, "sync-token")?.text.trim() ?? "";
      let names: string[];
      if (token === "") {
        names = (await this.database.objects(calendar.id)).map((o) => o.name);
      } else {
        const match = SYNC_TOKEN.exec(token);
        if (!match || Number(match[1]) !== calendar.id || Number(match[2]) > calendar.sync)
          return failure(403, DAV, "valid-sync-token");
        names = await this.database.changedSince(calendar.id, Number(match[2]));
      }
      const responses: string[] = [];
      for (const name of names) {
        const object = await this.database.object(calendar.id, name);
        responses.push(
          object
            ? await this.describe(this.object(calendar, object, true), asked)
            : `<d:response>${href(this.objectPath(calendar, name))}${status(404)}</d:response>`,
        );
      }
      return multistatus(
        responses,
        `<d:sync-token>urn:astrotime:sync:${calendar.id}:${calendar.sync}</d:sync-token>`,
      );
    }

    return failure(403, DAV, "supported-report");
  }

  private async get(target: Target | null): Promise<Response> {
    if (target?.kind === "object" && target.calendar && target.object) {
      const data = await this.database.data(target.calendar.id, target.object.name);
      return new Response(
        this.request.method === "HEAD" ? null : (data as Uint8Array<ArrayBuffer>),
        {
          status: 200,
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Length": String(target.object.size),
            ETag: target.object.etag,
          },
        },
      );
    }
    if (this.resourceOf(target))
      return new Response(null, { status: 405, headers: { Allow: ALLOW } });
    return new Response(null, { status: 404 });
  }

  private async put(target: Target | null): Promise<Response> {
    if (target?.kind !== "object" || this.url.pathname.endsWith("/"))
      return new Response(null, { status: target ? 405 : 404, headers: { Allow: ALLOW } });
    // RFC 4918 §9.7.1: no calendar to put it in.
    if (!target.calendar) return new Response(null, { status: 409 });
    const { calendar, name } = target;
    if (preconditionFails(this.request, target.object?.etag ?? null))
      return new Response(null, { status: 412 });
    const type = this.request.headers.get("content-type");
    if (type !== null && !/^\s*text\/calendar\s*(;|$)/i.test(type))
      return failure(403, CALDAV, "supported-calendar-data");

    let parsed: CalendarObject;
    try {
      parsed = CalendarObject.parse(utf8.decode(this.body));
    } catch (error) {
      return failure(
        403,
        CALDAV,
        // No iCalendar at all (the parser's error is its cause), or not one object resource.
        error instanceof CalendarObjectError && error.cause === undefined
          ? "valid-calendar-object-resource"
          : "valid-calendar-data",
      );
    }
    const component: Component = parsed.kind === "event" ? "VEVENT" : "VTODO";
    if (!calendar.components.includes(component))
      return failure(403, CALDAV, "supported-calendar-component");
    // One UID per resource, one resource per UID in a calendar (RFC 4791 §4.1, §5.3.2.1).
    const other = await this.database.objectWithUid(calendar.id, parsed.uid);
    if (other && other.name !== name)
      return failure(403, CALDAV, "no-uid-conflict", href(this.objectPath(calendar, other.name)));

    // Byte for byte, its ETag a hash of them (D280, foundation D7).
    const etag = await this.database.putObject(calendar.id, {
      name,
      uid: parsed.uid,
      component,
      data: this.body,
    });
    return new Response(null, { status: target.object ? 204 : 201, headers: { ETag: etag } });
  }

  private async delete(target: Target | null): Promise<Response> {
    if (target?.kind === "object" && target.calendar && target.object) {
      if (preconditionFails(this.request, target.object.etag))
        return new Response(null, { status: 412 });
      await this.database.removeObject(target.calendar.id, target.object.name);
      return new Response(null, { status: 204 });
    }
    if (target?.kind === "calendar" && target.calendar) {
      await this.database.removeCalendar(target.calendar.id);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: this.resourceOf(target) ? 403 : 404 });
  }

  /** MKCALENDAR (RFC 4791 §5.3.1), and MKCOL of a calendar (RFC 5689). */
  private async mkcalendar(target: Target | null): Promise<Response> {
    if (target?.kind === "object") return failure(403, CALDAV, "calendar-collection-location-ok");
    if (target?.kind !== "calendar") return new Response(null, { status: target ? 405 : 404 });
    if (target.calendar) return new Response(null, { status: 405 });
    const extended = this.request.method === "MKCOL";
    const body = this.xml();
    const root = extended ? keyOf(DAV, "mkcol") : keyOf(CALDAV, "mkcalendar");
    if (body && keyOf(body.ns, body.name) !== root)
      throw new BadRequestError(`The body is a ${root}.`);
    const props = (body?.children ?? [])
      .filter((c) => c.ns === DAV && c.name === "set")
      .flatMap((set) => child(set, DAV, "prop")?.children ?? []);
    const prop = (ns: string, name: string) => props.find((p) => p.ns === ns && p.name === name);

    // A plain collection is nothing the server keeps: only calendars live in a home.
    if (extended && !child(prop(DAV, "resourcetype"), CALDAV, "calendar"))
      return failure(403, DAV, "valid-resourcetype");
    const set = prop(CALDAV, "supported-calendar-component-set");
    const components = set
      ? COMPONENTS.filter((c) =>
          set.children.some((comp) => comp.attributes["name"]?.toUpperCase() === c),
        )
      : COMPONENTS;
    if (components.length === 0) return failure(403, CALDAV, "supported-calendar-component");
    // Other properties (a description, a time zone) are not kept: D280 keeps a name and a colour.
    await this.database.addCalendar(this.user.id, {
      slug: target.slug,
      name: prop(DAV, "displayname")?.text.trim() || target.slug,
      color: prop(APPLE, "calendar-color")?.text.trim() || null,
      components,
    });
    return new Response(null, { status: 201 });
  }

  /** A calendar's name and colour (D280); any other property is refused, and the whole update with it. */
  private async proppatch(target: Target | null): Promise<Response> {
    const resource = this.resourceOf(target);
    if (!target || !resource) return new Response(null, { status: 404 });
    const body = this.xml();
    if (!body || !(body.ns === DAV && body.name === "propertyupdate"))
      throw new BadRequestError("A PROPPATCH's body is a <propertyupdate>.");
    const updates = body.children
      .filter((c) => c.ns === DAV && (c.name === "set" || c.name === "remove"))
      .flatMap((op) =>
        (child(op, DAV, "prop")?.children ?? []).map((prop) => ({
          remove: op.name === "remove",
          prop,
        })),
      );
    const calendar = target.kind === "calendar" ? target.calendar : null;
    const change: { name?: string; color?: string | null } = {};
    const refused: string[] = [];
    const taken: string[] = [];
    for (const { remove, prop } of updates) {
      const key = keyOf(prop.ns, prop.name);
      if (calendar && key === keyOf(DAV, "displayname"))
        change.name = remove ? calendar.slug : prop.text.trim() || calendar.slug;
      else if (calendar && key === keyOf(APPLE, "calendar-color"))
        change.color = remove ? null : prop.text.trim() || null;
      else {
        refused.push(tag(prop.ns, prop.name));
        continue;
      }
      taken.push(tag(prop.ns, prop.name));
    }
    // RFC 4918 §9.2: all or nothing.
    if (refused.length === 0 && calendar) await this.database.renameCalendar(calendar.id, change);
    return multistatus([
      response(
        resource.path,
        refused.length === 0
          ? new Map([[200, taken]])
          : new Map([
              [403, refused],
              [424, taken],
            ]),
      ),
    ]);
  }
}

function askedOf(body: Element | null): Asked {
  if (!body || child(body, DAV, "allprop")) return { type: "all" };
  if (child(body, DAV, "propname")) return { type: "names" };
  const prop = child(body, DAV, "prop");
  return prop
    ? { type: "props", props: prop.children.map(({ ns, name }) => ({ ns, name })) }
    : { type: "all" };
}
