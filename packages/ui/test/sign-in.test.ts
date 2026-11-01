// Adding an account, step by step (docs/plans/foundation.md#D92): a fake
// Nextcloud answers Login Flow v2 and CalDAV discovery; the test decides when
// time passes, so nothing here waits for a clock.
import type { HttpClient } from "@astrotime/caldav";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { expect, test } from "vite-plus/test";

import {
  FLOW_LIFETIME_MS,
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

async function setup(server: ReturnType<typeof nextcloud>) {
  const store = await Store.open(nodeDriver());
  const secrets = memorySecrets();
  const opened: string[] = [];
  const time = manualClock();
  const signIn = new SignIn({
    store,
    secrets,
    http: server.http,
    openExternal: (url) => opened.push(url),
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
  return { store, secrets, opened, time, signIn, reaches };
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

test("a wrong password says so, and keeps nothing", async () => {
  const { store, secrets, signIn } = await setup(nextcloud({ password: "pw" }));
  await signIn.withPassword({ server: SERVER, username: "astro", password: "nope" });
  expect(signIn.state).toEqual({ step: "failed", problem: "auth", location: null });
  expect([await store.accounts(), secrets.values.size]).toEqual([[], 0]);
});

test("Login Flow v2: opens Nextcloud's page, waits for the approval, then signs in with the app password", async () => {
  const server = nextcloud({ password: "app-pass", approveAfter: 2 });
  const { store, opened, time, signIn, reaches } = await setup(server);
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

test("cancelled while the account was being saved, the account it added goes again", async () => {
  const server = nextcloud({ password: "secret" });
  const { store, secrets, signIn } = await setup(server);
  const saving = store.addAccount.bind(store);
  // Cancel the moment the account is written, before the sign-in sees it.
  let added = "";
  store.addAccount = async (input) => {
    const account = await saving(input);
    added = account.id;
    signIn.cancel();
    return account;
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
