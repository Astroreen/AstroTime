/**
 * What the store needs from a SQLite engine (docs/plans/foundation.md#D25).
 * Each platform brings one: `node:sqlite` (`@astrotime/storage/node`, tests
 * and the desktop's store process), sqlite-wasm on OPFS
 * (`@astrotime/storage/web`, the web and Android's WebView,
 * docs/plans/android.md#D63), and a port to the desktop's store process
 * (`@astrotime/storage/port`, its page, docs/plans/desktop.md#D73).
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
 * through the next tab. A store operation that fails with it left nothing of
 * itself (its transaction was rolled back, D99), unless it is a
 * `CommitInDoubtError`.
 */
export class HandOverError extends Error {
  override name = "HandOverError";
}

/**
 * A transaction's COMMIT was on its way when the tab running the web store
 * went (docs/plans/foundation.md#D99): it may or may not have committed, and
 * nothing can tell which. Read the store again before trying again; never
 * assume either.
 */
export class CommitInDoubtError extends HandOverError {
  override name = "CommitInDoubtError";
}

/**
 * The page is not a secure context (plain `http` beyond localhost), where
 * browsers offer neither OPFS nor Web Locks, so the web store cannot open.
 */
export class InsecureContextError extends Error {
  override name = "InsecureContextError";
}
