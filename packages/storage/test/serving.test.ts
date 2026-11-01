// The leader's side of the web store (docs/plans/foundation.md#D98) on
// `node:sqlite`: one tab's transaction at a time, and a tab that goes never
// holds the others, whatever its ROLLBACK says. Commits are announced from
// sqlite-wasm's commit hook, which the browser tests cover.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { expect, test } from "vite-plus/test";

import type { Reply, Request } from "../src/web/protocol.ts";
import { serving } from "../src/web/serving.ts";

function leader() {
  const db = new DatabaseSync(":memory:");
  let rollbackFails = false;
  const replies: { client: string; reply: Reply }[] = [];
  const served = serving(
    {
      query(sql, params) {
        const statement = db.prepare(sql);
        statement.setReturnArrays(true);
        return statement.all(...(params as SQLInputValue[])) as unknown as unknown[][];
      },
      script(sql) {
        if (rollbackFails && /^ROLLBACK/i.test(sql)) throw new Error("cannot rollback");
        db.exec(sql);
      },
      inTransaction: () => db.isTransaction,
      committed: () => false,
    },
    { reply: (client, reply) => replies.push({ client, reply }), changed: () => {} },
  );
  let ids = 0;
  const send = (client: string, sql: string): number => {
    const request: Request = { id: ids++, type: "query", sql, params: [] };
    served.receive(client, request);
    return request.id;
  };
  const answered = (id: number) =>
    replies.find(({ reply }) => reply.type === "result" && reply.id === id)?.reply;
  return { db, served, send, answered, failRollback: () => (rollbackFails = true) };
}

test("a statement of another tab waits for the open transaction, and runs once it ends", () => {
  const { send, answered } = leader();
  send("a", "CREATE TABLE t (x)");
  send("a", "BEGIN IMMEDIATE");
  send("a", "INSERT INTO t VALUES (1)");
  const count = send("b", "SELECT count(*) FROM t");
  expect(answered(count)).toBeUndefined();
  send("a", "COMMIT");
  expect(answered(count)).toMatchObject({ rows: [[1]], transaction: false });
});

test("a tab gone mid-transaction is rolled back and the others go on, even when its ROLLBACK fails", () => {
  const { served, send, answered, failRollback } = leader();
  send("a", "CREATE TABLE t (x)");
  send("a", "BEGIN IMMEDIATE");
  send("a", "INSERT INTO t VALUES (1)");
  const count = send("b", "SELECT count(*) FROM t");
  served.gone("a");
  expect(answered(count)).toMatchObject({ rows: [[0]], transaction: false });

  // A ROLLBACK that fails leaves nobody waiting on a tab that is gone either.
  send("a", "BEGIN IMMEDIATE");
  const held = send("b", "SELECT count(*) FROM t");
  failRollback();
  served.gone("a");
  expect(answered(held)).toBeDefined();
});

test("a tab gone drops its waiting statements; the others' still run", () => {
  const { served, send, answered } = leader();
  send("a", "CREATE TABLE t (x)");
  send("a", "BEGIN IMMEDIATE");
  const theirs = send("b", "INSERT INTO t VALUES ('b')");
  const dropped = send("c", "INSERT INTO t VALUES ('c')");
  served.gone("c");
  served.gone("a");
  expect(answered(theirs)).toMatchObject({ transaction: false });
  expect(answered(dropped)).toBeUndefined();
  const rows = send("b", "SELECT x FROM t");
  expect(answered(rows)).toMatchObject({ rows: [["b"]] });
});

test("closing rolls back an open transaction, even when ROLLBACK fails, and runs nothing more", () => {
  const { db, served, send, answered } = leader();
  send("a", "CREATE TABLE t (x)");
  send("a", "BEGIN IMMEDIATE");
  send("a", "INSERT INTO t VALUES (1)");
  const waiting = send("b", "SELECT count(*) FROM t");
  served.close();
  expect(db.isTransaction).toBe(false);
  expect(answered(waiting)).toBeUndefined();

  const other = leader();
  other.send("a", "BEGIN IMMEDIATE");
  other.failRollback();
  expect(() => other.served.close()).not.toThrow();
});
