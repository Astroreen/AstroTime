// A multistatus as XML writes it: character references are text, as any
// serializer may escape a CR or a non-ASCII letter (XML 1.0 §4.1).
import { expect, test } from "vite-plus/test";

import { type HttpClient } from "../src/index.ts";
import { CalDavProvider } from "../src/provider.ts";
import { parseMultistatus, text } from "../src/xml.ts";

test("character references are read as the characters they stand for", () => {
  const { responses } = parseMultistatus(
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/cal/a.ics</d:href><d:propstat><d:prop><d:displayname>Caf&#xE9; &amp; co</d:displayname><c:calendar-data>A&#13;\nB&#x41;</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
  );
  expect(text(responses[0]!.props["displayname"])).toBe("Café & co");
  expect(text(responses[0]!.props["calendar-data"])).toBe("A\r\nBA");
});

test("only XML's references are decoded: an HTML entity stays as written, an escaped one is text", () => {
  const { responses } = parseMultistatus(
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/cal/a.ics</d:href><d:propstat><d:prop><d:displayname>a&nbsp;b &amp;nbsp; &amp;#13; &#0; &lt;x&gt; &quot;&apos; &#1;&#x1F;&#xFFFE;&#xD800; a&#9;b</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
  );
  expect(text(responses[0]!.props["displayname"])).toBe(
    `a&nbsp;b &nbsp; &#13; &#0; <x> "' &#1;&#x1F;&#xFFFE;&#xD800; a\tb`,
  );
});

test("a calendar with no name and a stray % in its href is named by its href as written", async () => {
  const body = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/cal/50%/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>/cal/caf%C3%A9/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
  const http: HttpClient = async (request) => ({
    status: 207,
    url: request.url,
    header: () => null,
    body,
  });
  const provider = new CalDavProvider(
    http,
    { username: "u", password: "p" },
    "https://dav.example/cal/",
  );
  expect((await provider.calendars()).map((c) => c.name)).toEqual(["50%", "café"]);
});
