// HTTP Digest (docs/plans/providers.md#D260): RFC 7616's own example, the
// challenge read from a header beside Basic's, a request answered once the
// server asks, through the web proxy too, and a wrong password refused
// after one try, never a loop.
import { AuthError } from "@astrotime/core";
import { expect, test } from "vite-plus/test";

import { digestChallenge, digestHeader, md5 } from "../src/digest.ts";
import { CHALLENGE } from "../src/proxy.ts";
import {
  Authorization,
  fetchClient,
  proxyHandler,
  send,
  throughProxy,
  type HttpClient,
  type HttpRequest,
} from "../src/index.ts";

test("MD5 is RFC 1321's", async () => {
  expect(await md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  expect(await md5("The quick brown fox jumps over the lazy dog")).toBe(
    "9e107d9d372bb6826bd81d3542a419d6",
  );
  expect(await md5("a".repeat(1000))).toBe("cabe45dcc9ae5b66ba86600cca6b8ba8");
  expect(await md5("пароль")).toBe("e242f36f4f95f12966da8fa2efd59992");
});

// RFC 7616 §3.9.1: the same request answered with MD5 and with SHA-256.
const RFC = {
  realm: "http-auth@example.org",
  nonce: "7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v",
  opaque: "FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS",
  qop: "auth" as const,
};
const mufasa = { username: "Mufasa", password: "Circle of Life" };
const cnonce = "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ";
const request = { method: "GET", url: "http://www.example.org/dir/index.html" };

test("a Digest answer is RFC 7616's example, with MD5 and with SHA-256", async () => {
  const withMd5 = await digestHeader(
    { ...RFC, algorithm: "MD5", count: 0 },
    mufasa,
    request,
    1,
    cnonce,
  );
  expect(withMd5).toContain('response="8ca523f5e9506fed4657c9700eebdbec"');
  expect(withMd5).toContain("nc=00000001");
  expect(withMd5).toContain('uri="/dir/index.html"');
  expect(withMd5).toContain(`opaque="${RFC.opaque}"`);
  const withSha = await digestHeader(
    { ...RFC, algorithm: "SHA-256", count: 0 },
    mufasa,
    request,
    1,
    cnonce,
  );
  expect(withSha).toContain(
    'response="753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1"',
  );
});

test("the Digest challenge is found among a header's others, with its quoted commas", () => {
  expect(
    digestChallenge(
      'Basic realm="BaikalDAV", Digest realm="Baikal, DAV", qop="auth,auth-int", nonce="abc", opaque="xyz"',
    ),
  ).toEqual({
    challenge: { realm: "Baikal, DAV", nonce: "abc", opaque: "xyz", qop: "auth", algorithm: "MD5" },
    stale: false,
  });
  expect(digestChallenge('Basic realm="x"')).toBeNull();
  expect(digestChallenge(null)).toBeNull();
  // An algorithm this client does not speak, or qop=auth-int alone: no answer it could give.
  expect(digestChallenge('Digest realm="r", nonce="n", algorithm=SHA-512-256')).toBeNull();
  expect(digestChallenge('Digest realm="r", nonce="n", qop="auth-int"')).toBeNull();
  expect(digestChallenge('Digest realm="r", nonce="n", stale=TRUE')?.stale).toBe(true);
});

/** A server that takes Digest only, as sabre/dav's Digest backend does, for `astro:secret`. */
function digestServer() {
  const nonces = ["n1", "n2"];
  let nonce = nonces[0]!;
  const sent: string[] = [];
  /** The `nc` of each Digest answer, as it arrived. */
  const counts: number[] = [];
  const fetch = (async (input: URL | string, init: RequestInit) => {
    const url = new URL(String(input));
    const header = new Headers(init.headers).get("authorization") ?? "";
    sent.push(header.split(" ")[0] ?? "");
    const challenge = (stale = false) =>
      new Response("", {
        status: 401,
        headers: {
          "WWW-Authenticate": `Digest realm="BaikalDAV", qop="auth", nonce="${nonce}", opaque="o"${stale ? ", stale=true" : ""}`,
        },
      });
    if (!header.startsWith("Digest ")) return challenge();
    const said = (name: string) => new RegExp(`${name}="?([^",]+)`).exec(header)?.[1] ?? "";
    if (said("nonce") !== nonce) return challenge(true);
    // The count the client says, which the answer covers; in any order, as sabre/dav takes them.
    const count = Number.parseInt(said("nc"), 16);
    counts.push(count);
    const expected = await digestHeader(
      { realm: "BaikalDAV", nonce, opaque: "o", qop: "auth", algorithm: "MD5", count: 0 },
      { username: "astro", password: "secret" },
      { method: init.method ?? "GET", url: url.href },
      count,
      said("cnonce"),
    );
    const response = /response="([^"]+)"/.exec(expected)?.[1];
    return said("response") === response ? new Response("ok", { status: 207 }) : challenge();
  }) as typeof globalThis.fetch;
  return {
    fetch,
    sent,
    counts,
    renew: () => {
      nonce = nonces[1]!;
    },
  };
}

const propfind = (url: string): HttpRequest => ({ method: "PROPFIND", url, headers: {} });

test("a server that asks for Digest is answered with it, and stays answered so", async () => {
  const server = digestServer();
  const http = fetchClient({ fetch: server.fetch });
  const auth = new Authorization({ username: "astro", password: "secret" });
  expect((await send(http, auth, propfind("http://dav.example/dav.php/"), [])).status).toBe(207);
  expect((await send(http, auth, propfind("http://dav.example/dav.php/a/"), [])).status).toBe(207);
  // Basic once, then Digest only: the second request needs no challenge.
  expect(server.sent).toEqual(["Basic", "Digest", "Digest"]);
  // A stale nonce is answered again with the new one, not taken as a refusal.
  server.renew();
  expect((await send(http, auth, propfind("http://dav.example/dav.php/"), [])).status).toBe(207);
});

test("requests sent together before the first challenge are each answered with Digest, none refused", async () => {
  const server = digestServer();
  const http = fetchClient({ fetch: server.fetch });
  const auth = new Authorization({ username: "astro", password: "secret" });
  const urls = ["a", "b", "c", "d", "e"].map((name) => `http://dav.example/dav.php/${name}.ics`);
  // All five go with Basic before any 401 comes back: the later 401s meet a
  // challenge already taken up, not a refusal of it.
  const answers = await Promise.all(urls.map((url) => send(http, auth, propfind(url), [])));
  expect(answers.map((answer) => answer.status)).toEqual([207, 207, 207, 207, 207]);
  expect(server.sent.filter((scheme) => scheme === "Basic")).toHaveLength(5);
  expect(server.sent.filter((scheme) => scheme === "Digest")).toHaveLength(5);
  // Each answer used the nonce once: no count twice, whatever order they arrived in.
  expect(server.counts.toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  // Signed together on a known challenge, they count on.
  await Promise.all(urls.map((url) => send(http, auth, propfind(url), [])));
  expect(server.counts.slice(5).toSorted((a, b) => a - b)).toEqual([6, 7, 8, 9, 10]);
});

test("a stale nonce met by requests in flight together is taken up once and each sent again", async () => {
  const server = digestServer();
  const http = fetchClient({ fetch: server.fetch });
  const auth = new Authorization({ username: "astro", password: "secret" });
  await send(http, auth, propfind("http://dav.example/dav.php/"), []);
  server.renew();
  const urls = ["a", "b", "c"].map((name) => `http://dav.example/dav.php/${name}.ics`);
  const answers = await Promise.all(urls.map((url) => send(http, auth, propfind(url), [])));
  expect(answers.map((answer) => answer.status)).toEqual([207, 207, 207]);
});

test("a wrong password is refused after one Digest try, never in a loop", async () => {
  const server = digestServer();
  const http = fetchClient({ fetch: server.fetch });
  const auth = new Authorization({ username: "astro", password: "wrong" });
  await expect(send(http, auth, propfind("http://dav.example/dav.php/"), [])).rejects.toThrow(
    AuthError,
  );
  expect(server.sent).toEqual(["Basic", "Digest"]);
});

test("through the web proxy the challenge arrives under its own name, and Digest works", async () => {
  const server = digestServer();
  const handler = proxyHandler({ prefix: "/dav-proxy/", allow: "*", fetch: server.fetch });
  const challenges: string[] = [];
  const http: HttpClient = fetchClient({
    fetch: (async (input: URL | string, init: RequestInit) => {
      const answer = await handler(
        new Request(new URL(String(input), "http://app.localhost"), init),
      );
      // The browser never sees a WWW-Authenticate, so it never asks itself;
      // the server's challenge comes under the proxy's own name.
      expect(answer.headers.get("www-authenticate")).toBeNull();
      const challenge = answer.headers.get(CHALLENGE);
      if (challenge !== null) challenges.push(challenge);
      return answer;
    }) as typeof fetch,
    via: throughProxy("/dav-proxy/"),
  });
  const auth = new Authorization({ username: "astro", password: "secret" });
  expect((await send(http, auth, propfind("http://dav.example/dav.php/"), [])).status).toBe(207);
  expect(challenges).toEqual([expect.stringMatching(/^Digest realm="BaikalDAV"/)]);
});
