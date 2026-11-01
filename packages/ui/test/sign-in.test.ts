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
  PENDING_FLOW,
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
  const clock: Clock = {
    now: () => now,
    wait: (_ms, signal) =>
      new Promise<void>((resolve) => {
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
) {
  const store = shared?.store ?? (await Store.open(nodeDriver()));
  const secrets = shared?.secrets ?? memorySecrets();
  const opened: string[] = [];
  const time = manualClock();
  const signIn = new SignIn({
    store,
    secrets,
    http: server.http,
    openExternal: (url) => opened.push(url),
    pending: pending ?? secrets,
    clock: time.clock,
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
  return { store, secrets, opened, time, signIn, reaches, server };
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

test("an approval whose account is not saved yet is kept: the next page saves it, without a new flow (D121)", async () => {
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
  expect(await hasPendingFlow(first.secrets, Number.MAX_SAFE_INTEGER)).toBe(true);

  // The page goes; the next one, online, saves the account from the approval.
  unreachable = false;
  const next = await setup({ ...server, http }, first);
  const polls = server.requests.filter((r) => r.url.endsWith("/login/v2/poll")).length;
  expect(await next.signIn.resume()).toBe(true);
  expect(next.signIn.state).toMatchObject({ step: "done", added: true });
  expect(server.requests.filter((r) => r.url.endsWith("/login/v2/poll"))).toHaveLength(polls);
  const [account] = await next.store.accounts();
  expect(JSON.parse(next.secrets.values.get(`account:${account!.id}`)!)).toMatchObject({
    password: "app-pass",
    loginFlow: true,
  });
  expect(next.secrets.values.has(PENDING_FLOW)).toBe(false);
});

test("an approval whose account cannot be saved, or that is cancelled, is revoked and forgotten (D121)", async () => {
  const server = nextcloud({ password: "app-pass" });
  let reachable = false;
  // Discovery finds no calendars: no account to save.
  const http: HttpClient = async (request) => {
    if (request.url.includes("/login/v2") || request.method === "DELETE")
      return server.http(request);
    if (!reachable) throw new OfflineError("offline");
    return { status: 404, url: request.url, header: () => null, body: "" };
  };
  const page = await setup({ ...server, http });
  const failing = page.signIn.withNextcloud({ server: SERVER });
  await page.time.waiting();
  server.approve();
  page.time.advance(2_000);
  await failing;
  // Offline: held. Then closed: revoked and forgotten.
  expect(page.signIn.state).toMatchObject({ step: "failed", problem: "offline" });
  await page.signIn.cancel();
  const revocations = () => server.requests.filter((r) => r.method === "DELETE");
  expect(revocations().map((r) => r.headers.Authorization)).toEqual([
    `Basic ${btoa("astro:app-pass")}`,
  ]);
  expect(page.secrets.values.has(PENDING_FLOW)).toBe(false);

  // Reached, but no CalDAV server there: revoked at once.
  const server2 = nextcloud({ password: "app-pass" });
  reachable = true;
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
