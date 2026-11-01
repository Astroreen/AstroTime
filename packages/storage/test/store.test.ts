import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vite-plus/test";

import { HandOverError, handOverIn, Store, type SqlDriver } from "../src/index.ts";
import { nodeDriver } from "../src/node.ts";
import { storeContract } from "./store.contract.ts";

storeContract("node:sqlite", () => nodeDriver());

test("what is written survives closing and reopening the database file", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "astrotime-store-")), "store.sqlite3");
  const first = await Store.open(nodeDriver(path));
  const account = await first.addAccount({
    provider: "caldav",
    name: "Kept",
    serverUrl: "https://dav.example/",
    username: null,
  });
  await first.close();
  const second = await Store.open(nodeDriver(path));
  expect(await second.accounts()).toEqual([account]);
  await second.close();
});

test("a statement the leader tab took with it: a write fails with the hand-over itself, a read with it inside (D99)", async () => {
  const inner = nodeDriver();
  let fail = false;
  const driver: SqlDriver = {
    query: async (sql, params) => {
      if (fail && /^(select|insert)/i.test(sql)) {
        fail = false;
        throw new HandOverError("The leader went.");
      }
      return inner.query(sql, params);
    },
    script: (sql) => inner.script(sql),
    close: () => inner.close(),
  };
  const store = await Store.open(driver);
  const input = {
    provider: "caldav" as const,
    name: "A",
    serverUrl: "https://dav.example/",
    username: null,
  };
  fail = true;
  // Inside a transaction: what the caller retries on (nothing was written).
  await expect(store.addAccount(input)).rejects.toBeInstanceOf(HandOverError);
  fail = true;
  const read = await store.accounts().catch((error: unknown) => error);
  expect(read).not.toBeInstanceOf(HandOverError);
  expect(handOverIn(read)).toBeInstanceOf(HandOverError);
  expect(await store.accounts()).toEqual([]);
});
