// Adding an account, step by step (docs/plans/foundation.md#D92): a fake
// Nextcloud answers Login Flow v2 and CalDAV discovery; the test decides when
// time passes, so nothing here waits for a clock.
import { CertificateError, type HttpClient, type HttpRequest } from "@astrotime/caldav";
import { OfflineError, type SecretStore } from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { expect, test } from "vite-plus/test";

import {
  FLOW_LIFETIME_MS,
  hasPendingFlow,
  heldApproval,
  HOLD_MS,
  PENDING_FLOW,
  pollInterval,
  serverAddress,
  SignIn,
  type Clock,
  type SignInState,
} from "../src/accounts/sign-in.ts";
import { memorySecrets, nextcloud, SERVER } from "./fakes.ts";

/** Time the test moves: each wait is a promise the test resolves. */
function manualClock() {
  let now = 0;
  const waits = new Set<() => void>();
  const watchers: (() => void)[] = [];
  /** How long each wait was asked to be. */
  const asked: number[] = [];
  const clock: Clock = {
    now: () => now,
    wait: (ms, signal) =>
      new Promise<void>((resolve) => {
        asked.push(ms);
        const done = () => {
          waits.delete(done);
          resolve();
        };
        waits.add(done);
        signal.addEventListener("abort", done);
        for (const watcher of watchers.splice(0)) watcher();
      }),
  };
  return {
    clock,
    asked,
    /** Resolves once the sign-in waits between two polls. */
    waiting: () =>
      new Promise<void>((resolve) => (waits.size > 0 ? resolve() : watchers.push(resolve))),
    advance(ms: number) {
      now += ms;
      for (const done of waits) done();
    },
  };
}

async function setup(
  server: ReturnType<typeof nextcloud>,
  shared?: { store: Store; secrets: ReturnType<typeof memorySecrets> },
  pending?: SecretStore,
  visible?: () => boolean,
) {
  const store = shared?.store ?? (await Store.open(nodeDriver()));
  const secrets = shared?.secrets ?? memorySecrets();
  const opened: string[] = [];
  const time = manualClock();
  const page = crypto.randomUUID();
  const signIn = new SignIn({
    store,
    secrets,
    http: server.http,
    openExternal: (url) => opened.push(url),
    pending: pending ?? secrets,
    // A page of its own, whose lock nobody holds unless the test does: gone.
    page,
    clock: time.clock,
    ...(visible ? { visible } : {}),
  });
  /** Resolves once the state is `step` (or right away if it is). */
  const reaches = (step: SignInState["step"]) =>
    new Promise<SignInState>((resolve) => {
      if (signIn.state.step === step) return resolve(signIn.state);
      const stop = signIn.subscribe(() => {
        if (signIn.state.step !== step) return;
        stop();
        resolve(signIn.state);
      });
    });
  return { store, secrets, opened, time, signIn, reaches, server, page };
}

test("what the user types becomes a server address, or is refused", () => {
  expect(serverAddress(" cloud.example.com ")).toBe("https://cloud.example.com/");
  expect(serverAddress("http://127.0.0.1:5232")).toBe("http://127.0.0.1:5232/");
  expect(serverAddress("example.com/nextcloud?x=1#y")).toBe("https://example.com/nextcloud");
  for (const typed of ["", "   ", "ftp://example.com", "https://", "exa mple"])
    expect(serverAddress(typed)).toBeNull();
});

test("a password sign-in finds the calendars and keeps the account, its password in the secret store", async () => {
  const { store, secrets, signIn } = await setup(nextcloud({ password: "pw" }));
  await signIn.withPassword({ server: "cloud.example.com", username: " astro ", password: "pw" });
  expect(signIn.state).toMatchObject({ step: "done", added: true });
  const [account] = await store.accounts();
  expect(account).toMatchObject({
    name: "astro@cloud.example.com",
    serverUrl: "https://cloud.example.com/",
    username: "astro",
    homeUrl: "https://cloud.example.com/remote.php/dav/calendars/astro/",
  });
  expect(JSON.parse(secrets.values.get(`account:${account!.id}`)!)).toEqual({
    username: "astro",
    password: "pw",
  });
});

test("signing in again revokes the app password Login Flow gave the one replaced (foundation D90)", async () => {
  const server = nextcloud({ password: "pw" });
  let revoked: (request: HttpRequest) => void = () => {};
  const revoking = new Promise<HttpRequest>((resolve) => (revoked = resolve));
  const http: HttpClient = (request) => {
    if (request.method === "DELETE") revoked(request);
    return server.http(request);
  };
  const { store, secrets, signIn } = await setup({ ...server, http });
  await signIn.withPassword({ server: "cloud.example.com", username: "astro", password: "pw" });
  const [account] = await store.accounts();
  // As if Login Flow had given the password kept.
  secrets.values.set(
    `account:${account!.id}`,
    JSON.stringify({ username: "astro", password: "app-old", loginFlow: true }),
  );
  await signIn.withPassword({ server: "cloud.example.com", username: "astro", password: "pw" });
  const request = await revoking;
  expect([request.url, request.headers.Authorization]).toEqual([
    "https://cloud.example.com/ocs/v2.php/core/apppassword",
    `Basic ${btoa("astro:app-old")}`,
  ]);
});

test("a wrong password says so, and keeps nothing", async () => {
  const { store, secrets, signIn } = await setup(nextcloud({ password: "pw" }));
  await signIn.withPassword({ server: SERVER, username: "astro", password: "nope" });
  expect(signIn.state).toEqual({ step: "failed", problem: "auth", location: null });
  expect([await store.accounts(), secrets.values.size]).toEqual([[], 0]);
});

test("Login Flow v2: opens Nextcloud's page, waits for the approval, then signs in with the app password", async () => {
  const server = nextcloud({ password: "app-pass", approveAfter: 2 });
  const { store, secrets, opened, time, signIn, reaches } = await setup(server);
  const signingIn = signIn.withNextcloud({ server: "cloud.example.com" });
  expect(await reaches("waiting")).toEqual({
    step: "waiting",
    loginUrl: `${SERVER}/login/v2/flow/abc`,
  });
  expect(opened).toEqual([`${SERVER}/login/v2/flow/abc`]);
  // The first page was blocked or closed: it opens again.
  signIn.reopen();
  expect(opened).toHaveLength(2);
  // A moment offline while waiting is no failure.
  server.dropNextPolls(1);
  await time.waiting();
  time.advance(2_000);
  // The user comes back to the app: it asks at once, without waiting for the next poll.
  await time.waiting();
  signIn.pollNow();
  await time.waiting();
  time.advance(2_000);
  await signingIn;
  expect(signIn.state).toMatchObject({ step: "done", added: true });
  expect((await store.accounts()).map((a) => a.username)).toEqual(["astro"]);
  // Kept as Login Flow's, so removing the account revokes it (foundation D90).
  const [account] = await store.accounts();
  expect(JSON.parse((await secrets.get(`account:${account!.id}`))!)).toMatchObject({
    password: "app-pass",
    loginFlow: true,
  });
  const polls = server.requests.filter((r) => r.url.endsWith("/login/v2/poll"));
  expect(polls).toHaveLength(4);
});

test("Login Flow v2 polls every 2 s at first, then less often, and not while AstroTime is out of sight (foundation D130)", async () => {
  expect([0, 59_999, 60_000, 299_999, 300_000].map(pollInterval)).toEqual([
    2_000, 2_000, 5_000, 5_000, 15_000,
  ]);
  const server = nextcloud({ password: "app-pass" });
  let visible = true;
  const { time, signIn } = await setup(server, undefined, undefined, () => visible);
  const signingIn = signIn.withNextcloud({ server: SERVER });
  const polls = () => server.requests.filter((r) => r.url.endsWith("/login/v2/poll")).length;
  await time.waiting();
  time.advance(61_000);
  await time.waiting();
  expect(time.asked).toEqual([2_000, 5_000]);
  // In Nextcloud's tab: the wait ends, and no poll follows while out of sight.
  visible = false;
  time.advance(5_000);
  await Promise.resolve();
  time.advance(FLOW_LIFETIME_MS / 2);
  expect(polls()).toBe(2);
  // Back: it asks at once.
  visible = true;
  server.approve();
  signIn.pollNow();
  await signingIn;
  expect(signIn.state).toMatchObject({ step: "done" });
  expect(polls()).toBe(3);
});

test("a rate-limited poll waits for the server's Retry-After (foundation D130)", async () => {
  const server = nextcloud({ password: "app-pass" });
  let limited = true;
  const http: HttpClient = async (request) =>
    limited && request.url.endsWith("/login/v2/poll")
      ? ((limited = false),
        {
          status: 429,
          url: request.url,
          header: (name) => (name === "retry-after" ? "30" : null),
          body: "",
        })
      : server.http(request);
  const { time, signIn } = await setup({ ...server, http });
  const signingIn = signIn.withNextcloud({ server: SERVER });
  await time.waiting();
  expect(time.asked).toEqual([30_000]);
  signIn.cancel();
  await signingIn;
});

test("a poll told to wait past the token's life ends the flow as expired, at once (foundation D130)", async () => {
  const server = nextcloud({ password: "app-pass" });
  const http: HttpClient = async (request) =>
    request.url.endsWith("/login/v2/poll")
      ? {
          status: 429,
          url: request.url,
          header: (name) => (name === "retry-after" ? "86400" : null),
          body: "",
        }
      : server.http(request);
  const { time, signIn } = await setup({ ...server, http });
  await signIn.withNextcloud({ server: SERVER });
  expect(signIn.state).toEqual({ step: "failed", problem: "expired", location: null });
  expect(time.asked).toEqual([]);
});

test("Login Flow v2 gives up when Nextcloud's token expires, and a cancelled one changes nothing", async () => {
  const { store, time, signIn, reaches } = await setup(nextcloud({ password: "app-pass" }));
  const expiring = signIn.withNextcloud({ server: SERVER });
  await time.waiting();
  time.advance(FLOW_LIFETIME_MS);
  await expiring;
  expect(signIn.state).toEqual({ step: "failed", problem: "expired", location: null });

  const cancelled = signIn.withNextcloud({ server: SERVER });
  await reaches("waiting");
  signIn.cancel();
  await cancelled;
  expect(signIn.state).toEqual({ step: "idle" });
  expect(await store.accounts()).toEqual([]);
});

test("a Login Flow outlives the page that started it: the next page takes it up and signs in (D121)", async () => {
  const server = nextcloud({ password: "app-pass" });
  const first = await setup(server);
  void first.signIn.withNextcloud({ server: "cloud.example.com" });
  await first.reaches("waiting");
  // The pages' clocks start at 0.
  expect(await hasPendingFlow(first.secrets, 0)).toBe(true);
  // The browser discards the page while the user approves on Nextcloud's;
  // the page loaded anew takes the flow up, without opening Nextcloud's again.
  const next = await setup(server, first);
  const resuming = next.signIn.resume();
  expect(await next.reaches("waiting")).toEqual({
    step: "waiting",
    loginUrl: `${SERVER}/login/v2/flow/abc`,
  });
  expect(next.opened).toEqual([]);
  next.signIn.reopen();
  expect(next.opened).toEqual([`${SERVER}/login/v2/flow/abc`]);
  // Not approved yet at its first poll; then the user approves.
  await next.time.waiting();
  server.approve();
  next.time.advance(2_000);
  expect(await resuming).toBe(true);
  expect(next.signIn.state).toMatchObject({ step: "done", added: true });
  expect((await next.store.accounts()).map((a) => a.username)).toEqual(["astro"]);
  // The token is spent: nothing is left to take up.
  expect(first.secrets.values.has(PENDING_FLOW)).toBe(false);
  // The discarded page, had it come back, would see another page ended it.
  first.time.advance(2_000);
  expect(await first.reaches("elsewhere")).toEqual({ step: "elsewhere" });
});

test("no flow is nothing to take up; one past its token's life, or unreadable, is forgotten on load (D121)", async () => {
  const server = nextcloud({ password: "app-pass" });
  const first = await setup(server);
  expect(await hasPendingFlow(first.secrets)).toBe(false);
  expect(await first.signIn.resume()).toBe(false);
  expect(first.signIn.state).toEqual({ step: "idle" });

  void first.signIn.withNextcloud({ server: SERVER });
  await first.reaches("waiting");
  // The first page's clock starts at 0: its token lives until FLOW_LIFETIME_MS.
  expect(await hasPendingFlow(first.secrets, FLOW_LIFETIME_MS - 1)).toBe(true);
  expect(await hasPendingFlow(first.secrets, FLOW_LIFETIME_MS)).toBe(false);
  expect(first.secrets.values.has(PENDING_FLOW)).toBe(false);

  first.secrets.values.set(PENDING_FLOW, "{not json");
  expect(await hasPendingFlow(first.secrets)).toBe(false);
  expect(first.secrets.values.has(PENDING_FLOW)).toBe(false);
});

test("a flow cancelled, failed or expired is forgotten; one that cannot be kept goes on in its page (D121)", async () => {
  const server = nextcloud({ password: "app-pass" });
  const page = await setup(server);
  void page.signIn.withNextcloud({ server: SERVER });
  await page.reaches("waiting");
  await page.signIn.cancel();
  expect(page.secrets.values.has(PENDING_FLOW)).toBe(false);

  const expiring = page.signIn.withNextcloud({ server: SERVER });
  await page.time.waiting();
  page.time.advance(FLOW_LIFETIME_MS);
  await expiring;
  expect(page.signIn.state).toMatchObject({ step: "failed", problem: "expired" });
  expect(page.secrets.values.has(PENDING_FLOW)).toBe(false);

  // Nextcloud answers the poll with what no Nextcloud says: a failure.
  const broken = await setup({
    ...server,
    http: async (request) =>
      request.url.endsWith("/login/v2/poll")
        ? { status: 400, url: request.url, header: () => null, body: "" }
        : server.http(request),
  });
  await broken.signIn.withNextcloud({ server: SERVER });
  expect(broken.signIn.state).toMatchObject({ step: "failed", problem: "failed" });
  expect(broken.secrets.values.has(PENDING_FLOW)).toBe(false);

  // The secret store refuses: the flow is not kept, but signs in all the same.
  const refusing = await setup(nextcloud({ password: "app-pass" }), undefined, {
    ...memorySecrets(),
    set: async () => {
      throw new Error("The secret store is full.");
    },
  });
  const signingIn = refusing.signIn.withNextcloud({ server: SERVER });
  await refusing.reaches("waiting");
  await refusing.time.waiting();
  refusing.server.approve();
  refusing.time.advance(2_000);
  await signingIn;
  expect(refusing.signIn.state).toMatchObject({ step: "done", added: true });
});

test("a page that took up a flow and cancels it ends it for the page that started it (D121)", async () => {
  const server = nextcloud({ password: "app-pass" });
  const first = await setup(server);
  void first.signIn.withNextcloud({ server: SERVER });
  await first.reaches("waiting");
  const next = await setup(server, first);
  void next.signIn.resume();
  await next.reaches("waiting");
  await next.signIn.cancel();
  expect(first.secrets.values.has(PENDING_FLOW)).toBe(false);
  await first.time.waiting();
  first.time.advance(2_000);
  expect(await first.reaches("elsewhere")).toEqual({ step: "elsewhere" });
});

test("a newer flow started in another page replaces the kept one, and the older page's end leaves it (D121)", async () => {
  const server = nextcloud({ password: "app-pass" });
  const first = await setup(server);
  void first.signIn.withNextcloud({ server: SERVER });
  await first.reaches("waiting");
  const kept = first.secrets.values.get(PENDING_FLOW);
  // Another page starts its own flow: Nextcloud gives it another token.
  const other = await setup(
    {
      ...server,
      http: async (request) => {
        const response = await server.http(request);
        return request.url.endsWith("/index.php/login/v2")
          ? { ...response, body: response.body.replace("t0k3n", "n3w-t0k3n") }
          : response;
      },
    },
    first,
  );
  void other.signIn.withNextcloud({ server: SERVER });
  await other.reaches("waiting");
  const newer = first.secrets.values.get(PENDING_FLOW);
  expect(newer).not.toBe(kept);
  expect(newer).toContain("n3w-t0k3n");
  // The older page is cancelled: the newer flow stays.
  await first.signIn.cancel();
  expect(first.secrets.values.get(PENDING_FLOW)).toBe(newer);
});

test("an approval held while its server cannot be reached opens no dialog; it is saved in the background once it can be (D121)", async () => {
  const server = nextcloud({ password: "app-pass" });
  // The server cannot be reached for discovery, after the approval.
  let unreachable = true;
  const http: HttpClient = (request) => {
    if (unreachable && !request.url.includes("/login/v2"))
      return Promise.reject(new OfflineError("offline"));
    return server.http(request);
  };
  const first = await setup({ ...server, http });
  const signingIn = first.signIn.withNextcloud({ server: SERVER });
  await first.time.waiting();
  server.approve();
  first.time.advance(2_000);
  await signingIn;
  expect(first.signIn.state).toMatchObject({ step: "failed", problem: "offline" });
  expect(JSON.parse(first.secrets.values.get(PENDING_FLOW)!)).toMatchObject({
    step: "approved",
    username: "astro",
    password: "app-pass",
  });
  // Closed while offline: held, not revoked; no page reopens the dialog for it.
  await first.signIn.cancel();
  expect(server.requests.filter((r) => r.method === "DELETE")).toEqual([]);
  expect(await hasPendingFlow(first.secrets, 0)).toBe(false);
  expect(await heldApproval(first.secrets, first.page)).toEqual({
    server: `${SERVER}/`,
    username: "astro",
  });
  // Tried again still offline: held.
  expect(await first.signIn.saveHeld()).toBe("held");

  // The page goes; the next one, online, saves the account in the background.
  unreachable = false;
  const next = await setup({ ...server, http }, first);
  const polls = server.requests.filter((r) => r.url.endsWith("/login/v2/poll")).length;
  expect(await next.signIn.saveHeld()).toBe("saved");
  expect(next.signIn.state).toMatchObject({ step: "done", added: true });
  expect(server.requests.filter((r) => r.url.endsWith("/login/v2/poll"))).toHaveLength(polls);
  const [account] = await next.store.accounts();
  expect(JSON.parse(next.secrets.values.get(`account:${account!.id}`)!)).toMatchObject({
    password: "app-pass",
    loginFlow: true,
  });
  expect(next.secrets.values.has(PENDING_FLOW)).toBe(false);
  expect(await heldApproval(next.secrets, next.page)).toBeNull();
});

test("an approval held past its seven days is revoked at the next chance, then dropped (D121)", async () => {
  const server = nextcloud({ password: "app-pass" });
  let unreachable = true;
  const http: HttpClient = (request) => {
    if (unreachable && !request.url.includes("/login/v2"))
      return Promise.reject(new OfflineError("offline"));
    return server.http(request);
  };
  const page = await setup({ ...server, http });
  const signingIn = page.signIn.withNextcloud({ server: SERVER });
  await page.time.waiting();
  server.approve();
  page.time.advance(2_000);
  await signingIn;
  expect(JSON.parse(page.secrets.values.get(PENDING_FLOW)!)).toMatchObject({
    heldUntil: 2_000 + HOLD_MS,
  });
  page.time.advance(HOLD_MS);
  // Past it, still offline: the revocation waits for the next chance.
  expect(await page.signIn.saveHeld()).toBe("held");
  expect(page.secrets.values.has(PENDING_FLOW)).toBe(true);
  // Online: revoked, not saved, and dropped.
  unreachable = false;
  expect(await page.signIn.saveHeld()).toBe("none");
  expect(
    server.requests.filter((r) => r.method === "DELETE").map((r) => r.headers.Authorization),
  ).toEqual([`Basic ${btoa("astro:app-pass")}`]);
  expect(page.secrets.values.has(PENDING_FLOW)).toBe(false);
  expect(await page.store.accounts()).toEqual([]);
});

test("an approval held is used again only for the same server: scheme, host, port and path (D121)", async () => {
  const server = nextcloud({ password: "app-pass" });
  let unreachable = true;
  const http: HttpClient = (request) => {
    if (unreachable && !request.url.includes("/login/v2"))
      return Promise.reject(new OfflineError("offline"));
    return server.http(request);
  };
  const page = await setup({ ...server, http });
  const signingIn = page.signIn.withNextcloud({ server: SERVER });
  await page.time.waiting();
  server.approve();
  page.time.advance(2_000);
  await signingIn;
  const starts = () => server.requests.filter((r) => r.url.endsWith("/index.php/login/v2"));
  expect(starts()).toHaveLength(1);
  // Another path on the same host is another server: a flow of its own
  // (which this fake Nextcloud, at its root only, does not offer there).
  await page.signIn.withNextcloud({ server: "cloud.example.com/other" });
  expect(starts().map((r) => r.url)).toEqual([
    `${SERVER}/index.php/login/v2`,
    `${SERVER}/other/index.php/login/v2`,
  ]);
  expect(page.signIn.state).toMatchObject({ step: "failed", problem: "not-nextcloud" });

  // The same server, spelled as typed: the approval held is saved, with no new flow.
  const server2 = nextcloud({ password: "app-pass" });
  const again = await setup({
    ...server2,
    http: (request) =>
      unreachable && !request.url.includes("/login/v2")
        ? Promise.reject(new OfflineError("offline"))
        : server2.http(request),
  });
  const held = again.signIn.withNextcloud({ server: SERVER });
  await again.time.waiting();
  server2.approve();
  again.time.advance(2_000);
  await held;
  expect(again.signIn.state).toMatchObject({ step: "failed", problem: "offline" });
  unreachable = false;
  const before = server2.requests.filter((r) => r.url.endsWith("/index.php/login/v2")).length;
  await again.signIn.withNextcloud({ server: "cloud.example.com/" });
  expect(again.signIn.state).toMatchObject({ step: "done", added: true });
  expect(server2.requests.filter((r) => r.url.endsWith("/index.php/login/v2"))).toHaveLength(
    before,
  );
});

test("a new flow that replaces an approval another page left unsaved revokes its app password (D121)", async () => {
  const server = nextcloud({ password: "app-pass" });
  const page = await setup(server);
  // A page went after the approval, before its account was saved, and this
  // one starts a flow of its own rather than taking that one up.
  page.secrets.values.set(
    PENDING_FLOW,
    JSON.stringify({
      step: "approved",
      token: "old-t0k3n",
      server: `${SERVER}/`,
      owner: "a-page-that-went",
      heldUntil: HOLD_MS,
      username: "astro",
      password: "app-left",
    }),
  );
  void page.signIn.withNextcloud({ server: SERVER });
  await page.reaches("waiting");
  expect(
    server.requests.filter((r) => r.method === "DELETE").map((r) => r.headers.Authorization),
  ).toEqual([`Basic ${btoa("astro:app-left")}`]);
  expect(JSON.parse(page.secrets.values.get(PENDING_FLOW)!)).toMatchObject({
    step: "waiting",
    token: "t0k3n",
  });
});

test("an approval is taken up only once the page that holds it is gone, never beside it (D121)", async () => {
  const server = nextcloud({ password: "app-pass" });
  const page = await setup(server);
  // A page that lives (it holds its lock) is saving its approval.
  let leave = () => {};
  await new Promise<void>((held) => {
    void navigator.locks.request(
      "astrotime-page-saving",
      () =>
        new Promise<void>((resolve) => {
          leave = resolve;
          held();
        }),
    );
  });
  const approval = JSON.stringify({
    step: "approved",
    token: "saving-t0k3n",
    server: `${SERVER}/`,
    owner: "saving",
    heldUntil: HOLD_MS,
    username: "astro",
    password: "app-pass",
  });
  page.secrets.values.set(PENDING_FLOW, approval);
  expect(await heldApproval(page.secrets, page.page)).toBeNull();
  expect(await page.signIn.saveHeld()).toBe("none");
  expect(await page.signIn.resume()).toBe(false);
  // Nor does a new flow here replace it, or revoke its app password.
  void page.signIn.withNextcloud({ server: SERVER });
  await page.reaches("waiting");
  expect(page.secrets.values.get(PENDING_FLOW)).toBe(approval);
  expect(server.requests.filter((r) => r.method === "DELETE")).toEqual([]);
  await page.signIn.cancel();
  expect(page.secrets.values.get(PENDING_FLOW)).toBe(approval);

  // The page goes before saving it: the next page takes it up, as its own, and saves it.
  leave();
  const next = await setup(server, page);
  expect(await heldApproval(next.secrets, next.page)).not.toBeNull();
  expect(await next.signIn.saveHeld()).toBe("saved");
  expect(next.signIn.state).toMatchObject({ step: "done", added: true });
  expect(next.secrets.values.has(PENDING_FLOW)).toBe(false);
  expect(server.requests.filter((r) => r.method === "DELETE")).toEqual([]);
});

test("an approval whose account cannot be saved is revoked and forgotten (D121)", async () => {
  const server = nextcloud({ password: "app-pass" });
  let reachable = true;
  // Discovery finds no calendars: no account to save.
  const http: HttpClient = async (request) => {
    if (request.url.includes("/login/v2") || request.method === "DELETE")
      return server.http(request);
    if (!reachable) throw new OfflineError("offline");
    return { status: 404, url: request.url, header: () => null, body: "" };
  };
  // Reached, but no CalDAV server there: revoked at once.
  const server2 = nextcloud({ password: "app-pass" });
  expect(reachable).toBe(true);
  const other = await setup({
    ...server2,
    http: (request) =>
      request.url.includes("/login/v2") || request.method === "DELETE"
        ? server2.http(request)
        : http(request),
  });
  const notCaldav = other.signIn.withNextcloud({ server: SERVER });
  await other.time.waiting();
  server2.approve();
  other.time.advance(2_000);
  await notCaldav;
  expect(other.signIn.state).toMatchObject({ step: "failed" });
  expect(server2.requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
  expect(other.secrets.values.has(PENDING_FLOW)).toBe(false);
  expect(await other.store.accounts()).toEqual([]);
});

test("an address that is no Nextcloud, or no web address at all, is told apart", async () => {
  const notNextcloud: HttpClient = async (request) => ({
    status: 404,
    url: request.url,
    header: () => null,
    body: "",
  });
  const { signIn } = await setup({ ...nextcloud({ password: "x" }), http: notNextcloud });
  await signIn.withNextcloud({ server: "example.com" });
  expect(signIn.state).toMatchObject({ step: "failed", problem: "not-nextcloud" });
  await signIn.withPassword({ server: "   ", username: "a", password: "b" });
  expect(signIn.state).toMatchObject({ step: "failed", problem: "address" });
  await signIn.withPassword({ server: "example.com", username: "a", password: "b" });
  // 404 everywhere: an address that answers, but no CalDAV server.
  expect(signIn.state).toMatchObject({ step: "failed", problem: "not-caldav" });
});

test("a certificate the device refuses is said as such, by password and through Login Flow (android D62)", async () => {
  const refused: HttpClient = async () => {
    throw new CertificateError("refused");
  };
  const { store, signIn } = await setup({ ...nextcloud({ password: "x" }), http: refused });
  await signIn.withPassword({ server: "cloud.example.com", username: "a", password: "b" });
  expect(signIn.state).toEqual({ step: "failed", problem: "certificate", location: null });
  await signIn.withNextcloud({ server: "cloud.example.com" });
  expect(signIn.state).toEqual({ step: "failed", problem: "certificate", location: null });
  expect(await store.accounts()).toEqual([]);
});

test("cancelled while the account was being saved, the account it added goes again", async () => {
  const server = nextcloud({ password: "secret" });
  const { store, secrets, signIn } = await setup(server);
  const saving = store.findOrAddAccount.bind(store);
  // Cancel the moment the account is written, before the sign-in sees it.
  let added = "";
  store.findOrAddAccount = async (input) => {
    const found = await saving(input);
    added = found.account.id;
    signIn.cancel();
    return found;
  };
  await signIn.withPassword({ server: SERVER, username: "astro", password: "secret" });
  expect(added).not.toBe("");
  expect(await store.accounts()).toEqual([]);
  expect(await secrets.get(`account:${added}`)).toBeNull();
  expect(signIn.state.step).not.toBe("done");
});

test("the platform hears which server is being signed in to, for as long as it takes (android D62)", async () => {
  const server = nextcloud({ password: "app-pass", approveAfter: 0 });
  const store = await Store.open(nodeDriver());
  const time = manualClock();
  const signingIn: string[] = [];
  /** Each request with the servers being signed in to as it went out. */
  const seen: [string, string[]][] = [];
  const signIn = new SignIn({
    store,
    secrets: memorySecrets(),
    http: (request) => {
      seen.push([new URL(request.url).pathname, [...signingIn]]);
      return server.http(request);
    },
    openExternal: () => {},
    signingInTo: (address) => {
      signingIn.push(address);
      return () => void signingIn.splice(signingIn.indexOf(address), 1);
    },
    clock: time.clock,
  });
  await signIn.withPassword({ server: "cloud.example.com", username: "astro", password: "nope" });
  expect(signIn.state).toMatchObject({ step: "failed", problem: "auth" });
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every(([, servers]) => servers.includes(`${SERVER}/`))).toBe(true);
  expect(signingIn).toEqual([]);

  seen.length = 0;
  await signIn.withNextcloud({ server: "cloud.example.com" });
  expect(signIn.state).toMatchObject({ step: "done", added: true });
  expect(seen.map(([path]) => path)).toContain("/login/v2/poll");
  expect(seen.every(([, servers]) => servers.includes(`${SERVER}/`))).toBe(true);
  expect(signingIn).toEqual([]);
});
