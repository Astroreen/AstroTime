import type { SqlDriver } from "./driver.ts";

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
  const [[version] = [0]] = (await driver.query("PRAGMA user_version", [])) as number[][];
  if (Number(version) > migrations.length) {
    throw new NewerSchemaError(
      `The local store is at schema ${version}; this build knows ${migrations.length}. Update AstroTime.`,
    );
  }
  for (let next = Number(version); next < migrations.length; next++) {
    try {
      await driver.script(
        `BEGIN;\n${migrations[next]}\nPRAGMA user_version = ${next + 1};\nCOMMIT;`,
      );
    } catch (error) {
      // A failed script leaves its transaction open; nothing of it may stay.
      await driver.script("ROLLBACK;").catch(() => {});
      throw error;
    }
  }
}

/** The schema version this build writes. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/** @internal The scripts themselves, for the migration tests. */
export const MIGRATIONS_FOR_TESTS = MIGRATIONS;
