import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vite-plus/test";

import { Store } from "../src/index.ts";
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
