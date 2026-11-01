/**
 * What the store needs from a SQLite engine (docs/plans/foundation.md#D25).
 * Each platform brings one: `node:sqlite` (`@astrotime/storage/node`, tests
 * and Electron), sqlite-wasm on OPFS (`@astrotime/storage/web`, the web and
 * Android's WebView, docs/plans/android.md#D63).
 */
export interface SqlDriver {
  /** Runs one statement and returns its rows, each row an array of column values. */
  query(sql: string, params: readonly unknown[]): Promise<unknown[][]>;
  /** Runs a script of several statements; a script that needs a transaction says BEGIN and COMMIT. */
  script(sql: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * The database is held by another open store (another tab, on the web) and
 * cannot be opened here until that one closes it.
 */
export class StoreInUseError extends Error {
  override name = "StoreInUseError";
}

/**
 * The page is not a secure context (plain `http` beyond localhost), where
 * browsers offer neither OPFS nor Web Locks, so the web store cannot open.
 */
export class InsecureContextError extends Error {
  override name = "InsecureContextError";
}
