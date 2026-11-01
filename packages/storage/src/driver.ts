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
  /**
   * Calls `listener` when someone else changed the database (another tab, on
   * the web: docs/plans/foundation.md#D98), so the store tells its own
   * listeners. Returns the function that stops it. A driver whose database
   * no one else writes has none.
   */
  subscribe?(listener: () => void): () => void;
}

/** Runs `operation` in a transaction of its own, rolled back if it fails. */
export async function transaction<T>(driver: SqlDriver, operation: () => Promise<T>): Promise<T> {
  await driver.script("BEGIN IMMEDIATE;");
  try {
    const result = await operation();
    await driver.script("COMMIT;");
    return result;
  } catch (error) {
    // A statement that failed may have ended the transaction already.
    await driver.script("ROLLBACK;").catch(() => {});
    throw error;
  }
}

/**
 * A statement got no answer because the tab that ran the web store's
 * database went (docs/plans/foundation.md#D98): it may or may not have run,
 * or the transaction it belonged to is over. The store works again at once,
 * through the next tab.
 */
export class HandOverError extends Error {
  override name = "HandOverError";
}

/**
 * The page is not a secure context (plain `http` beyond localhost), where
 * browsers offer neither OPFS nor Web Locks, so the web store cannot open.
 */
export class InsecureContextError extends Error {
  override name = "InsecureContextError";
}
