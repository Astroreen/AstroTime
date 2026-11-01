import { HandOverError, transaction, type SqlDriver } from "./driver.ts";

/** Hand-overs in a row a migration step outlasts (docs/plans/foundation.md#D99). */
const HAND_OVERS = 5;

/**
 * The store's schema, one script per version (`PRAGMA user_version`).
 * Never edit a released script; add the next one. `schema.ts` mirrors the
 * result for Drizzle.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    server_url TEXT NOT NULL,
    username TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE calendars (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    components TEXT NOT NULL,
    read_only INTEGER NOT NULL DEFAULT 0,
    sync_token TEXT,
    ctag TEXT
  );
  CREATE UNIQUE INDEX calendars_account_url ON calendars(account_id, url);
  CREATE TABLE objects (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    href TEXT NOT NULL,
    etag TEXT,
    uid TEXT NOT NULL,
    kind TEXT NOT NULL,
    ics TEXT NOT NULL,
    pending TEXT NOT NULL,
    start_ms INTEGER,
    end_ms INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX objects_calendar_href ON objects(calendar_id, href);
  CREATE INDEX objects_calendar_start ON objects(calendar_id, start_ms);
  CREATE TABLE conflicts (
    id TEXT PRIMARY KEY,
    object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    local_ics TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  // 2: the server's version an object's local change started from, for the
  // three-way merge of a refused write (docs/plans/foundation.md#D6).
  `
  ALTER TABLE objects ADD COLUMN base_ics TEXT;
  -- A synced object is its own base; an unsent change's base is unknown.
  UPDATE objects SET base_ics = ics WHERE pending = 'none';
  `,
  // 3: `saveLocal` finds an object by its UID in a calendar.
  `
  CREATE INDEX objects_calendar_uid ON objects(calendar_id, uid);
  `,
  // 4: whether a task's master is done, so finding undone tasks skips the
  // done ones without parsing them (design D51). NULL: written before this
  // migration, parsed to find out.
  `
  ALTER TABLE objects ADD COLUMN done INTEGER;
  `,
  // 5: where discovery found an account's calendars, so a sync starts there
  // instead of discovering again (docs/plans/foundation.md#D90).
  `
  ALTER TABLE accounts ADD COLUMN home_url TEXT;
  `,
  // 6: the titles of an object's components folded for search (design D53),
  // so a search reads one short column instead of parsing every object.
  // NULL: written before this migration, parsed to find out.
  `
  ALTER TABLE objects ADD COLUMN titles TEXT;
  `,
];

/** The database was written by a newer AstroTime; this build must not touch it. */
export class NewerSchemaError extends Error {
  override name = "NewerSchemaError";
}

export async function migrate(
  driver: SqlDriver,
  migrations: readonly string[] = MIGRATIONS,
): Promise<void> {
  await driver.script("PRAGMA foreign_keys = ON;");
  // Each step reads the version in its own transaction: two tabs opening an
  // old database at once migrate it once (docs/plans/foundation.md#D99).
  // A failed step leaves nothing of itself; the steps before it stay.
  // Hand-overs in a row before the opening gives up: the store keeps changing hands.
  let handOvers = 0;
  for (;;) {
    let done: boolean;
    try {
      done = await transaction(driver, async () => {
        const [[read] = [0]] = (await driver.query("PRAGMA user_version", [])) as number[][];
        const version = Number(read);
        if (version > migrations.length) {
          throw new NewerSchemaError(
            `The local store is at schema ${version}; this build knows ${migrations.length}. Update AstroTime.`,
          );
        }
        if (version === migrations.length) return true;
        await driver.script(`${migrations[version]}\nPRAGMA user_version = ${version + 1};`);
        return false;
      });
    } catch (error) {
      // The leader tab went (D98): the step was rolled back, or its COMMIT is
      // in doubt. Reading the version again tells which; never run it twice.
      if (error instanceof HandOverError && ++handOvers < HAND_OVERS) continue;
      throw error;
    }
    handOvers = 0;
    if (done) return;
  }
}

/** The schema version this build writes. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/** @internal The scripts themselves, for the migration tests. */
export const MIGRATIONS_FOR_TESTS = MIGRATIONS;
