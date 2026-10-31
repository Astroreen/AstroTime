import { XMLParser } from "fast-xml-parser";

// WebDAV's XML, as much of it as CalDAV needs. Namespaces are dropped on
// parsing: the names CalDAV uses do not collide across DAV:, CalDAV,
// CalendarServer and Apple's namespace.

const NAMESPACES =
  'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/" xmlns:nc="http://nextcloud.com/ns"';

export function propfind(props: readonly string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NAMESPACES}><d:prop>${props.map((p) => `<${p}/>`).join("")}</d:prop></d:propfind>`;
}

export function syncCollection(syncToken: string, props: readonly string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?><d:sync-collection ${NAMESPACES}><d:sync-token>${escape(syncToken)}</d:sync-token><d:sync-level>1</d:sync-level><d:prop>${props.map((p) => `<${p}/>`).join("")}</d:prop></d:sync-collection>`;
}

export function multiget(hrefs: readonly string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?><c:calendar-multiget ${NAMESPACES}><d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefs.map((h) => `<d:href>${escape(h)}</d:href>`).join("")}</c:calendar-multiget>`;
}

function escape(raw: string): string {
  return raw.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** One `<response>` of a multistatus: its href, and the props that came with a 2xx status. */
export interface DavResponse {
  readonly href: string;
  /** The response's own status (sync-collection reports removals as 404 here). */
  readonly status: number | null;
  readonly props: Record<string, unknown>;
}

export interface Multistatus {
  readonly responses: readonly DavResponse[];
  /** sync-collection's new token. */
  readonly syncToken: string | null;
}

const parser = new XMLParser({
  // Attributes are kept for <comp name="VEVENT"/>, as `@_name`.
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => ["response", "propstat", "href", "comp", "privilege"].includes(name),
});

function statusCode(line: unknown): number | null {
  const match = typeof line === "string" ? /\s(\d{3})\s/.exec(`${line} `) : null;
  return match ? Number(match[1]) : null;
}

export function parseMultistatus(xml: string): Multistatus {
  const document = parser.parse(xml) as { multistatus?: Record<string, unknown> };
  const root = document.multistatus ?? {};
  const responses = ((root["response"] as Record<string, unknown>[] | undefined) ?? []).map(
    (response) => {
      const props: Record<string, unknown> = {};
      for (const propstat of (response["propstat"] as Record<string, unknown>[] | undefined) ??
        []) {
        const code = statusCode(propstat["status"]);
        if (code !== null && code >= 200 && code < 300)
          Object.assign(props, propstat["prop"] ?? {});
      }
      const [href = ""] = (response["href"] as string[] | undefined) ?? [];
      return { href: href.trim(), status: statusCode(response["status"]), props };
    },
  );
  const token = root["sync-token"];
  return { responses, syncToken: typeof token === "string" ? token.trim() : null };
}

/** The text of a prop, or of its first `<href>`. */
export function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && "href" in value) {
    const [href] = (value as { href: string[] }).href;
    return href?.trim() ?? null;
  }
  if (value && typeof value === "object" && "#text" in value)
    return text((value as { "#text": unknown })["#text"]);
  return null;
}

/** The names of the child elements of a prop: `<resourcetype><collection/><calendar/></resourcetype>`. */
export function children(value: unknown): string[] {
  return value && typeof value === "object"
    ? Object.keys(value).filter((key) => !key.startsWith("@_"))
    : [];
}

/** An attribute of an element (kept as `@_name` by the parser). */
export function attribute(value: unknown, name: string): string | null {
  const v =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)[`@_${name}`]
      : undefined;
  return typeof v === "string" ? v : null;
}
