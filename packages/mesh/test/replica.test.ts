// The replica's rules on one store (docs/plans/server.md#D284, D285): the
// clock, the order of versions, what a vector may claim.
import { describe, expect, test } from "vite-plus/test";

import {
  apply,
  change,
  compareVersions,
  formatInvite,
  HybridClock,
  type Item,
  newMesh,
  parseInvite,
  type Version,
} from "../src/index.ts";
import { MemoryMeshStore } from "../src/memory.ts";

const item = (object: string): Item => ({ calendar: "personal", object });
const version = (
  peer: string,
  seq: number,
  wall: number,
  object = "a",
  body: string | null = "x",
): Version => ({
  item: item(object),
  hlc: { wall, counter: 0, peer },
  seq,
  body,
});

describe("HybridClock", () => {
  test("never goes back, and stamps after every stamp it saw", () => {
    let now = 1_000;
    const clock = new HybridClock("peer-a", () => now);
    expect(clock.next()).toEqual({ wall: 1_000, counter: 0, peer: "peer-a" });
    expect(clock.next()).toEqual({ wall: 1_000, counter: 1, peer: "peer-a" });
    now = 900;
    expect(clock.next()).toEqual({ wall: 1_000, counter: 2, peer: "peer-a" });
    clock.observe({ wall: 5_000, counter: 7, peer: "peer-b" });
    expect(clock.next()).toEqual({ wall: 5_000, counter: 8, peer: "peer-a" });
    now = 6_000;
    expect(clock.next()).toEqual({ wall: 6_000, counter: 0, peer: "peer-a" });
  });

  test("a change after a restart still beats the version it replaces", async () => {
    const store = new MemoryMeshStore();
    const ahead = version("peer-b", 1, 9_000);
    await store.transaction((tx) => apply(tx, [ahead]));
    // A new process, its wall clock behind the version it edits.
    const clock = new HybridClock("peer-a", () => 1_000);
    const edit = await store.transaction((tx) => change(tx, clock, "peer-a", ahead.item, "y"));
    expect(compareVersions(edit, ahead)).toBeGreaterThan(0);
    expect(store.versions()).toEqual([edit]);
  });
});

test("versions are ordered by wall, counter, then peer id", () => {
  const ordered = [
    version("peer-b", 1, 1),
    { ...version("peer-a", 2, 2), hlc: { wall: 2, counter: 0, peer: "peer-a" } },
    { ...version("peer-b", 2, 2), hlc: { wall: 2, counter: 0, peer: "peer-b" } },
    { ...version("peer-a", 3, 2), hlc: { wall: 2, counter: 1, peer: "peer-a" } },
  ];
  expect(ordered.toReversed().toSorted(compareVersions)).toEqual(ordered);
});

describe("apply", () => {
  test("keeps the newest version of an item, whatever order they come in", async () => {
    const older = version("peer-a", 1, 1_000);
    const newer = version("peer-b", 1, 2_000);
    const one = new MemoryMeshStore();
    const other = new MemoryMeshStore();
    await one.transaction((tx) => apply(tx, [older, newer]));
    await other.transaction((tx) => apply(tx, [newer]));
    await other.transaction((tx) => apply(tx, [older]));
    expect(one.versions()).toEqual([newer]);
    expect(other.versions()).toEqual([newer]);
    // The older one is counted as seen superseded.
    expect(other.vector()).toEqual({ "peer-a": 1, "peer-b": 1 });
  });

  test("a version out of order is applied but not counted, so anti-entropy still sends the one before", async () => {
    const store = new MemoryMeshStore();
    const second = version("peer-a", 2, 2_000, "b");
    const fresh = await store.transaction((tx) => apply(tx, [second]));
    expect(fresh).toEqual([second]);
    expect(store.versions()).toEqual([second]);
    expect(store.vector()).toEqual({});

    // The sender has both; it answers with what this vector does not cover.
    const sender = new MemoryMeshStore();
    const first = version("peer-a", 1, 1_000, "a");
    await sender.transaction((tx) => apply(tx, [first, second]));
    const lacking = await sender.transaction((tx) => tx.notCoveredBy(store.vector()));
    expect(lacking).toContainEqual(first);
    await store.transaction((tx) => apply(tx, lacking, sender.vector()));
    expect(store.versions()).toEqual(sender.versions());
    expect(store.vector()).toEqual({ "peer-a": 2 });
  });

  test("returns only what changed something: a duplicate is not passed on", async () => {
    const store = new MemoryMeshStore();
    const first = version("peer-a", 1, 1_000);
    expect(await store.transaction((tx) => apply(tx, [first]))).toEqual([first]);
    expect(await store.transaction((tx) => apply(tx, [first]))).toEqual([]);
  });

  test("a store's transaction that throws leaves it as it was", async () => {
    const store = new MemoryMeshStore();
    await expect(
      store.transaction(async (tx) => {
        await apply(tx, [version("peer-a", 1, 1_000)]);
        throw new Error("disk full");
      }),
    ).rejects.toThrow("disk full");
    expect(store.versions()).toEqual([]);
    expect(store.vector()).toEqual({});
  });

  test("a peer named __proto__ is just a key", async () => {
    const store = new MemoryMeshStore();
    await store.transaction((tx) => apply(tx, [version("__proto__", 1, 1_000)]));
    expect(Object.entries(store.vector())).toEqual([["__proto__", 1]]);
  });
});

describe("invite", () => {
  test("round-trips a mesh and its addresses", () => {
    const mesh = newMesh();
    const addresses = ["wss://cal.example/mesh", "ws://192.168.1.20:8787"];
    const text = formatInvite({ mesh, addresses });
    expect(text).toMatch(
      /^astrotime-mesh:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}@wss:\/\/cal\.example\/mesh,ws:/,
    );
    expect(parseInvite(` ${text}\n`)).toEqual({ mesh, addresses });
    expect(parseInvite(formatInvite({ mesh, addresses: [] }))).toEqual({ mesh, addresses: [] });
  });

  test("will not carry an address that would not come back as one", () => {
    const mesh = newMesh();
    for (const address of [
      "wss://me@cal.example/mesh",
      "wss://cal.example/mesh?a=1,2",
      "ws://a b",
      "",
    ]) {
      expect(() => formatInvite({ mesh, addresses: [address] }), address).toThrow(RangeError);
    }
  });

  test("refuses what is not one", () => {
    const { id } = newMesh();
    const secret = "A".repeat(43);
    for (const text of [
      "",
      `https://example.com/${id}.${secret}`,
      `astrotime-mesh:${id}`,
      `astrotime-mesh:${id}.${"A".repeat(42)}`,
      `astrotime-mesh:${id}.${secret}.more`,
      `astrotime-mesh:bad id.${secret}`,
      `astrotime-mesh:${id}.${secret}@`,
      `astrotime-mesh:${id}.${secret}@ws://a,,ws://b`,
      `astrotime-mesh:${id}.${secret}@ws://a b`,
    ]) {
      expect(parseInvite(text), text).toBeUndefined();
    }
    expect(parseInvite(`astrotime-mesh:${id}.${secret}@ws://a`)?.addresses).toEqual(["ws://a"]);
  });
});
