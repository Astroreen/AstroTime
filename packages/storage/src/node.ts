// The Node driver: `node:sqlite`, built into Node 24, so tests and the
// Electron app need no native module (docs/plans/foundation.md#D25).
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type { SqlDriver } from "./driver.ts";
import type { Connection } from "./port.ts";

/** A store driver on a database file, or in memory by default. */
export function nodeDriver(path = ":memory:"): SqlDriver {
  const db = new DatabaseSync(path);
  return {
    async query(sql, params) {
      const statement = db.prepare(sql);
      statement.setReturnArrays(true);
      return statement.all(...(params as SQLInputValue[])) as unknown as unknown[][];
    },
    async script(sql) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
  };
}

/**
 * A database file as the store's process serves it to its pages
 * (`portServer`, docs/plans/desktop.md#D73). `committed` is always false:
 * `node:sqlite` has no commit hook, and the one page at a time has nobody
 * to tell.
 */
export function nodeConnection(path = ":memory:"): Connection & { close(): void } {
  const db = new DatabaseSync(path);
  // As every web leader sets its connection up (foundation D98).
  db.exec("PRAGMA foreign_keys = ON;");
  return {
    query(sql, params) {
      const statement = db.prepare(sql);
      statement.setReturnArrays(true);
      return statement.all(...(params as SQLInputValue[])) as unknown as unknown[][];
    },
    script(sql) {
      db.exec(sql);
    },
    inTransaction: () => db.isTransaction,
    committed: () => false,
    close: () => db.close(),
  };
}
