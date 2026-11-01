// The page's side of the service worker (docs/plans/foundation.md#D124): when
// a newer version is offered, which tab reloads, and how often a tab in
// front asks for one, on a fake container the test drives.
import { expect, test } from "vite-plus/test";

import { serviceWorkerUpdates } from "./updates.ts";

class FakeWorker extends EventTarget {
  readonly messages: unknown[] = [];
  state: ServiceWorkerState;
  constructor(state: ServiceWorkerState) {
    super();
    this.state = state;
  }
  to(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
  postMessage(message: unknown) {
    this.messages.push(message);
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  updates = 0;
  async update() {
    this.updates++;
  }
  /** A newer version found: it installs, then waits. */
  found(): FakeWorker {
    const worker = new FakeWorker("installing");
    this.installing = worker;
    this.dispatchEvent(new Event("updatefound"));
    return worker;
  }
}

class FakeContainer extends EventTarget {
  readonly registration = new FakeRegistration();
  registered: { url: string; scope: string | undefined } | null = null;
  controller: object | null;
  constructor(controller: object | null) {
    super();
    this.controller = controller;
  }
  async register(url: string, options?: { scope?: string }) {
    this.registered = { url, scope: options?.scope };
    return this.registration;
  }
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
  show(state: DocumentVisibilityState) {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

function setup(controlled: boolean, base?: string) {
  const container = new FakeContainer(controlled ? {} : null);
  const page = new FakeDocument();
  let time = 0;
  let reloads = 0;
  let heard = 0;
  const updates = serviceWorkerUpdates(container as unknown as ServiceWorkerContainer, {
    reload: () => reloads++,
    now: () => time,
    document: page as unknown as Document,
    ...(base ? { base } : {}),
  });
  updates.subscribe(() => heard++);
  return {
    container,
    page,
    updates,
    advance: (ms: number) => (time += ms),
    get reloads() {
      return reloads;
    },
    get heard() {
      return heard;
    },
  };
}

test("the worker is registered at the app's base, its scope the app's", async () => {
  const at = setup(true, "/calendar/");
  await at.updates.register();
  expect(at.container.registered).toEqual({ url: "/calendar/sw.js", scope: "/calendar/" });
  const root = setup(true);
  await root.updates.register();
  expect(root.container.registered).toEqual({ url: "/sw.js", scope: "/" });
});

test("a first install offers nothing and reloads nothing", async () => {
  const first = setup(false);
  await first.updates.register();
  first.container.registration.found().to("installed");
  first.container.dispatchEvent(new Event("controllerchange"));
  expect([first.updates.waiting, first.heard, first.reloads]).toEqual([false, 0, 0]);
});

test("a newer version, installed: offered once; Reload hands over, and the tab reloads when it took over", async () => {
  const tab = setup(true);
  // Reload before the registration is known does nothing.
  tab.updates.apply();
  await tab.updates.register();
  const newer = tab.container.registration.found();
  expect(tab.updates.waiting).toBe(false);
  newer.to("installed");
  tab.container.registration.waiting = newer;
  expect([tab.updates.waiting, tab.heard]).toEqual([true, 1]);
  tab.updates.apply();
  expect(newer.messages).toEqual(["astrotime-update"]);
  expect(tab.reloads).toBe(0);
  tab.container.dispatchEvent(new Event("controllerchange"));
  expect(tab.reloads).toBe(1);
});

test("a version waiting already when the page registers is offered", async () => {
  const tab = setup(true);
  tab.container.registration.waiting = new FakeWorker("installed");
  await tab.updates.register();
  expect([tab.updates.waiting, tab.heard]).toEqual([true, 1]);
});

test("another tab's Reload: this one, taken over, does not reload; after Later too, its own Reload loads it", async () => {
  const tab = setup(true);
  await tab.updates.register();
  const newer = tab.container.registration.found();
  newer.to("installed");
  tab.container.registration.waiting = newer;
  // Later is the UI's: it hides the notice, nothing here changes.
  tab.container.registration.waiting = null;
  tab.container.dispatchEvent(new Event("controllerchange"));
  expect([tab.reloads, tab.updates.waiting]).toEqual([0, true]);
  tab.updates.apply();
  expect(tab.reloads).toBe(1);
  expect(newer.messages).toEqual([]);
});

test("a tab taken over that had heard of nothing is offered the version now running it", async () => {
  const tab = setup(true);
  await tab.updates.register();
  tab.container.dispatchEvent(new Event("controllerchange"));
  expect([tab.updates.waiting, tab.heard, tab.reloads]).toEqual([true, 1, 0]);
});

test("a tab in front asks for a newer version at most once an hour", async () => {
  const tab = setup(true);
  await tab.updates.register();
  const { registration } = tab.container;
  tab.page.show("hidden");
  tab.page.show("visible");
  expect(registration.updates).toBe(0);
  tab.advance(60 * 60_000);
  tab.page.show("hidden");
  expect(registration.updates).toBe(0);
  tab.page.show("visible");
  expect(registration.updates).toBe(1);
  tab.advance(30 * 60_000);
  tab.page.show("visible");
  expect(registration.updates).toBe(1);
});
