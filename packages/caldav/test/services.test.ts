// Every recorded service replayed (docs/plans/providers.md#D249): the
// scenario the recording was made with runs against it, asks exactly what
// was asked, signed as it was (a Digest answer checked against the
// recorded challenge), nothing more, and finds what the service answered
// then. And the guard that keeps an account's values out of every file.
import { readdirSync, readFileSync } from "node:fs";

import { beforeEach, expect, test } from "vite-plus/test";

import { digestChallenge, digestHeader } from "../src/digest.ts";
import { forgetSchemes } from "../src/auth.ts";
import { HttpError, type HttpRequest, type HttpResponse } from "../src/index.ts";
import {
  digestParam,
  leaks,
  redacted,
  replay,
  standInsFor,
  type Account,
  type Recording,
} from "./recording.ts";
import { scenario } from "./scenario.ts";

// Each test a run of its own: no scheme learned by another (D260).
beforeEach(forgetSchemes);

const folder = new URL("./fixtures/services/", import.meta.url);
const recordings = readdirSync(folder)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(new URL(file, folder), "utf8")) as Recording);
const credentials = { username: "user", password: "recorded" };

test.each(recordings.map((recording) => [recording.service, recording] as const))(
  "the recording of %s replays: discovery, a calendar made, items found, changed and deleted",
  async (_service, recording) => {
    const http = replay(recording, credentials);
    const tasks = recording.exchanges.some((exchange) =>
      exchange.request.body?.includes("BEGIN:VTODO"),
    );
    const result = await scenario(http, recording.server, credentials, {
      tasks,
      calendar: recording.calendar,
    });
    expect(result.found).toEqual(tasks ? ["Recorded event", "Recorded task"] : ["Recorded event"]);
    expect(result.changed).toEqual(["Recorded event changed"]);
    expect(result.removed).toBe(true);
    // Nothing recorded was left unasked.
    expect(http.left()).toBe(0);
  },
);

test("Baïkal's recording is answered with Digest, and a Digest answer made with another password is refused", async () => {
  const baikal = recordings.find((recording) => recording.service === "baikal-digest")!;
  expect(baikal.exchanges.filter((e) => e.request.scheme === "Digest").length).toBeGreaterThan(5);
  // The recording's first challenge, and the request that answered it.
  const challenged = baikal.exchanges.findIndex((e) => e.response.status === 401);
  const [first, answered] = [baikal.exchanges[challenged]!, baikal.exchanges[challenged + 1]!];
  expect(answered.request.scheme).toBe("Digest");
  const challenge = digestChallenge(first.response.headers["www-authenticate"]!)!.challenge;
  const asRecorded = (exchange: (typeof baikal.exchanges)[number], authorization?: string) => ({
    method: exchange.request.method,
    url: `${exchange.request.origin}${exchange.request.path}`,
    headers: {
      ...exchange.request.headers,
      ...(exchange.request.depth === null ? {} : { Depth: exchange.request.depth }),
      ...(authorization === undefined ? {} : { Authorization: authorization }),
    },
    ...(exchange.request.body === null ? {} : { body: exchange.request.body }),
  });
  const before = baikal.exchanges.slice(0, challenged + 1);
  const signed = async (password: string) => {
    const request = asRecorded(answered);
    const header = await digestHeader(
      { ...challenge, count: 0 },
      { username: credentials.username, password },
      request,
      1,
    );
    return asRecorded(answered, header);
  };
  const upTo = async (http: ReturnType<typeof replay>) => {
    for (const exchange of before)
      await http(
        asRecorded(
          exchange,
          exchange.request.scheme === "Basic" ? "Basic dXNlcjpyZWNvcmRlZA==" : undefined,
        ),
      );
  };
  // Answered right, the replay goes on; tampered (another password), it
  // refuses, as Baïkal would: without checkDigest this replay would pass.
  const right = replay(baikal, credentials);
  await upTo(right);
  expect((await right(await signed(credentials.password))).status).toBe(answered.response.status);
  const tampered = replay(baikal, credentials);
  await upTo(tampered);
  await expect(tampered(await signed("another password"))).rejects.toThrow(/would refuse/);
});

const one = (
  body: string,
  scheme: "Basic" | "Digest" | null = null,
  origin = "https://dav.example",
): Recording => ({
  service: "example",
  recorded: "2026-11-04",
  server: "https://dav.example/",
  calendar: "astrotime-recording-x",
  exchanges: [
    {
      request: { origin, method: "GET", path: "/a", depth: null, scheme, headers: {}, body: null },
      response: {
        status: 200,
        url: `${origin}/a`,
        headers: { "www-authenticate": 'Digest realm="r", nonce="n", qop="auth"' },
        body,
      },
    },
  ],
});

test("a replay fails on a request it does not hold, signed otherwise, past its end, or with a Digest answer the server would refuse", async () => {
  const http = replay(one("ok"), credentials);
  await expect(http({ method: "GET", url: "https://dav.example/b", headers: {} })).rejects.toThrow(
    /Request 1 is not the recording's/,
  );
  await expect(
    http({ method: "GET", url: "https://dav.example/a", headers: { Authorization: "Basic eA==" } }),
  ).rejects.toThrow(/not the recording's/);
  expect((await http({ method: "GET", url: "https://dav.example/a", headers: {} })).body).toBe(
    "ok",
  );
  await expect(
    http({ method: "GET", url: "https://dav.example/a", headers: {} }),
  ).rejects.toThrow();

  // A Digest answer: right for the recorded challenge passes, a wrong password does not.
  const challenged: Recording = {
    ...one("challenge"),
    exchanges: [...one("challenge").exchanges, ...one("ok", "Digest").exchanges],
  };
  const challenge = {
    realm: "r",
    nonce: "n",
    opaque: null,
    qop: "auth" as const,
    algorithm: "MD5" as const,
    count: 0,
  };
  const request = { method: "GET", url: "https://dav.example/a", headers: {} };
  const signed = async (password: string) => ({
    ...request,
    headers: {
      Authorization: await digestHeader(challenge, { username: "user", password }, request, 1),
    },
  });
  const good = replay(challenged, credentials);
  await good(request);
  expect((await good(await signed("recorded"))).body).toBe("ok");
  const bad = replay(challenged, credentials);
  await bad(request);
  await expect(bad(await signed("wrong"))).rejects.toThrow(/would refuse/);
});

const account: Account = {
  username: "jane.doe@corp-example.org",
  password: "s3cret-P@ss",
  extra: ["1234567890"],
  sent: [
    'Digest username="jane", response="0a1b2c3d4e5f60718293a4b5c6d7e8f9", cnonce="QmFzZTY0Y25vbmNl"',
  ],
};

test("the guard finds an account's values in every spelling, whatever the scrubbing missed", () => {
  const base64 = (text: string) => btoa(text);
  const spellings = {
    raw: "jane.doe@corp-example.org",
    "upper case": "JANE.DOE@CORP-EXAMPLE.ORG",
    "URL-encoded": "jane.doe%40corp-example.org",
    "URL-encoded, lower hex": "jane.doe%40corp-example.org".toLowerCase(),
    "the password": "S3CRET-p@SS",
    "the e-mail's local part": "Jane.Doe",
    "the e-mail's own domain": "corp-example.org",
    "an id in a path": "/1234567890/calendars/",
    "Basic's base64": base64("jane.doe@corp-example.org:s3cret-P@ss"),
    "the password's base64": base64("s3cret-P@ss"),
    "a Digest response": "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
    "a Digest cnonce": "QmFzZTY0Y25vbmNl",
    "inside a word": "xxjane.doexx",
  };
  for (const [kind, text] of Object.entries(spellings))
    expect(leaks(`{"body":"${text}"}`, account), kind).not.toEqual([]);
  // A password with characters JSON and XML escape: found as each writes it.
  const quoted: Account = { ...account, password: 'pa"ss&<word>' };
  expect(leaks(JSON.stringify({ body: 'pa"ss&<word>' }), quoted)).not.toEqual([]);
  expect(leaks("<d:x>pa&quot;ss&amp;&lt;word&gt;</d:x>", quoted)).not.toEqual([]);
  expect(leaks(encodeURIComponent('pa"ss&<word>'), quoted)).not.toEqual([]);
  // A public mail domain alone says nothing; nor a local part under five letters.
  expect(leaks("icloud.com", { ...account, username: "ab@icloud.com" })).toEqual([]);
  expect(leaks("nothing of the account here", account)).toEqual([]);
});

test("a recording is written only once nothing of the account is left in it", () => {
  const recording = one("jane.doe@corp-example.org owns /1234567890/");
  const standIns = new Map([
    ["jane.doe@corp-example.org", "user@example.com"],
    ["1234567890", "account-1"],
  ]);
  expect(redacted(recording, standIns, account).exchanges[0]!.response.body).toBe(
    "user@example.com owns /account-1/",
  );
  // What the stand-ins miss (the name in another case) refuses the file.
  expect(() => redacted(one("Jane.Doe@Corp-Example.org"), standIns, account)).toThrow(
    /not written/,
  );
  // A local test server's public user name may stay; its password may not.
  const local: Account = {
    username: "astro",
    password: "secret",
    extra: [],
    sent: [],
    publicUsername: true,
  };
  expect(redacted(one("AstroTime astro"), new Map(), local).exchanges[0]!.response.body).toBe(
    "AstroTime astro",
  );
  expect(() => redacted(one("the secret"), new Map(), local)).toThrow(/not written/);
});

test("a replay keeps each request's server and the headers that change what it does", async () => {
  // iCloud answers a home on another of its servers: each request on its own.
  const twoServers: Recording = {
    ...one("first"),
    exchanges: [
      ...one("first").exchanges,
      ...one("second", null, "https://p42-dav.example").exchanges,
    ],
  };
  const http = replay(twoServers, credentials);
  expect((await http({ method: "GET", url: "https://dav.example/a", headers: {} })).body).toBe(
    "first",
  );
  await expect(http({ method: "GET", url: "https://dav.example/a", headers: {} })).rejects.toThrow(
    /not the recording's/,
  );
  // An If-Match, Content-Type or Prefer the recording did not send is another request.
  for (const header of ["If-Match", "If-None-Match", "Content-Type", "Prefer"]) {
    const strict = replay(one("x"), credentials);
    await expect(
      strict({ method: "GET", url: "https://dav.example/a", headers: { [header]: "*" } }),
    ).rejects.toThrow(/not the recording's/);
  }
});

test("a Digest parameter is read whole: `nonce` is never `cnonce`'s, a quoted comma stays", () => {
  const answer = 'Digest username="u", realm="a, b", cnonce="CN", nonce="N", nc=00000001';
  expect(digestParam(answer, "nonce")).toBe("N");
  expect(digestParam(answer, "cnonce")).toBe("CN");
  expect(digestParam(answer, "realm")).toBe("a, b");
  expect(digestParam(answer, "opaque")).toBeNull();
});

test("values are put out as they are, quotes, backslashes, line breaks and non-ASCII, never a key", () => {
  const tricky = 'id"with\\back\nline';
  const recording = one(`owner ${tricky} and Пользователь-Иванов`);
  const standIns = new Map([
    [tricky, "account-1"],
    ["Пользователь-Иванов", "user"],
  ]);
  const local: Account = {
    username: "nobody-here",
    password: "pw-not-in-file",
    extra: [tricky, "Пользователь-Иванов"],
    sent: [],
  };
  const result = redacted(recording, standIns, local);
  expect(result.exchanges[0]!.response.body).toBe("owner account-1 and user");
  // The keys are the file's own: a value named like one does not touch them.
  expect(Object.keys(result.exchanges[0]!.response)).toEqual(["status", "url", "headers", "body"]);
  expect(
    redacted(one("body"), new Map([["body", "stand-in"]]), { ...local, extra: [] }).exchanges[0]!
      .response.body,
  ).toBe("stand-in");
});

test("ids are found in every address a recording holds: hrefs of owners and shares, other users' e-mails", () => {
  const exchanges = one(
    "<d:multistatus><d:response><d:href>/123456789/calendars/home/</d:href>" +
      "<cs:calendar-owner><d:href>/principals/jane.doe/</d:href></cs:calendar-owner>" +
      "<c:calendar-user-address-set><d:href>mailto:Jane.Doe@corp-example.org</d:href>" +
      "<d:href>mailto:colleague@corp-example.org</d:href></c:calendar-user-address-set>" +
      "<d:href>/shared/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7/</d:href></d:response></d:multistatus>",
  ).exchanges;
  const standIns = standInsFor(exchanges, { username: "jane.doe@corp-example.org", extra: [] });
  expect(standIns.get("123456789")).toMatch(/^account-/);
  expect(standIns.get("jane.doe")).toBe("user");
  expect(standIns.get("0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7")).toMatch(/^account-/);
  expect(standIns.get("colleague@corp-example.org")).toMatch(/^person-\d+@example\.com$/);
  // The calendar's own name, and words of the protocol, stay.
  expect(standIns.has("calendars")).toBe(false);
  expect(standIns.has("principals")).toBe(false);
});

test("a scenario that fails, and whose cleanup fails too, shows its own failure first", async () => {
  const multistatus = (props: string) =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/x/</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
  const http = async (request: HttpRequest): Promise<HttpResponse> => {
    const answer = (status: number, body = "") => ({
      status,
      url: request.url,
      header: (name: string) => (name === "content-type" ? "application/xml" : null),
      body,
    });
    if (request.method === "PROPFIND" && request.headers["Depth"] === "1")
      return answer(207, '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"/>');
    if (request.method === "PROPFIND")
      return answer(
        207,
        multistatus(
          "<d:current-user-principal><d:href>/p/</d:href></d:current-user-principal><c:calendar-home-set><d:href>/home/</d:href></c:calendar-home-set>",
        ),
      );
    if (request.method === "MKCALENDAR") return answer(201);
    // The body's step fails, and so does every cleanup.
    return answer(500);
  };
  const failure = scenario(http, "https://dav.example/", credentials, {
    tasks: false,
    calendar: "astrotime-recording-test",
  });
  const error = await failure.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors[0]).toBeInstanceOf(HttpError);
  expect(String((error as AggregateError).errors[0])).toMatch(/PUT .*answered 500/);
});
