// The proof of the mesh (docs/plans/server.md#D290): peers over the
// in-memory network converge, whatever is up, partitioned or edited when;
// a peer without the secret is refused before any data; a sealed frame
// tampered with or replayed does not open.
import { describe, expect, test } from "vite-plus/test";

import { compareVersions, type Item, itemKey, newMesh, type Version } from "../src/index.ts";
import type { Frame } from "../src/memory.ts";
import { addressOf, Harness } from "./harness.ts";

const lunch: Item = { calendar: "personal", object: "lunch@astrotime" };
const event = (summary: string) =>
  `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:lunch@astrotime\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

test("the owner's scenario: B gets A's edit from C, A never online with it", async () => {
  const mesh = new Harness();
  mesh.add("peer-c", { listens: true, invitedBy: [] });
  mesh.add("peer-a", { listens: false, invitedBy: ["peer-c"] });
  mesh.add("peer-b", { listens: false, invitedBy: ["peer-c"] });

  await mesh.up("peer-c");
  await mesh.up("peer-a");
  await mesh.settle();
  const edit = await mesh.node("peer-a").change(lunch, event("Lunch with Ann"));
  await mesh.settle();
  mesh.down("peer-a");
  await mesh.settle();

  await mesh.up("peer-b");
  await mesh.settle();

  expect(mesh.versions("peer-b")).toEqual([edit]);
  expect(mesh.versions("peer-c")).toEqual([edit]);
  expect(
    mesh.connections.some(({ peer, peers }) => peer === "peer-b" && peers.includes("peer-a")),
  ).toBe(false);

  // And back: B's edit waits on C for A's next start.
  mesh.time += 60_000;
  const reply = await mesh.node("peer-b").change(lunch, event("Lunch with Ann and Bo"));
  await mesh.settle();
  mesh.down("peer-b");
  await mesh.up("peer-a");
  await mesh.settle();
  expect(mesh.versions("peer-a")).toEqual([reply]);
  expect(mesh.errors).toEqual([]);
});

test("concurrent edits of one item converge on every peer to the newest", async () => {
  const mesh = new Harness();
  mesh.add("peer-c", { listens: true, invitedBy: [] });
  mesh.add("peer-a", { listens: false, invitedBy: ["peer-c"], skew: 5_000 });
  mesh.add("peer-b", { listens: false, invitedBy: ["peer-c"] });
  for (const name of ["peer-c", "peer-a", "peer-b"]) await mesh.up(name);
  await mesh.settle();

  mesh.network.partition(["peer-a"], ["peer-b", "peer-c"]);
  await mesh.settle(1);
  // A's clock runs ahead, so its edit is newer though made earlier.
  const a = await mesh.node("peer-a").change(lunch, event("A's lunch"));
  mesh.time += 1_000;
  const b = await mesh.node("peer-b").change(lunch, event("B's lunch"));
  await mesh.settle(1);
  expect(mesh.versions("peer-c")).toEqual([b]);

  mesh.network.heal();
  await mesh.settle();
  for (const name of ["peer-a", "peer-b", "peer-c"]) expect(mesh.versions(name)).toEqual([a]);
});

test("one HLC wall and counter: the peer id breaks the tie the same way everywhere", async () => {
  const mesh = new Harness();
  mesh.add("peer-c", { listens: true, invitedBy: [] });
  mesh.add("peer-a", { listens: false, invitedBy: ["peer-c"] });
  mesh.add("peer-b", { listens: false, invitedBy: ["peer-c"] });
  for (const name of ["peer-c", "peer-a", "peer-b"]) await mesh.up(name);
  mesh.network.partition(["peer-a"], ["peer-b"], ["peer-c"]);
  await mesh.settle(1);

  const a = await mesh.node("peer-a").change(lunch, event("A"));
  const b = await mesh.node("peer-b").change(lunch, event("B"));
  expect([a.hlc.wall, a.hlc.counter]).toEqual([b.hlc.wall, b.hlc.counter]);

  mesh.network.heal();
  await mesh.settle();
  for (const name of ["peer-a", "peer-b", "peer-c"]) expect(mesh.versions(name)).toEqual([b]);
});

test("deletions converge: a tombstone wins over the older version, and loses to a newer edit", async () => {
  const mesh = new Harness();
  mesh.add("peer-c", { listens: true, invitedBy: [] });
  mesh.add("peer-a", { listens: false, invitedBy: ["peer-c"] });
  mesh.add("peer-b", { listens: false, invitedBy: ["peer-c"] });
  for (const name of ["peer-c", "peer-a", "peer-b"]) await mesh.up(name);
  await mesh.settle();

  const dinner: Item = { calendar: "personal", object: "dinner@astrotime" };
  await mesh.node("peer-a").change(lunch, event("Lunch"));
  await mesh.node("peer-a").change(dinner, event("Dinner"));
  await mesh.settle();

  mesh.time += 1_000;
  const deleted = await mesh.node("peer-b").change(lunch, null);
  await mesh.settle();
  for (const name of ["peer-a", "peer-b", "peer-c"]) {
    expect(mesh.versions(name).find((version) => itemKey(version.item) === itemKey(lunch))).toEqual(
      deleted,
    );
  }

  // Offline, A deletes dinner and B edits it later: the edit is newer.
  mesh.network.partition(["peer-a"], ["peer-b", "peer-c"]);
  await mesh.settle(1);
  mesh.time += 1_000;
  await mesh.node("peer-a").change(dinner, null);
  mesh.time += 1_000;
  const kept = await mesh.node("peer-b").change(dinner, event("Dinner at eight"));
  mesh.network.heal();
  await mesh.settle();
  for (const name of ["peer-a", "peer-b", "peer-c"])
    expect(mesh.versions(name)).toEqual([kept, deleted].toSorted(byItem));
});

test("calendars are versioned as their objects are", async () => {
  const mesh = new Harness();
  mesh.add("peer-c", { listens: true, invitedBy: [] });
  mesh.add("peer-a", { listens: false, invitedBy: ["peer-c"] });
  await mesh.up("peer-c");
  await mesh.up("peer-a");
  const calendar = await mesh
    .node("peer-c")
    .change({ calendar: "work" }, '{"name":"Work","color":"#0b8043"}');
  await mesh.settle();
  expect(mesh.versions("peer-a")).toEqual([calendar]);
});

test("a peer learns the whole mesh's listening addresses from one", async () => {
  const mesh = new Harness();
  mesh.add("peer-c", { listens: true, invitedBy: [] });
  mesh.add("peer-d", { listens: true, invitedBy: ["peer-c"] });
  mesh.add("peer-a", { listens: false, invitedBy: ["peer-c"] });
  for (const name of ["peer-c", "peer-d", "peer-a"]) await mesh.up(name);
  await mesh.settle();

  expect((await mesh.stores.get("peer-a")!.addresses()).toSorted()).toEqual([
    addressOf("peer-c"),
    addressOf("peer-d"),
  ]);
  expect(mesh.network.connected("peer-a", "peer-d")).toBe(1);
  // C and D dialled each other: one connection is kept.
  expect(mesh.network.connected("peer-c", "peer-d")).toBe(1);
  // Its own address, gossiped back, C never dials.
  expect(mesh.network.connected("peer-c", "peer-c")).toBe(0);

  // C goes down: A still reaches D, and a change of D's reaches A.
  mesh.down("peer-c");
  await mesh.settle();
  const version = await mesh.node("peer-d").change(lunch, event("Lunch"));
  await mesh.settle();
  expect(mesh.versions("peer-a")).toEqual([version]);
});

test("a wrong secret is refused before any sealed frame", async () => {
  const mesh = new Harness();
  const frames: Frame[] = [];
  mesh.network.tap = (frame) => {
    frames.push(frame);
    return frame.text;
  };
  const stranger = { ...newMesh(), id: mesh.mesh.id };
  mesh.add("peer-c", { listens: true, invitedBy: [] });
  mesh.add("peer-x", { listens: false, invitedBy: ["peer-c"], mesh: stranger });
  await mesh.up("peer-c");
  await mesh.node("peer-c").change(lunch, event("Private"));
  await mesh.up("peer-x");
  await mesh.settle(3);

  expect(frames.length).toBeGreaterThan(0);
  expect(new Set(frames.map(({ text }) => (JSON.parse(text) as { type: string }).type))).toEqual(
    new Set(["challenge", "proof", "refusal"]),
  );
  expect(mesh.versions("peer-x")).toEqual([]);
  expect(mesh.connections).toEqual([]);
  expect(mesh.network.connected("peer-c", "peer-x")).toBe(0);
  // X keeps redialling, with backoff, and keeps being refused.
  expect(mesh.timers.size).toBe(1);
});

test("a frame of another mesh id is refused before any proof", async () => {
  const mesh = new Harness();
  const types: string[] = [];
  mesh.network.tap = (frame) => {
    types.push((JSON.parse(frame.text) as { type: string }).type);
    return frame.text;
  };
  mesh.add("peer-c", { listens: true, invitedBy: [] });
  mesh.add("peer-x", { listens: false, invitedBy: ["peer-c"], mesh: newMesh() });
  await mesh.up("peer-c");
  await mesh.up("peer-x");
  await mesh.settle(1);
  expect(types.length).toBeGreaterThan(0);
  expect(types.every((type) => type === "challenge" || type === "refusal")).toBe(true);
  expect(types).toContain("refusal");
});

describe("a sealed frame changed on the way", () => {
  async function connected() {
    const mesh = new Harness();
    mesh.add("peer-c", { listens: true, invitedBy: [] });
    mesh.add("peer-a", { listens: false, invitedBy: ["peer-c"] });
    await mesh.up("peer-c");
    await mesh.up("peer-a");
    await mesh.settle();
    return mesh;
  }

  /** Changes the next sealed frame from A to C, once; returns what C was handed. */
  function interfere(mesh: Harness, change: (frame: Frame, earlier: Frame[]) => string) {
    const earlier: Frame[] = [];
    const handed: string[] = [];
    let done = false;
    mesh.network.tap = (frame) => {
      const sealed = frame.from === "peer-a" && frame.text.includes('"sealed"');
      if (!sealed || done) {
        if (sealed) earlier.push(frame);
        return frame.text;
      }
      done = true;
      const text = change(frame, earlier);
      handed.push(text);
      return text;
    };
    return handed;
  }

  test("tampered: C rejects it, closes, and has the edit only from the next connection", async () => {
    const mesh = await connected();
    const handed = interfere(mesh, (frame) => {
      const { data } = JSON.parse(frame.text) as { data: string };
      const flipped = (data[10] === "A" ? "B" : "A") + data.slice(11);
      return JSON.stringify({ type: "sealed", data: data.slice(0, 10) + flipped });
    });

    const edit = await mesh.node("peer-a").change(lunch, event("Lunch"));
    await mesh.settle();

    expect(handed).toHaveLength(1);
    expect(mesh.errors.map(({ peer, error }) => [peer, (error as Error).name])).toEqual([
      ["peer-c", "OperationError"],
    ]);
    // C dropped the connection; A dialled again, and anti-entropy brought the edit.
    const cPeers = mesh.connections
      .filter(({ peer }) => peer === "peer-c")
      .map(({ peers }) => peers);
    expect(cPeers).toEqual([["peer-a"], [], ["peer-a"]]);
    expect(mesh.versions("peer-c")).toEqual([edit]);
  });

  test("replayed: an earlier frame in a later one's place does not open", async () => {
    const mesh = await connected();
    // The hello went before the tap; send one push, then replay it in the next one's place.
    const first = await mesh.node("peer-a").change(lunch, event("Lunch"));
    await mesh.settle();
    const pushed: Frame[] = [];
    mesh.network.tap = (frame) => {
      if (frame.from !== "peer-a" || !frame.text.includes('"sealed"')) return frame.text;
      pushed.push(frame);
      return pushed.length === 2 ? pushed[0]!.text : frame.text;
    };
    await mesh.node("peer-a").change(lunch, event("Lunch, again"));
    await mesh.node("peer-a").change({ calendar: "personal", object: "tea" }, event("Tea"));
    await mesh.settle();
    expect(mesh.errors.map(({ peer }) => peer)).toEqual(["peer-c"]);
    expect(mesh.versions("peer-c")).toEqual(mesh.versions("peer-a"));
    expect(mesh.versions("peer-c")).not.toContainEqual(first);
  });
});

/** A seeded PRNG (mulberry32), so a failing run can be run again. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (below: number) => Math.floor(next() * below),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
  };
}

const byItem = (a: Version, b: Version) => {
  const [x, y] = [itemKey(a.item), itemKey(b.item)];
  return x < y ? -1 : x > y ? 1 : 0;
};

describe("five peers through random partitions, outages and edits", () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "seed %i: every store ends equal, each item at its newest version",
    async (seed) => {
      const rng = random(seed);
      const mesh = new Harness();
      const names = ["peer-0", "peer-1", "peer-2", "peer-3", "peer-4"];
      for (const [index, name] of names.entries()) {
        // Three listen (a server, two desktops); two only dial (a browser, a phone).
        mesh.add(name, { listens: index < 3, invitedBy: ["peer-0"], skew: rng.int(4_000) - 2_000 });
      }
      for (const name of names) await mesh.up(name);
      await mesh.settle();

      const items: Item[] = [
        { calendar: "personal" },
        { calendar: "work" },
        ...["a", "b", "c", "d"].map((object) => ({ calendar: "personal", object })),
        ...["e", "f"].map((object) => ({ calendar: "work", object })),
      ];
      const made: Version[] = [];
      for (let step = 0; step < 150; step += 1) {
        const roll = rng.next();
        const up = names.filter((name) => mesh.nodes.has(name));
        if (roll < 0.45 && up.length > 0) {
          const body = rng.next() < 0.15 ? null : `text ${seed}.${step}`;
          made.push(await mesh.node(rng.pick(up)).change(rng.pick(items), body));
        } else if (roll < 0.6) {
          const groups: string[][] = [[], [], []];
          for (const name of names) groups[rng.int(3)]!.push(name);
          mesh.network.partition(...groups);
        } else if (roll < 0.7) {
          mesh.network.heal();
        } else if (roll < 0.8) {
          const name = rng.pick(names);
          if (mesh.nodes.has(name)) mesh.down(name);
          else await mesh.up(name);
        } else if (roll < 0.9) {
          mesh.time += rng.int(5_000);
        } else {
          mesh.timers.fire();
        }
        await mesh.network.quiet();
      }

      mesh.network.heal();
      for (const name of names) if (!mesh.nodes.has(name)) await mesh.up(name);
      await mesh.settle();
      expect(mesh.timers.size).toBe(0);

      const newest = new Map<string, Version>();
      for (const version of made) {
        const key = itemKey(version.item);
        const known = newest.get(key);
        if (!known || compareVersions(version, known) > 0) newest.set(key, version);
      }
      const expected = [...newest.values()].toSorted(byItem);
      expect(made.length).toBeGreaterThan(30);
      for (const name of names) expect(mesh.versions(name)).toEqual(expected);
      expect(mesh.errors).toEqual([]);
    },
  );
});

describe("clocks more than five minutes apart (D284)", () => {
  test("a peer whose clock is off is refused in the handshake, and says why", async () => {
    const mesh = new Harness();
    mesh.add("peer-c", { listens: true, invitedBy: [] });
    mesh.add("peer-a", { listens: false, invitedBy: ["peer-c"], skew: 4 * 60_000 });
    mesh.add("peer-x", { listens: false, invitedBy: ["peer-c"], skew: -(5 * 60_000 + 1) });
    for (const name of ["peer-c", "peer-a", "peer-x"]) await mesh.up(name);
    await mesh.node("peer-c").change(lunch, event("Lunch"));
    await mesh.settle(2);

    expect(mesh.node("peer-c").peers()).toEqual(["peer-a"]);
    expect(mesh.versions("peer-x")).toEqual([]);
    expect(new Set(mesh.refusals.map(({ peer, reason }) => `${peer} ${reason}`))).toEqual(
      new Set(["peer-c clock", "peer-x clock"]),
    );

    // Its clock set right, it joins at its next redial.
    mesh.skews.set("peer-x", 0);
    await mesh.settle();
    expect(mesh.versions("peer-x")).toEqual(mesh.versions("peer-c"));
  });

  test("a version stamped more than five minutes ahead closes the connection, unapplied", async () => {
    const mesh = new Harness();
    mesh.add("peer-c", { listens: true, invitedBy: [] });
    mesh.add("peer-a", { listens: false, invitedBy: ["peer-c"] });
    await mesh.up("peer-c");
    await mesh.up("peer-a");
    await mesh.settle();

    mesh.skews.set("peer-a", 10 * 60_000);
    await mesh.node("peer-a").change(lunch, event("From the future"));
    await mesh.settle(2);

    expect(mesh.versions("peer-c")).toEqual([]);
    expect(mesh.errors.map(({ peer, error }) => [peer, (error as Error).name])).toEqual([
      ["peer-c", "ClockAheadError"],
    ]);
    expect(mesh.refusals.map(({ peer }) => peer)).toContain("peer-c");
    expect(mesh.node("peer-c").peers()).toEqual([]);
  });
});

test("a deletion against a concurrent older edit: the tombstone wins everywhere", async () => {
  const mesh = new Harness();
  mesh.add("peer-c", { listens: true, invitedBy: [] });
  mesh.add("peer-a", { listens: false, invitedBy: ["peer-c"] });
  mesh.add("peer-b", { listens: false, invitedBy: ["peer-c"] });
  for (const name of ["peer-c", "peer-a", "peer-b"]) await mesh.up(name);
  await mesh.node("peer-c").change(lunch, event("Lunch"));
  await mesh.settle();

  mesh.network.partition(["peer-a"], ["peer-b", "peer-c"]);
  await mesh.settle(1);
  await mesh.node("peer-a").change(lunch, event("Lunch, moved"));
  mesh.time += 1_000;
  const deleted = await mesh.node("peer-b").change(lunch, null);
  mesh.network.heal();
  await mesh.settle();
  for (const name of ["peer-a", "peer-b", "peer-c"]) expect(mesh.versions(name)).toEqual([deleted]);
});

test("a calendar renamed on two peers at once converges to the newer name", async () => {
  const mesh = new Harness();
  mesh.add("peer-c", { listens: true, invitedBy: [] });
  mesh.add("peer-a", { listens: false, invitedBy: ["peer-c"] });
  mesh.add("peer-b", { listens: false, invitedBy: ["peer-c"] });
  for (const name of ["peer-c", "peer-a", "peer-b"]) await mesh.up(name);
  const work = { calendar: "work" };
  await mesh.node("peer-c").change(work, '{"name":"Work"}');
  await mesh.settle();

  mesh.network.partition(["peer-a"], ["peer-b"], ["peer-c"]);
  await mesh.settle(1);
  mesh.time += 1_000;
  const office = await mesh.node("peer-b").change(work, '{"name":"Office"}');
  mesh.time += 1_000;
  const job = await mesh.node("peer-a").change(work, '{"name":"Job"}');
  expect(compareVersions(job, office)).toBeGreaterThan(0);
  mesh.network.heal();
  await mesh.settle();
  for (const name of ["peer-a", "peer-b", "peer-c"]) expect(mesh.versions(name)).toEqual([job]);
});
