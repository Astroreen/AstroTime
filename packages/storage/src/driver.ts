/**
 * What the store needs from a SQLite engine (docs/plans/foundation.md#D25).
 * Each platform brings one: `node:sqlite` (`@astrotime/storage/node`, tests
 * and Electron), sqlite-wasm on OPFS (`@astrotime/storage/web`), and later
 * Capacitor's SQLite on Android.
 */
export interface SqlDriver {
  /** Runs one statement and returns its rows, each row an array of column values. */
  query(sql: string, params: readonly unknown[]): Promise<unknown[][]>;
  /** Runs a script of several statements; a script that needs a transaction says BEGIN and COMMIT. */
  script(sql: string): Promise<void>;
  close(): Promise<void>;
}
