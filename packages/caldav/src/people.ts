// People for a mention (docs/plans/design.md#D208), a module of its own so
// the web app loads it with the first search (foundation D145).
import type { Person } from "@astrotime/core";

import type { HttpRequest, HttpResponse } from "./http.ts";
import { escape, NAMESPACES, parseMultistatus, text } from "./xml.ts";

/** A search asks for no one on fewer letters, and offers at most this many. */
const PEOPLE_FROM = 2;
const PEOPLE_AT_MOST = 8;

/**
 * RFC 3744's principal search over every principal collection, by name or
 * e-mail (Sabre's `email-address`), as Nextcloud's Calendar asks it for
 * attendees.
 */
function principalSearch(query: string): string {
  const match = escape(query);
  const by = (prop: string) =>
    `<d:property-search><d:prop><${prop}/></d:prop><d:match>${match}</d:match></d:property-search>`;
  return `<?xml version="1.0" encoding="utf-8"?><d:principal-property-search ${NAMESPACES} xmlns:s="http://sabredav.org/ns" test="anyof">${by("d:displayname")}${by("s:email-address")}<d:prop><d:displayname/><s:email-address/><c:calendar-user-address-set/><c:calendar-user-type/></d:prop><d:apply-to-principal-collection-set/></d:principal-property-search>`;
}

/** Every `<href>` of a prop. */
function hrefsOf(value: unknown): string[] {
  const listed =
    value && typeof value === "object" && "href" in value
      ? (value as { href: unknown[] }).href
      : [];
  return listed.flatMap((href) => {
    const found = text(href);
    return found ? [found] : [];
  });
}

/**
 * People the server finds by name or e-mail: RFC 3744's principal search
 * over its principal collections, asked of the calendar home, which names
 * them. Individuals only: a group, a room or a resource is no one to
 * mention. A server that does not search (Radicale answers with nobody;
 * others refuse the report) finds no one.
 */
export async function searchPeople(
  send: (request: HttpRequest, accept: readonly number[]) => Promise<HttpResponse>,
  homeUrl: string,
  query: string,
): Promise<Person[]> {
  const words = query.trim();
  if (words.length < PEOPLE_FROM) return [];
  const response = await send(
    {
      method: "REPORT",
      url: homeUrl,
      headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body: principalSearch(words),
    },
    [400, 403, 404, 405, 415, 501],
  );
  if (response.status !== 207) return [];
  const people = new Map<string, Person>();
  for (const found of parseMultistatus(response.body).responses) {
    const type = text(found.props["calendar-user-type"])?.toUpperCase();
    if (type && type !== "INDIVIDUAL") continue;
    const mailto = hrefsOf(found.props["calendar-user-address-set"]).find((href) =>
      /^mailto:/i.test(href),
    );
    const email = text(found.props["email-address"]) ?? mailto?.replace(/^mailto:/i, "") ?? null;
    const name = text(found.props["displayname"]) ?? email;
    if (!name) continue;
    people.set(email?.toLowerCase() ?? `@${found.href}`, { name, email });
  }
  return [...people.values()].slice(0, PEOPLE_AT_MOST);
}
