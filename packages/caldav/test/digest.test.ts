// HTTP Digest (docs/plans/providers.md#D260): RFC 7616's own example, the
// challenge read from a header beside Basic's, a request answered once the
// server asks, through the web proxy too, and a wrong password refused
// after one try, never a loop.
import { AuthError } from "@astrotime/core";
import { expect, test } from "vite-plus/test";

import { challengesOf, digestChallenge, digestHeader, md5 } from "../src/digest.ts";
import { CHALLENGE } from "../src/proxy.ts";
import {
  inClear,
  Authorization,
  fetchClient,
  proxyHandler,
  send,
  throughProxy,
  type HttpClient,
  type HttpRequest,
  type RememberedScheme,
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
  /** Whether an old nonce is answered with `stale=true` (sabre/dav) or a bare new one (nginx's). */
  let staleSaid = true;
  const sent: string[] = [];
  /** The `nc` of each Digest answer, as it arrived. */
  const counts: number[] = [];
  const fetch = (async (input: URL | string, init: RequestInit) => {
    const url = new URL(String(input));
    const header = new Headers(init.headers).get("authorization") ?? "";
    sent.push(header.split(" ")[0] || "none");
    const challenge = (stale = false) =>
      new Response("", {
        status: 401,
        headers: {
          "WWW-Authenticate": `Digest realm="BaikalDAV", qop="auth", nonce="${nonce}", opaque="o"${stale ? ", stale=true" : ""}`,
        },
      });
    if (!header.startsWith("Digest ")) return challenge();
    const said = (name: string) => new RegExp(`${name}="?([^",]+)`).exec(header)?.[1] ?? "";
    if (said("nonce") !== nonce) return challenge(staleSaid);
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
    renew: (stale = true) => {
      nonce = nonces[1]!;
      staleSaid = stale;
    },
  };
}

const propfind = (url: string): HttpRequest => ({ method: "PROPFIND", url, headers: {} });

test("a server that asks for Digest is answered with it, and stays answered so", async () => {
  const server = digestServer();
  const http = fetchClient({ fetch: server.fetch });
  const auth = new Authorization({ username: "astro", password: "secret" });
  expect((await send(http, auth, propfind("https://dav.example/dav.php/"), [])).status).toBe(207);
  expect((await send(http, auth, propfind("https://dav.example/dav.php/a/"), [])).status).toBe(207);
  // Basic once, then Digest only: the second request needs no challenge.
  expect(server.sent).toEqual(["Basic", "Digest", "Digest"]);
  // A stale nonce is answered again with the new one, not taken as a refusal.
  server.renew();
  expect((await send(http, auth, propfind("https://dav.example/dav.php/"), [])).status).toBe(207);
});

test("requests sent together before the first challenge are each answered with Digest, none refused", async () => {
  const server = digestServer();
  const http = fetchClient({ fetch: server.fetch });
  const auth = new Authorization({ username: "astro", password: "secret" });
  const urls = ["a", "b", "c", "d", "e"].map((name) => `https://dav.example/dav.php/${name}.ics`);
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
  await send(http, auth, propfind("https://dav.example/dav.php/"), []);
  server.renew();
  const urls = ["a", "b", "c"].map((name) => `https://dav.example/dav.php/${name}.ics`);
  const answers = await Promise.all(urls.map((url) => send(http, auth, propfind(url), [])));
  expect(answers.map((answer) => answer.status)).toEqual([207, 207, 207]);
});

test("a wrong password is refused after one Digest try, never in a loop", async () => {
  const server = digestServer();
  const http = fetchClient({ fetch: server.fetch });
  const auth = new Authorization({ username: "astro", password: "wrong" });
  await expect(send(http, auth, propfind("https://dav.example/dav.php/"), [])).rejects.toThrow(
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
  expect((await send(http, auth, propfind("https://dav.example/dav.php/"), [])).status).toBe(207);
  expect(challenges).toEqual([expect.stringMatching(/^Digest realm="BaikalDAV"/)]);
});

test("a challenge's quoted values are read whole: commas, `=` and scheme names in them, several challenges in one header", () => {
  expect(
    challengesOf(
      'Negotiate abc+/==, Basic realm="Digest, or not", charset="UTF-8", Digest realm="a \\"quoted\\" realm, with Basic realm=x", nonce="n=1,2", qop="auth-int, auth", algorithm=MD5',
    ),
  ).toEqual([
    { scheme: "negotiate", params: new Map([["", "abc+/=="]]) },
    {
      scheme: "basic",
      params: new Map([
        ["realm", "Digest, or not"],
        ["charset", "UTF-8"],
      ]),
    },
    {
      scheme: "digest",
      params: new Map([
        ["realm", 'a "quoted" realm, with Basic realm=x'],
        ["nonce", "n=1,2"],
        ["qop", "auth-int, auth"],
        ["algorithm", "MD5"],
      ]),
    },
  ]);
  // "Digest" inside Basic's realm is no Digest challenge.
  expect(digestChallenge('Basic realm="Digest realm=x, nonce=y"')).toBeNull();
  // Of two Digest challenges, the first this client can answer.
  expect(
    digestChallenge(
      'Digest realm="r", nonce="a", algorithm=SHA-512-256, Digest realm="r", nonce="b", algorithm=SHA-256',
    )?.challenge,
  ).toMatchObject({ nonce: "b", algorithm: "SHA-256" });
});

test("a new nonce without `stale` is taken up once before the password is called refused", async () => {
  const server = digestServer();
  const http = fetchClient({ fetch: server.fetch });
  const auth = new Authorization({ username: "astro", password: "secret" });
  await send(http, auth, propfind("https://dav.example/dav.php/"), []);
  // As nginx's Digest does: a 401 with a fresh nonce, no stale=true.
  server.renew(false);
  expect((await send(http, auth, propfind("https://dav.example/dav.php/"), [])).status).toBe(207);
  // The same nonce refused again is the password refused.
  const wrong = new Authorization({ username: "astro", password: "wrong" });
  await expect(send(http, wrong, propfind("https://dav.example/dav.php/"), [])).rejects.toThrow(
    AuthError,
  );
});

test("over plain http to another host, the first request goes without credentials to learn the scheme", async () => {
  const digest = digestServer();
  const auth = new Authorization({ username: "astro", password: "secret" });
  const http = fetchClient({ fetch: digest.fetch });
  expect((await send(http, auth, propfind("http://dav.example/dav.php/"), [])).status).toBe(207);
  // No password in clear: nothing, then Digest.
  expect(digest.sent).toEqual(["none", "Digest"]);

  // A Basic server there gets Basic once it asks, and from then on at once.
  const sent: (string | null)[] = [];
  const basicOnly = fetchClient({
    fetch: (async (_input: URL | string, init: RequestInit) => {
      const header = new Headers(init.headers).get("authorization");
      sent.push(header);
      return header === basic
        ? new Response("ok", { status: 207 })
        : new Response("", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="r"' } });
    }) as typeof fetch,
  });
  const basic = `Basic ${btoa("astro:secret")}`;
  const plain = new Authorization({ username: "astro", password: "secret" });
  expect((await send(basicOnly, plain, propfind("http://dav.example/a/"), [])).status).toBe(207);
  expect((await send(basicOnly, plain, propfind("http://dav.example/b/"), [])).status).toBe(207);
  expect(sent).toEqual([null, basic, basic]);

  // Over https, and to this device, Basic goes at once: one round trip fewer.
  for (const url of ["https://dav.example/", "http://127.0.0.1:5232/", "http://localhost/"]) {
    sent.length = 0;
    const first = new Authorization({ username: "astro", password: "secret" });
    await send(basicOnly, first, propfind(url), []);
    expect(sent).toEqual([basic]);
  }
});

test("what is in clear: plain http to another host, never https or this device, whatever a name starts with", () => {
  for (const url of [
    "http://dav.example.net/",
    "http://192.168.1.5:5232/",
    "http://100.64.0.7/",
    // Names that only look like this device: another host, wherever they resolve.
    "http://127.evil.example.com/",
    "http://127.0.0.1.nip.io/",
    "http://localhost.example.com/",
    "http://[::2]/",
  ])
    expect(inClear(url), url).toBe(true);
  for (const url of [
    "https://dav.example.net/",
    "https://127.evil.example.com/",
    "http://localhost:5232/",
    "http://cal.localhost/",
    "http://127.0.0.1:5232/",
    "http://127.1/",
    "http://127.255.255.254/",
    "http://[::1]:8080/",
  ])
    expect(inClear(url), url).toBe(false);
});

// The scheme an account's server took, kept for its later syncs (D260):
// each test has its own, as each account in a `connectCalDav` has.
const astro = { username: "astro", password: "secret" };

/** A Basic-only server whose password can be changed, answering from `answeredFrom` (a redirect's end). */
function basicServer(answeredFrom?: string) {
  let password = "secret";
  const sent: (string | null)[] = [];
  const http: HttpClient = async (asked) => {
    const header = asked.headers["Authorization"] ?? null;
    sent.push(header?.split(" ")[0] ?? null);
    const ok = header === `Basic ${btoa(`astro:${password}`)}`;
    return {
      status: ok ? 207 : 401,
      url: answeredFrom ?? asked.url,
      header: (name) =>
        name.toLowerCase() === "www-authenticate" && !ok ? 'Basic realm="r"' : null,
      body: "",
    };
  };
  return { http, sent, change: (to: string) => (password = to) };
}

test("a Digest server taken once is answered at once by the next sync, its nonce's count going on", async () => {
  const digest = digestServer();
  const http = fetchClient({ fetch: digest.fetch });
  const schemes: RememberedScheme = {};
  await send(http, new Authorization(astro, schemes), propfind("https://dav.example/dav.php/"), []);
  expect(digest.sent).toEqual(["Basic", "Digest"]);
  digest.sent.length = 0;
  const next = new Authorization(astro, schemes);
  expect((await send(http, next, propfind("https://dav.example/dav.php/a/"), [])).status).toBe(207);
  expect(digest.sent).toEqual(["Digest"]);
  expect(digest.counts).toEqual([1, 2]);
});

test("a recalled Digest whose nonce went meanwhile takes up the new one", async () => {
  const digest = digestServer();
  const http = fetchClient({ fetch: digest.fetch });
  const schemes: RememberedScheme = {};
  await send(http, new Authorization(astro, schemes), propfind("https://dav.example/dav.php/"), []);
  digest.renew();
  digest.sent.length = 0;
  await send(http, new Authorization(astro, schemes), propfind("https://dav.example/dav.php/"), []);
  expect(digest.sent).toEqual(["Digest", "Digest"]);
});

test("a wrong password's scheme is not remembered: only one a server took is", async () => {
  const digest = digestServer();
  const http = fetchClient({ fetch: digest.fetch });
  const schemes: RememberedScheme = {};
  const wrong = new Authorization({ username: "astro", password: "typo" }, schemes);
  await expect(
    send(http, wrong, propfind("https://dav.example/dav.php/"), []),
  ).rejects.toBeInstanceOf(AuthError);
  expect(schemes.scheme).toBeUndefined();
  digest.sent.length = 0;
  await send(http, new Authorization(astro, schemes), propfind("https://dav.example/dav.php/"), []);
  expect(digest.sent).toEqual(["Basic", "Digest"]);
  expect(schemes.scheme).toMatchObject({ nonce: "n1" });
});

test("a recalled scheme refused for the password is the password refused, sent once", async () => {
  // Digest: the recalled challenge refused, no second handshake.
  const digest = digestServer();
  const http = fetchClient({ fetch: digest.fetch });
  const schemes: RememberedScheme = {};
  await send(http, new Authorization(astro, schemes), propfind("https://dav.example/dav.php/"), []);
  digest.sent.length = 0;
  const revoked = new Authorization({ username: "astro", password: "old" }, schemes);
  await expect(
    send(http, revoked, propfind("https://dav.example/dav.php/"), []),
  ).rejects.toBeInstanceOf(AuthError);
  expect(digest.sent).toEqual(["Digest"]);
  // Basic: the same.
  const server = basicServer();
  const basicSchemes: RememberedScheme = {};
  await send(
    server.http,
    new Authorization(astro, basicSchemes),
    propfind("http://basic.example/"),
    [],
  );
  server.change("new");
  server.sent.length = 0;
  await expect(
    send(
      server.http,
      new Authorization(astro, basicSchemes),
      propfind("http://basic.example/"),
      [],
    ),
  ).rejects.toBeInstanceOf(AuthError);
  expect(server.sent).toEqual(["Basic"]);
});

test("a later 401 after the recalled scheme worked is the password refused, not a scheme to learn again", async () => {
  const server = basicServer();
  const schemes: RememberedScheme = {};
  await send(server.http, new Authorization(astro, schemes), propfind("http://basic.example/"), []);
  server.sent.length = 0;
  const next = new Authorization(astro, schemes);
  await send(server.http, next, propfind("http://basic.example/a/"), []);
  server.change("revoked meanwhile");
  await expect(
    send(server.http, next, propfind("http://basic.example/b/"), []),
  ).rejects.toBeInstanceOf(AuthError);
  expect(server.sent).toEqual(["Basic", "Basic"]);
});

test("plain http's Basic recalled: no request without credentials first", async () => {
  const server = basicServer();
  const schemes: RememberedScheme = {};
  await send(server.http, new Authorization(astro, schemes), propfind("http://basic.example/"), []);
  await send(server.http, new Authorization(astro, schemes), propfind("http://basic.example/"), []);
  expect(server.sent).toEqual([null, "Basic", "Basic"]);
});

test("what one account's server took is not another account's, nor an answer from where a redirect went", async () => {
  const digest = digestServer();
  const http = fetchClient({ fetch: digest.fetch });
  const schemes: RememberedScheme = {};
  await send(http, new Authorization(astro, schemes), propfind("https://dav.example/dav.php/"), []);
  digest.sent.length = 0;
  const another: RememberedScheme = {};
  await send(http, new Authorization(astro, another), propfind("https://dav.example/dav.php/"), []);
  expect(digest.sent).toEqual(["Basic", "Digest"]);
  // Taken, but answered from elsewhere: not kept for the address asked.
  const moved = basicServer("http://elsewhere.example/");
  const movedSchemes: RememberedScheme = {};
  await send(
    moved.http,
    new Authorization(astro, movedSchemes),
    propfind("http://basic.example/"),
    [],
  );
  expect(movedSchemes.scheme).toBeUndefined();
});

test("a server set up anew, Basic only where it took Digest: asked again in Basic, once", async () => {
  const digest = digestServer();
  const schemes: RememberedScheme = {};
  await send(
    fetchClient({ fetch: digest.fetch }),
    new Authorization(astro, schemes),
    propfind("https://dav.example/"),
    [],
  );
  const server = basicServer();
  const answer = await send(
    server.http,
    new Authorization(astro, schemes),
    propfind("https://dav.example/"),
    [],
  );
  expect(answer.status).toBe(207);
  expect(server.sent).toEqual(["Digest", "Basic"]);
});

test("a recalled Digest met by a bare 401, or by Basic over plain http, is the password refused: never Basic", async () => {
  for (const [url, challenge] of [
    ["https://dav.example/", null],
    ["http://dav.example/", 'Basic realm="r"'],
  ] as const) {
    const digest = digestServer();
    const schemes: RememberedScheme = {};
    await send(
      fetchClient({ fetch: digest.fetch }),
      new Authorization(astro, schemes),
      propfind(url),
      [],
    );
    expect(schemes.scheme).toMatchObject({ nonce: "n1" });
    // The same server (or someone forging its answers) now answers 401 with no Digest.
    const sent: (string | null)[] = [];
    const forged: HttpClient = async (asked) => {
      sent.push(asked.headers["Authorization"]?.split(" ")[0] ?? null);
      return {
        status: 401,
        url: asked.url,
        header: (name) => (name.toLowerCase() === "www-authenticate" ? challenge : null),
        body: "",
      };
    };
    await expect(
      send(forged, new Authorization(astro, schemes), propfind(url), []),
    ).rejects.toBeInstanceOf(AuthError);
    expect(sent, url).toEqual(["Digest"]);
  }
});

test("a scheme remembered of one origin is not sent to another: that one starts afresh", async () => {
  const server = basicServer();
  const schemes: RememberedScheme = {};
  await send(server.http, new Authorization(astro, schemes), propfind("http://basic.example/"), []);
  expect(schemes).toMatchObject({ scheme: "basic", origin: "http://basic.example" });
  server.sent.length = 0;
  // Plain http elsewhere: no recalled Basic in clear, the scheme asked first.
  await send(server.http, new Authorization(astro, schemes), propfind("http://other.example/"), []);
  expect(server.sent).toEqual([null, "Basic"]);
});

test("a wrong password on a server whose 401 offers Digest and Basic: one Digest, refused, never Basic", async () => {
  const digest = digestServer();
  // Its every 401 names Basic beside Digest, as many servers do.
  const both = (async (input: URL | string, init: RequestInit) => {
    const answer = await digest.fetch(input, init);
    if (answer.status !== 401) return answer;
    const challenge = `${answer.headers.get("WWW-Authenticate")}, Basic realm="r"`;
    return new Response("", { status: 401, headers: { "WWW-Authenticate": challenge } });
  }) as typeof fetch;
  const http = fetchClient({ fetch: both });
  const schemes: RememberedScheme = {};
  await send(http, new Authorization(astro, schemes), propfind("https://dav.example/"), []);
  digest.sent.length = 0;
  const wrong = new Authorization({ username: "astro", password: "typo" }, schemes);
  await expect(send(http, wrong, propfind("https://dav.example/"), [])).rejects.toBeInstanceOf(
    AuthError,
  );
  expect(digest.sent).toEqual(["Digest"]);
  // Not recalled either: Basic first (https), then Digest, refused; no Basic again.
  digest.sent.length = 0;
  const fresh = new Authorization({ username: "astro", password: "typo" }, {});
  await expect(send(http, fresh, propfind("https://dav.example/"), [])).rejects.toBeInstanceOf(
    AuthError,
  );
  expect(digest.sent).toEqual(["Basic", "Digest"]);
});

test("a bearer is never remembered: a renewed token leaves the slot empty, and a password recalling one sends no token", async () => {
  let token = "old";
  let renewed = 0;
  const tokens = {
    token: async () => token,
    renew: async () => {
      renewed += 1;
      token = "new";
      return true;
    },
  };
  const sent: (string | null)[] = [];
  const http: HttpClient = async (asked) => {
    const header = asked.headers["Authorization"] ?? null;
    sent.push(header);
    const ok = header === "Bearer new" || header === `Basic ${btoa("astro:secret")}`;
    return {
      status: ok ? 207 : 401,
      url: asked.url,
      header: (name) =>
        name.toLowerCase() === "www-authenticate" && !ok ? 'Bearer realm="r"' : null,
      body: "",
    };
  };
  const slot: RememberedScheme = {};
  await send(http, new Authorization(tokens, slot), propfind("https://dav.example/"), []);
  expect(sent).toEqual(["Bearer old", "Bearer new"]);
  expect(slot).toEqual({});
  // A slot holding one anyway (belt and braces): a password's account signs with Basic, no token asked.
  sent.length = 0;
  const odd: RememberedScheme = { scheme: "bearer", origin: "https://dav.example" };
  await send(http, new Authorization(astro, odd), propfind("https://dav.example/"), []);
  expect(sent).toEqual([`Basic ${btoa("astro:secret")}`]);
  expect(renewed).toBe(1);
});

test("a Digest-less 401 from where a redirect went, for a request over plain http, sends no Basic", async () => {
  const digest = digestServer();
  const schemes: RememberedScheme = {};
  await send(
    fetchClient({ fetch: digest.fetch }),
    new Authorization(astro, schemes),
    propfind("http://dav.example/"),
    [],
  );
  expect(schemes).toMatchObject({ origin: "http://dav.example", scheme: { nonce: "n1" } });
  const sent: (string | null)[] = [];
  // Asked over http, answered after a redirect from an https address elsewhere: Basic asked, no Digest.
  const redirected: HttpClient = async (asked) => {
    sent.push(asked.headers["Authorization"]?.split(" ")[0] ?? null);
    return {
      status: 401,
      url: "https://elsewhere.example/dav/",
      header: (name) => (name.toLowerCase() === "www-authenticate" ? 'Basic realm="r"' : null),
      body: "",
    };
  };
  await expect(
    send(redirected, new Authorization(astro, schemes), propfind("http://dav.example/"), []),
  ).rejects.toBeInstanceOf(AuthError);
  expect(sent).toEqual(["Digest"]);
  // Over https too: a 401 from another origin is not this server's word.
  const secure: RememberedScheme = {};
  await send(
    fetchClient({ fetch: digest.fetch }),
    new Authorization(astro, secure),
    propfind("https://dav.example/"),
    [],
  );
  sent.length = 0;
  await expect(
    send(redirected, new Authorization(astro, secure), propfind("https://dav.example/"), []),
  ).rejects.toBeInstanceOf(AuthError);
  expect(sent).toEqual(["Digest"]);
});
