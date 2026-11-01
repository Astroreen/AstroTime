import { expect, test } from "vite-plus/test";

import { HandOverError, Store } from "../src/index.ts";
import { webDriver } from "../src/web/index.ts";
import { storeContract } from "./store.contract.ts";

// Each test gets its own database on OPFS, so none sees another's rows.
let n = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${n++}`;
storeContract("sqlite-wasm on OPFS", () => webDriver(unique("test")));

const account = (name: string) => ({
  provider: "caldav" as const,
  name,
  serverUrl: "https://dav.example/",
  username: null,
});

/**
 * Another tab, as far as the store can tell: an iframe of its own, whose
 * worker, locks and channels go with it when it is removed, as a closed
 * tab's do (docs/plans/foundation.md#D98). It loads any file of this origin
 * (not `srcdoc`: the test runner resolves the worker's URL against the
 * page's location), then the driver.
 */
async function tab(): Promise<{ webDriver: typeof webDriver; close: () => void }> {
  const frame = document.createElement("iframe");
  frame.src = new URL("../package.json", import.meta.url).href;
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);
  await loaded;
  const module = new URL("../src/web/index.ts", import.meta.url).href;
  const inside = frame.contentWindow as unknown as { eval: (code: string) => unknown };
  const storage = (await inside.eval(`import(${JSON.stringify(module)})`)) as {
    webDriver: typeof webDriver;
  };
  return { webDriver: storage.webDriver, close: () => frame.remove() };
}

test("a second store on a database follows the first: it reads its rows and hears its writes", async () => {
  const name = unique("shared");
  const first = await Store.open(await webDriver(name));
  const second = await Store.open(await webDriver(name));
  const heard = new Promise<void>((resolve) => second.subscribe(resolve));
  const added = await first.addAccount(account("First"));
  await heard;
  expect(await second.accounts()).toEqual([added]);
  // And the other way: the follower writes through the leader.
  const back = new Promise<void>((resolve) => first.subscribe(resolve));
  await second.removeAccount(added.id);
  await back;
  expect(await first.accounts()).toEqual([]);
});

test("two stores opening a new database at once migrate it once", async () => {
  const name = unique("migrated");
  const drivers = await Promise.all([webDriver(name), webDriver(name)]);
  const [first, second] = await Promise.all(drivers.map((driver) => Store.open(driver)));
  const added = await first!.addAccount(account("Once"));
  expect(await second!.accounts()).toEqual([added]);
});

test("a transaction of one store holds the other stores' statements until it ends", async () => {
  const name = unique("isolated");
  const first = await webDriver(name);
  const second = await webDriver(name);
  await first.script("CREATE TABLE t (x);");
  await first.script("BEGIN IMMEDIATE;");
  await first.query("INSERT INTO t VALUES (1)", []);
  const counted = second.query("SELECT count(*) FROM t", []);
  await first.query("INSERT INTO t VALUES (2)", []);
  await first.script("COMMIT;");
  // Neither before the transaction nor inside it: after.
  expect(await counted).toEqual([[2]]);
});

test("closing the leader hands the database to the next store, which keeps working", async () => {
  const name = unique("handed");
  const first = await Store.open(await webDriver(name));
  const second = await Store.open(await webDriver(name));
  await first.addAccount(account("Kept"));
  await first.close();
  await second.addAccount(account("Added"));
  const names = async (store: Store) => (await store.accounts()).map((a) => a.name).toSorted();
  expect(await names(second)).toEqual(["Added", "Kept"]);
  // The next store follows the new leader.
  const third = await Store.open(await webDriver(name));
  expect(await names(third)).toEqual(["Added", "Kept"]);
});

test("a statement waiting at a leader that closes runs once, at the next leader", async () => {
  const name = unique("waiting");
  const first = await webDriver(name);
  const second = await webDriver(name);
  await first.script("CREATE TABLE t (x);");
  // The leader's own transaction holds the follower's statement back.
  await first.script("BEGIN IMMEDIATE;");
  await first.query("INSERT INTO t VALUES ('first')", []);
  const waiting = second.query("INSERT INTO t VALUES ('second')", []);
  await first.close();
  await waiting;
  // The closed leader's open transaction left nothing; the waiting statement ran once.
  expect(await second.query("SELECT x FROM t", [])).toEqual([["second"]]);
});

test("a transaction the leader tab took with it is over: its statements fail until its ROLLBACK", async () => {
  const name = unique("lost");
  const other = await tab();
  await other.webDriver(name);
  const ours = await webDriver(name);
  await ours.script("CREATE TABLE t (x);");
  await ours.script("BEGIN IMMEDIATE;");
  await ours.query("INSERT INTO t VALUES (1)", []);
  other.close();
  // On its way when the leader went, then refused: the transaction is gone.
  await expect(ours.query("INSERT INTO t VALUES (2)", [])).rejects.toThrow(HandOverError);
  await expect(ours.query("INSERT INTO t VALUES (3)", [])).rejects.toThrow(/transaction/);
  await expect(ours.script("COMMIT;")).rejects.toThrow(HandOverError);
  // Ended: the store is whole again, without any of it.
  expect(await ours.query("SELECT x FROM t", [])).toEqual([]);
});

test("what is written survives closing and reopening the database on OPFS", async () => {
  const name = unique("kept");
  const first = await Store.open(await webDriver(name));
  const added = await first.addAccount(account("Kept"));
  await first.close();
  const second = await Store.open(await webDriver(name));
  expect(await second.accounts()).toEqual([added]);
  await second.close();
});
