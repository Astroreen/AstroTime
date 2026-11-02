// People for a mention, from the principal search real servers answer
// (docs/plans/design.md#D208); the files and where they come from:
// fixtures/README.md.
import { readFileSync } from "node:fs";

import { expect, test } from "vite-plus/test";

import { CalDavProvider, type HttpClient, type HttpRequest } from "../src/index.ts";

const HOME = "https://cloud.example.com/remote.php/dav/calendars/astrotime-test/";

/** A provider whose server answers `body` (or `status`) to every request, and the requests it got. */
function answering(body: string, status = 207) {
  const asked: HttpRequest[] = [];
  const http: HttpClient = async (request) => {
    asked.push(request);
    return { status, url: request.url, header: () => null, body };
  };
  return { provider: new CalDavProvider(http, { username: "u", password: "p" }, HOME), asked };
}

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("Nextcloud: one REPORT to the calendar home searches every principal collection by name or e-mail", async () => {
  const { provider, asked } = answering(fixture("nextcloud-principal-search.xml"));
  expect(await provider.people("astrotime")).toEqual([{ name: "AstroTime test", email: null }]);
  expect(asked).toHaveLength(1);
  const [request] = asked;
  expect(request).toMatchObject({ method: "REPORT", url: HOME, headers: { Depth: "0" } });
  expect(request!.body).toContain("<d:apply-to-principal-collection-set/>");
  expect(request!.body).toContain(
    "<d:property-search><d:prop><d:displayname/></d:prop><d:match>astrotime</d:match></d:property-search>",
  );
  expect(request!.body).toContain(
    "<d:property-search><d:prop><s:email-address/></d:prop><d:match>astrotime</d:match></d:property-search>",
  );
});

test("Nextcloud: people with their e-mail, from Sabre's email-address or a mailto address; no group or room", async () => {
  const { provider } = answering(fixture("nextcloud-principal-search-people.xml"));
  expect(await provider.people("ann")).toEqual([
    { name: "Anna Berg", email: "anna@example.com" },
    { name: "Annika Lind", email: "annika@example.com" },
  ]);
});

test("Radicale answers its principal search with nobody", async () => {
  const { provider } = answering(fixture("radicale-principal-search.xml"));
  expect(await provider.people("astro")).toEqual([]);
});

test("a server that refuses the report finds no one; a query under two letters asks nothing", async () => {
  for (const status of [403, 405, 501]) {
    const { provider } = answering("", status);
    expect(await provider.people("anna")).toEqual([]);
  }
  const { provider, asked } = answering(fixture("nextcloud-principal-search-people.xml"));
  expect(await provider.people(" a ")).toEqual([]);
  expect(asked).toHaveLength(0);
});

test("the query is XML-escaped, never markup", async () => {
  const { provider, asked } = answering(fixture("radicale-principal-search.xml"));
  await provider.people("</d:match><x>&");
  expect(asked[0]!.body).toContain("<d:match>&lt;/d:match&gt;&lt;x&gt;&amp;</d:match>");
});
