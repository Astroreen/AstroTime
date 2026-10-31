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

test("migration 2 makes each synced object its own base; an unsent change's base stays unknown", async () => {
  const { MIGRATIONS_FOR_TESTS } = await import("../src/migrations.ts");
  const driver = nodeDriver();
  await migrate(driver, MIGRATIONS_FOR_TESTS.slice(0, 1));
  await driver.script(`
    INSERT INTO accounts VALUES ('a', 'caldav', 'A', 'https://x/', NULL, 0);
    INSERT INTO calendars (id, account_id, url, name, components) VALUES ('c', 'a', 'https://x/c/', 'C', 'VTODO');
    INSERT INTO objects VALUES ('synced', 'c', 's.ics', '"1"', 's', 'task', 'SYNCED', 'none', NULL, NULL, 0);
    INSERT INTO objects VALUES ('unsent', 'c', 'u.ics', '"1"', 'u', 'task', 'UNSENT', 'update', NULL, NULL, 0);
  `);
  await migrate(driver);
  expect(await driver.query("SELECT id, base_ics FROM objects ORDER BY id", [])).toEqual([
    ["synced", "SYNCED"],
    ["unsent", null],
  ]);
});
