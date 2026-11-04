// OAuth 2 with PKCE (docs/plans/providers.md#D254) against a fake
// authorization server that checks what a real one checks: the verifier
// against the challenge, the redirect URI, the client, a refresh token that
// was revoked; and the CalDAV provider signing with the bearer token,
// renewing it once when a server refuses it.
import { createHash } from "node:crypto";

import { Authorization, send, type HttpClient, type HttpRequest } from "@astrotime/caldav";
import { AuthError, OfflineError } from "@astrotime/core";
import { expect, test } from "vite-plus/test";

import {
  authorization,
  challengeOf,
  codeOf,
  exchange,
  GOOGLE,
  OAuthRefusedError,
  TokenNotKeptError,
  tokenSource,
  type OAuthClient,
  type Tokens,
} from "../src/index.ts";

const client: OAuthClient = {
  authorizationEndpoint: "https://auth.example/authorize",
  tokenEndpoint: "https://auth.example/token",
  clientId: "astrotime-test",
  scopes: ["calendar", "tasks"],
  extra: { access_type: "offline" },
};
const REDIRECT = "io.github.astroreen.astrotime:/oauth";

/** An authorization server as RFC 6749 and 7636 describe it, in memory. */
function authServer() {
  const codes = new Map<string, { challenge: string; redirect: string }>();
  const refreshTokens = new Set<string>();
  let issued = 0;
  let rotate = false;
  const json = (status: number, body: unknown) => ({
    status,
    url: client.tokenEndpoint,
    header: (name: string) => (name === "content-type" ? "application/json" : null),
    body: JSON.stringify(body),
  });
  const tokens = () => {
    issued += 1;
    const refresh = `refresh-${issued}`;
    refreshTokens.add(refresh);
    return {
      access_token: `access-${issued}`,
      expires_in: 3600,
      refresh_token: refresh,
      token_type: "Bearer",
    };
  };
  const http: HttpClient = async (request: HttpRequest) => {
    const form = new URLSearchParams(String(request.body));
    if (form.get("client_id") !== client.clientId) return json(401, { error: "invalid_client" });
    if (form.get("grant_type") === "authorization_code") {
      const code = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      if (!code) return json(400, { error: "invalid_grant" });
      const verifier = form.get("code_verifier") ?? "";
      const s256 = createHash("sha256").update(verifier).digest("base64url");
      if (s256 !== code.challenge || form.get("redirect_uri") !== code.redirect)
        return json(400, { error: "invalid_grant" });
      return json(200, tokens());
    }
    if (form.get("grant_type") === "refresh_token") {
      const refresh = form.get("refresh_token") ?? "";
      if (!refreshTokens.has(refresh)) return json(400, { error: "invalid_grant" });
      const next = tokens();
      // Microsoft hands a new refresh token with each renewal; Google keeps the first.
      if (rotate) refreshTokens.delete(refresh);
      return json(200, rotate ? next : { ...next, refresh_token: undefined });
    }
    return json(400, { error: "unsupported_grant_type" });
  };
  return {
    http,
    /** The user approves on the service's page: a code for this challenge, back at the redirect. */
    approve(url: string) {
      const asked = new URL(url).searchParams;
      const code = `code-${codes.size + 1}`;
      codes.set(code, {
        challenge: asked.get("code_challenge")!,
        redirect: asked.get("redirect_uri")!,
      });
      return `${asked.get("redirect_uri")}?code=${code}&state=${asked.get("state")}`;
    },
    revoke: () => refreshTokens.clear(),
    rotating: () => (rotate = true),
  };
}

test("S256 is the verifier's SHA-256 in base64url, as RFC 7636 §4.2 asks", async () => {
  for (const verifier of ["dBjftJeZ4CVP-mJ92K9DAZ5EKjd0QL8E5gtTG3C74Hk", "a".repeat(128)])
    expect(await challengeOf(verifier)).toBe(
      createHash("sha256").update(verifier).digest("base64url"),
    );
});

test("a sign-in: the URL with the challenge and state, the approval read back, the code exchanged with its verifier", async () => {
  const server = authServer();
  const { url, pending } = await authorization(client, REDIRECT);
  const asked = new URL(url).searchParams;
  expect(Object.fromEntries(asked)).toMatchObject({
    response_type: "code",
    client_id: "astrotime-test",
    redirect_uri: REDIRECT,
    scope: "calendar tasks",
    code_challenge_method: "S256",
    access_type: "offline",
  });
  expect(pending.verifier).toHaveLength(43);
  expect(asked.get("code_challenge")).toBe(await challengeOf(pending.verifier));
  const redirect = server.approve(url);
  const tokens = await exchange(server.http, client, codeOf(redirect, pending), pending, 1_000);
  expect(tokens).toEqual({
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: 3_601_000,
  });
  // A code is good once: a used one is this sign-in refused, not an account signed out.
  const used = exchange(server.http, client, codeOf(redirect, pending), pending);
  await expect(used).rejects.toThrow(OAuthRefusedError);
  await expect(used).rejects.not.toThrow(AuthError);
});

test("a redirect of another sign-in, a refusal, or a wrong verifier gives no tokens", async () => {
  const server = authServer();
  const { url, pending } = await authorization(client, REDIRECT);
  const other = await authorization(client, REDIRECT);
  expect(() => codeOf(server.approve(other.url), pending)).toThrow(/state_mismatch/);
  expect(() => codeOf(`${REDIRECT}?error=access_denied&state=${pending.state}`, pending)).toThrow(
    OAuthRefusedError,
  );
  const code = codeOf(server.approve(url), pending);
  await expect(
    exchange(server.http, client, code, { ...pending, verifier: other.pending.verifier }),
  ).rejects.toThrow(/invalid_grant/);
  // A redirect with no state, or with no code.
  expect(() => codeOf(`${REDIRECT}?code=x`, pending)).toThrow(/state_mismatch/);
  // A denied sign-in may come back without a state: said as denied.
  expect(() => codeOf(`${REDIRECT}?error=access_denied`, pending)).toThrow(/access_denied/);
  expect(() => codeOf(`${REDIRECT}?state=${pending.state}`, pending)).toThrow(/no_code/);
});

test("the access token is renewed before it ends and when a server refuses it; a revoked sign-in signs out", async () => {
  const server = authServer();
  const { url, pending } = await authorization(client, REDIRECT);
  let time = 0;
  const first = await exchange(
    server.http,
    client,
    codeOf(server.approve(url), pending),
    pending,
    time,
  );
  const kept: Tokens[] = [];
  const source = tokenSource(
    server.http,
    client,
    first,
    async (tokens) => void kept.push(tokens),
    () => time,
  );
  expect(await source.token()).toBe("access-1");
  // Near its end: renewed first, the refresh token kept as it was (Google's way).
  time = first.expiresAt - 30_000;
  expect(await source.token()).toBe("access-2");
  expect(kept.at(-1)?.refreshToken).toBe("refresh-1");
  // Renewals at once share one request.
  await Promise.all([source.renew(), source.renew(), source.renew()]);
  expect(await source.token()).toBe("access-3");
  // Microsoft's way: a new refresh token each time, kept.
  server.rotating();
  await source.renew();
  expect(kept.at(-1)?.refreshToken).toBe("refresh-4");
  // Revoked (the user took the access back): the account is signed out.
  server.revoke();
  await expect(source.renew()).rejects.toThrow(AuthError);
});

test("a CalDAV server that takes a bearer token gets it, and a refused one is renewed once", async () => {
  const server = authServer();
  const { url, pending } = await authorization(client, REDIRECT);
  const first = await exchange(server.http, client, codeOf(server.approve(url), pending), pending);
  const source = tokenSource(server.http, client, first, async () => {});
  let accepted = "access-1";
  const seen: (string | undefined)[] = [];
  const dav: HttpClient = async (request) => {
    seen.push(request.headers["Authorization"]);
    const ok = request.headers["Authorization"] === `Bearer ${accepted}`;
    return { status: ok ? 207 : 401, url: request.url, header: () => null, body: "" };
  };
  const auth = new Authorization(source);
  const propfind = { method: "PROPFIND", url: "https://dav.example/caldav/v2/", headers: {} };
  expect((await send(dav, auth, propfind, [])).status).toBe(207);
  // The service ended the token early: the server refuses it, one renewal, one retry.
  accepted = "access-2";
  expect((await send(dav, auth, propfind, [])).status).toBe(207);
  expect(seen).toEqual(["Bearer access-1", "Bearer access-1", "Bearer access-2"]);
  // A token the server still refuses after the renewal is the account's sign-in refused.
  accepted = "never";
  await expect(send(dav, auth, propfind, [])).rejects.toThrow(AuthError);
});

test("Google's client asks for a lasting sign-in to its calendars and tasks", () => {
  expect(GOOGLE.scopes).toEqual([
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/tasks",
  ]);
  expect(GOOGLE.extra).toMatchObject({ access_type: "offline" });
});

/** A token endpoint that answers as `answer` says, for the edge paths. */
const endpoint =
  (answer: (request: HttpRequest) => { status: number; body: string } | "offline"): HttpClient =>
  async (request) => {
    const said = answer(request);
    if (said === "offline") throw new OfflineError("offline");
    return { status: said.status, url: request.url, header: () => null, body: said.body };
  };

test("an exchange without a refresh token, a page that is no JSON, or a busy endpoint gives no tokens", async () => {
  const { pending } = await authorization(client, REDIRECT);
  const noRefresh = endpoint(() => ({
    status: 200,
    body: JSON.stringify({ access_token: "a", expires_in: 3600 }),
  }));
  await expect(exchange(noRefresh, client, "c", pending)).rejects.toThrow(/no_refresh_token/);
  const portal = endpoint(() => ({ status: 200, body: "<!doctype html><title>Wi-Fi</title>" }));
  await expect(exchange(portal, client, "c", pending)).rejects.toThrow(/without a token/);
  const busy = endpoint(() => ({ status: 503, body: "busy" }));
  await expect(exchange(busy, client, "c", pending)).rejects.toThrow(OfflineError);
});

test("an early renewal that fails offline or busy keeps the token that still works, and tries again later", async () => {
  let time = 0;
  let mode: "offline" | "busy" | "up" = "offline";
  let refreshes = 0;
  const http = endpoint(() => {
    refreshes += 1;
    if (mode === "offline") return "offline";
    if (mode === "busy") return { status: 503, body: "" };
    return { status: 200, body: JSON.stringify({ access_token: "fresh", expires_in: 3600 }) };
  });
  const source = tokenSource(
    http,
    client,
    { accessToken: "still-good", refreshToken: "r", expiresAt: 100_000 },
    async () => {},
    () => time,
  );
  // Thirty seconds before its end: the renewal fails, the token still serves.
  time = 70_000;
  expect(await source.token()).toBe("still-good");
  mode = "busy";
  expect(await source.token()).toBe("still-good");
  expect(refreshes).toBe(2);
  // Past its end, a failed renewal fails the request.
  time = 100_000;
  await expect(source.token()).rejects.toThrow(OfflineError);
  mode = "up";
  expect(await source.token()).toBe("fresh");
});

test("a rotated refresh token the device cannot keep is reported, early or after a 401, and the request goes on", async () => {
  let rotated = true;
  let issued = 0;
  const http = endpoint(() => {
    issued += 1;
    return {
      status: 200,
      body: JSON.stringify({
        access_token: `fresh-${issued}`,
        // Some services write it as a string.
        expires_in: "3600",
        ...(rotated ? { refresh_token: `r${issued + 1}` } : {}),
      }),
    };
  });
  const failing = async () => {
    throw new Error("keyring locked");
  };
  let time = 0;
  const reported: unknown[] = [];
  const source = tokenSource(
    http,
    client,
    { accessToken: "a", refreshToken: "r1", expiresAt: 100_000 },
    failing,
    () => time,
    (problem) => reported.push(problem),
  );
  // Early: the renewal is due; the new token serves, the problem is reported.
  time = 70_000;
  expect(await source.token()).toBe("fresh-1");
  expect(reported).toHaveLength(1);
  expect(reported[0]).toBeInstanceOf(TokenNotKeptError);
  // A string's expires_in counts: an hour from then.
  time = 70_000 + 3_000_000;
  expect(await source.token()).toBe("fresh-1");
  // After a 401: renewed, the request may go again, the problem reported again.
  await expect(source.renew("fresh-1")).resolves.toBe(true);
  expect(await source.token()).toBe("fresh-2");
  expect(reported).toHaveLength(2);
  // Not rotated: the old refresh token still works after a restart, nothing to report.
  rotated = false;
  await source.renew("fresh-2");
  expect(reported).toHaveLength(2);
});

test("a request refused with a token another request already replaced renews nothing more", async () => {
  let refreshes = 0;
  const http = endpoint(() => {
    refreshes += 1;
    return {
      status: 200,
      body: JSON.stringify({ access_token: `t${refreshes + 1}`, expires_in: 3600 }),
    };
  });
  const source = tokenSource(
    http,
    client,
    { accessToken: "t1", refreshToken: "r", expiresAt: 10_000_000 },
    async () => {},
  );
  await source.renew("t1");
  // A second 401 for "t1", arriving after the renewal: "t2" is there already.
  await source.renew("t1");
  expect(refreshes).toBe(1);
  expect(await source.token()).toBe("t2");
});

test("an OAuth token is never sent over plain http to another host", async () => {
  const source = tokenSource(
    endpoint(() => ({ status: 500, body: "" })),
    client,
    { accessToken: "t", refreshToken: "r", expiresAt: 10_000_000 },
    async () => {},
    () => 0,
  );
  const auth = new Authorization(source);
  const seen: HttpRequest[] = [];
  const dav: HttpClient = async (request) => {
    seen.push(request);
    return { status: 207, url: request.url, header: () => null, body: "" };
  };
  const propfind = (url: string) => ({ method: "PROPFIND", url, headers: {} });
  await expect(send(dav, auth, propfind("http://dav.example/caldav/"), [])).rejects.toThrow(
    /never sent unencrypted/,
  );
  expect(seen).toEqual([]);
  // To this device it may go, as a password may.
  expect((await send(dav, auth, propfind("http://127.0.0.1:5232/"), [])).status).toBe(207);
});
