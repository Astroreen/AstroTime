// WebDAV's XML as the server reads and writes it. Unlike the provider's
// parser (`@astrotime/caldav/xml`), which drops namespaces, requests are read
// with theirs: any client picks its own prefixes, and a property the server
// does not know is answered in its own namespace.
import { entityDecoder, escape } from "@astrotime/caldav/xml";
import { XMLParser } from "fast-xml-parser";

export const DAV = "DAV:";
export const CALDAV = "urn:ietf:params:xml:ns:caldav";
export const CALENDARSERVER = "http://calendarserver.org/ns/";
export const APPLE = "http://apple.com/ns/ical/";

/** The prefixes the server writes its own namespaces with. */
const PREFIXES = new Map([
  [DAV, "d"],
  [CALDAV, "c"],
  [CALENDARSERVER, "cs"],
  [APPLE, "ic"],
]);
const DECLARATIONS = [...PREFIXES].map(([ns, prefix]) => `xmlns:${prefix}="${ns}"`).join(" ");

/** An element of a request's body, its name in its namespace. */
export interface Element {
  readonly ns: string;
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly Element[];
  /** Its text, its children's left out. */
  readonly text: string;
}

/** A body the server cannot read. */
export class BadRequestError extends Error {
  override name = "BadRequestError";
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  entityDecoder,
});

type Node = Record<string, unknown>;

/** A request's XML body as its root element; `null` for an empty body. */
export function parseXml(xml: string): Element | null {
  if (!xml.trim()) return null;
  let nodes: Node[];
  try {
    nodes = parser.parse(xml, true) as Node[];
  } catch (error) {
    throw new BadRequestError("The body is no well-formed XML.", { cause: error });
  }
  const root = elements(nodes, new Map())[0];
  if (!root) throw new BadRequestError("The body has no element.");
  return root;
}

function elements(nodes: readonly Node[], scope: ReadonlyMap<string, string>): Element[] {
  const result: Element[] = [];
  for (const node of nodes) {
    const qualified = Object.keys(node).find((key) => key !== ":@");
    if (!qualified || qualified.startsWith("?") || qualified.startsWith("#")) continue;
    const attributes = (node[":@"] ?? {}) as Record<string, string>;
    const inner = new Map(scope);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "xmlns") inner.set("", value);
      else if (key.startsWith("xmlns:")) inner.set(key.slice(6), value);
    }
    const colon = qualified.indexOf(":");
    const prefix = colon < 0 ? "" : qualified.slice(0, colon);
    const content = (node[qualified] ?? []) as Node[];
    result.push({
      ns: inner.get(prefix) ?? "",
      name: colon < 0 ? qualified : qualified.slice(colon + 1),
      attributes,
      children: elements(content, inner),
      text: content
        .map((part) => (typeof part["#text"] === "string" ? part["#text"] : ""))
        .join(""),
    });
  }
  return result;
}

/** The first child of `element` with this name, if any. */
export function child(element: Element | null | undefined, ns: string, name: string) {
  return element?.children.find((c) => c.ns === ns && c.name === name) ?? null;
}

/** A property's key: its namespace and name, `{DAV:}getetag`. */
export const keyOf = (ns: string, name: string) => `{${ns}}${name}`;

/** `<d:name>content</d:name>`, a namespace of the server's own by its prefix, another declared on it. */
export function tag(ns: string, name: string, content = ""): string {
  const prefix = PREFIXES.get(ns);
  const open = prefix
    ? `${prefix}:${name}`
    : `x:${name} xmlns:x="${escape(ns).replaceAll('"', "&quot;")}"`;
  const close = prefix ? `${prefix}:${name}` : `x:${name}`;
  return content ? `<${open}>${content}</${close}>` : `<${open}/>`;
}

/** Text for an XML body: a CR as a reference, which a parser would otherwise drop (XML 1.0 §2.11). */
export const xmlText = (raw: string) => escape(raw).replaceAll("\r", "&#13;");

export const href = (path: string) => `<d:href>${xmlText(path)}</d:href>`;

const REASONS: Record<number, string> = {
  200: "OK",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  424: "Failed Dependency",
  507: "Insufficient Storage",
};
export const status = (code: number) =>
  `<d:status>HTTP/1.1 ${code} ${REASONS[code] ?? ""}</d:status>`;

/** A `<d:response>` with a propstat per status: `{ 200: [props], 404: [props] }`. */
export function response(path: string, propstats: ReadonlyMap<number, readonly string[]>): string {
  const stats = [...propstats]
    .filter(([, props]) => props.length > 0)
    .map(
      ([code, props]) =>
        `<d:propstat><d:prop>${props.join("")}</d:prop>${status(code)}</d:propstat>`,
    );
  // A response names at least one propstat or a status (RFC 4918 §14.24).
  return `<d:response>${href(path)}${stats.length ? stats.join("") : status(200)}</d:response>`;
}

const XML_TYPE = "application/xml; charset=utf-8";

export function multistatus(responses: readonly string[], extra = ""): Response {
  return new Response(
    `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus ${DECLARATIONS}>${responses.join("")}${extra}</d:multistatus>`,
    { status: 207, headers: { "Content-Type": XML_TYPE } },
  );
}

/** A refused precondition (RFC 4918 §16): `<d:error>` naming it. */
export function failure(code: number, ns: string, name: string, content = ""): Response {
  return new Response(
    `<?xml version="1.0" encoding="utf-8"?>\n<d:error ${DECLARATIONS}>${tag(ns, name, content)}</d:error>`,
    { status: code, headers: { "Content-Type": XML_TYPE } },
  );
}
