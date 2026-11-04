// A subscription whose code does not arrive (offline before it was kept, or
// a release that replaced it): its sync fails, said as any failure, and
// `syncAll` never throws for an account (foundation D90, providers D263).
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { expect, test, vi } from "vite-plus/test";

import { syncAll } from "../src/index.ts";

vi.mock("../src/subscriptions.ts", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

test("a subscription's code that cannot load fails its sync, and nothing else", async () => {
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "ics",
    name: "Team",
    serverUrl: "https://calendar.example.org",
    username: null,
    homeUrl: "ics:0",
  });
  const secrets = {
    get: async () =>
      JSON.stringify({ subscription: "https://calendar.example.org/a.ics", apply: null }),
    set: async () => {},
    delete: async () => {},
  };
  const report = await syncAll({
    store,
    secrets,
    http: () => Promise.reject(new Error("no request expected")),
    connect: () => Promise.reject(new Error("no CalDAV here")),
  });
  expect(report.accounts).toMatchObject([{ accountId: account.id, status: "failed" }]);
});
