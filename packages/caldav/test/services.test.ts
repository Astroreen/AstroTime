// Every recorded service replayed (docs/plans/providers.md#D249): the
// scenario the recording was made with runs against it, asks exactly what
// was asked, signed as it was (a Digest answer checked against the
// recorded challenge), nothing more, and finds what the service answered
// then. And the guard that keeps an account's values out of every file.
import { readdirSync, readFileSync } from "node:fs";

import { expect, test } from "vite-plus/test";

import { digestHeader } from "../src/digest.ts";
import { leaks, redacted, replay, type Account, type Recording } from "./recording.ts";
import { scenario } from "./scenario.ts";

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

test("Baïkal's recording is answered with Digest, each answer checked against its challenge", () => {
  const baikal = recordings.find((recording) => recording.service === "baikal-digest")!;
  expect(baikal.exchanges.filter((e) => e.request.scheme === "Digest").length).toBeGreaterThan(5);
});

const one = (body: string, scheme: "Basic" | "Digest" | null = null): Recording => ({
  service: "example",
  recorded: "2026-11-04",
  origin: "https://dav.example",
  server: "https://dav.example/",
  calendar: "astrotime-recording-x",
  exchanges: [
    {
      request: { method: "GET", path: "/a", depth: null, scheme, body: null },
      response: {
        status: 200,
        path: "/a",
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
