import { expect, test } from "vite-plus/test";

import { CommitInDoubtError, HandOverError, type SqlDriver } from "../src/driver.ts";
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

test("a step cut off by a hand-over is read again: run once if it committed, again if not", async () => {
  // The web store's leader tab goes (docs/plans/foundation.md#D99): the first
  // step's COMMIT is in doubt though it went through, the second step's
  // statement fails and its transaction is rolled back.
  const inner = nodeDriver();
  const failures: Record<string, Error> = {
    "COMMIT;": new CommitInDoubtError("its answer went with the leader"),
    "CREATE TABLE b (y);\nPRAGMA user_version = 2;": new HandOverError("the leader went"),
  };
  const driver: SqlDriver = {
    ...inner,
    async script(sql) {
      const failure = failures[sql];
      delete failures[sql];
      if (failure instanceof CommitInDoubtError) await inner.script(sql);
      if (failure) throw failure;
      await inner.script(sql);
    },
  };
  await migrate(driver, ["CREATE TABLE a (x);", "CREATE TABLE b (y);"]);
  expect(await driver.query("PRAGMA user_version", [])).toEqual([[2]]);
  expect(
    await driver.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", []),
  ).toEqual([["a"], ["b"]]);
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

test("migration 4 leaves done unknown on older rows, so the undone query still parses them", async () => {
  const { MIGRATIONS_FOR_TESTS } = await import("../src/migrations.ts");
  const { Store } = await import("../src/index.ts");
  const driver = nodeDriver();
  await migrate(driver, MIGRATIONS_FOR_TESTS.slice(0, 3));
  const ics = (uid: string, extra: string) =>
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:${uid}\r\nDUE;VALUE=DATE:20261102\r\n${extra}END:VTODO\r\nEND:VCALENDAR\r\n`;
  const start = Date.parse("2026-11-01T10:00:00Z");
  await driver.query("INSERT INTO accounts VALUES ('a', 'caldav', 'A', 'https://x/', NULL, 0)", []);
  await driver.query(
    "INSERT INTO calendars (id, account_id, url, name, components) VALUES ('c', 'a', 'https://x/c/', 'C', 'VTODO')",
    [],
  );
  for (const [uid, extra] of [
    ["open", ""],
    ["closed", "STATUS:COMPLETED\r\n"],
  ] as const) {
    await driver.query(
      "INSERT INTO objects (id, calendar_id, href, uid, kind, ics, pending, start_ms, end_ms, updated_at) VALUES (?, 'c', ?, ?, 'task', ?, 'none', ?, ?, 0)",
      [uid, `${uid}.ics`, uid, ics(uid, extra), start, start + 86_400_000],
    );
  }
  const store = await Store.open(driver);
  expect(await driver.query("SELECT id, done FROM objects ORDER BY id", [])).toEqual([
    ["closed", null],
    ["open", null],
  ]);
  expect(
    (await store.undoneTasksBefore(["c"], "2026-11-04", "UTC")).map((u) => u.object.uid),
  ).toEqual(["open"]);
});

test("migration 5 keeps existing accounts, with no calendar home until they sync", async () => {
  const { MIGRATIONS_FOR_TESTS } = await import("../src/migrations.ts");
  const { Store } = await import("../src/index.ts");
  const driver = nodeDriver();
  await migrate(driver, MIGRATIONS_FOR_TESTS.slice(0, 4));
  await driver.query("INSERT INTO accounts VALUES ('a', 'caldav', 'A', 'https://x/', 'u', 0)", []);
  const store = await Store.open(driver);
  expect(await store.accounts()).toEqual([
    {
      id: "a",
      provider: "caldav",
      name: "A",
      serverUrl: "https://x/",
      username: "u",
      createdAt: 0,
      homeUrl: null,
    },
  ]);
});

test("migration 6 leaves titles unknown on older rows, and search still finds them", async () => {
  const { MIGRATIONS_FOR_TESTS } = await import("../src/migrations.ts");
  const { Store } = await import("../src/index.ts");
  const driver = nodeDriver();
  await migrate(driver, MIGRATIONS_FOR_TESTS.slice(0, 5));
  const ics = (uid: string, summary: string) =>
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`;
  await driver.query(
    "INSERT INTO accounts VALUES ('a', 'caldav', 'A', 'https://x/', NULL, 0, NULL)",
    [],
  );
  await driver.query(
    "INSERT INTO calendars (id, account_id, url, name, components) VALUES ('c', 'a', 'https://x/c/', 'C', 'VTODO')",
    [],
  );
  for (const [uid, summary] of [
    ["old", "Позвонить в банк"],
    ["other", "Something else"],
  ] as const) {
    await driver.query(
      "INSERT INTO objects (id, calendar_id, href, uid, kind, ics, pending, updated_at) VALUES (?, 'c', ?, ?, 'task', ?, 'none', 0)",
      [uid, `${uid}.ics`, uid, ics(uid, summary)],
    );
  }
  const store = await Store.open(driver);
  expect(await driver.query("SELECT id, titles FROM objects ORDER BY id", [])).toEqual([
    ["old", null],
    ["other", null],
  ]);
  expect((await store.search(["c"], "БАНК")).map((o) => o.uid)).toEqual(["old"]);
  // The search kept what it read: the older rows have their titles now.
  expect(await driver.query("SELECT id, titles IS NOT NULL FROM objects ORDER BY id", [])).toEqual([
    ["old", 1],
    ["other", 1],
  ]);
  await store.saveFromServer("c", { href: "new.ics", etag: null, ics: ics("new", "Банк, снова") });
  expect((await store.search(["c"], "банк")).map((o) => o.uid)).toEqual(["new", "old"]);
});

test("migration 7 gives a writable calendar every right and a read-only one none; a row an older build writes reads from read_only", async () => {
  const { MIGRATIONS_FOR_TESTS } = await import("../src/migrations.ts");
  const { Store } = await import("../src/index.ts");
  const driver = nodeDriver();
  await migrate(driver, MIGRATIONS_FOR_TESTS.slice(0, 6));
  await driver.query(
    "INSERT INTO accounts VALUES ('a', 'caldav', 'A', 'https://x/', NULL, 0, NULL)",
    [],
  );
  for (const [id, readOnly] of [
    ["mine", 0],
    ["shared", 1],
  ] as const) {
    await driver.query(
      "INSERT INTO calendars (id, account_id, url, name, components, read_only) VALUES (?, 'a', ?, ?, 'VEVENT', ?)",
      [id, `https://x/${id}/`, id, readOnly],
    );
  }
  const store = await Store.open(driver);
  // A tab of an older build on the same store (D98) adds a calendar without rights.
  await driver.query(
    "INSERT INTO calendars (id, account_id, url, name, components, read_only) VALUES ('old', 'a', 'https://x/old/', 'old', 'VEVENT', 1)",
    [],
  );
  const rights = Object.fromEntries((await store.calendars()).map((c) => [c.id, c.rights]));
  expect(rights).toEqual({
    mine: { create: true, edit: true, delete: true },
    shared: { create: false, edit: false, delete: false },
    old: { create: false, edit: false, delete: false },
  });
});
