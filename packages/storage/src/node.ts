// The Node driver: `node:sqlite`, built into Node 24, so tests and the
// Electron app need no native module (docs/plans/foundation.md#D25).
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type { SqlDriver } from "./driver.ts";

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
