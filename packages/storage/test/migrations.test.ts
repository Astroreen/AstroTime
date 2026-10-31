import { expect, test } from "vite-plus/test";

import { migrate, NewerSchemaError, SCHEMA_VERSION } from "../src/migrations.ts";
import { nodeDriver } from "../src/node.ts";

test("a failing migration leaves nothing of itself and the version unchanged", async () => {
  const driver = nodeDriver();
  const migrations = ["CREATE TABLE a (x);", "CREATE TABLE b (y); INSERT INTO nowhere VALUES (1);"];
  await expect(migrate(driver, migrations)).rejects.toThrow(/nowhere/);
  expect(await driver.query("PRAGMA user_version", [])).toEqual([[1]]);
  expect(
    await driver.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", []),
  ).toEqual([["a"]]);
  // The connection is usable again: no transaction was left open.
  await migrate(driver, ["CREATE TABLE a (x);", "CREATE TABLE b (y);"]);
  expect(await driver.query("PRAGMA user_version", [])).toEqual([[2]]);
});

test("a database from a newer build is refused, not touched", async () => {
  const driver = nodeDriver();
  await driver.script(`PRAGMA user_version = ${SCHEMA_VERSION + 1};`);
  await expect(migrate(driver)).rejects.toThrow(NewerSchemaError);
  expect(await driver.query("SELECT count(*) FROM sqlite_master", [])).toEqual([[0]]);
});
