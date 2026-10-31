import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// The tables of the local store. `migrations.ts` creates them; a change here
// is a new migration there, and the store tests run every query against it.

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  provider: text("provider", { enum: ["caldav"] }).notNull(),
  name: text("name").notNull(),
  serverUrl: text("server_url").notNull(),
  username: text("username"),
  createdAt: integer("created_at").notNull(),
});

export const calendars = sqliteTable(
  "calendars",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** The collection's URL on the server. */
    url: text("url").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    /** `supported-calendar-component-set`, comma-separated: `VEVENT,VTODO`. */
    components: text("components").notNull(),
    readOnly: integer("read_only", { mode: "boolean" }).notNull().default(false),
    syncToken: text("sync_token"),
    ctag: text("ctag"),
  },
  (t) => [uniqueIndex("calendars_account_url").on(t.accountId, t.url)],
);

export const objects = sqliteTable(
  "objects",
  {
    id: text("id").primaryKey(),
    calendarId: text("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    /** The resource's URL on the server; set for a local creation before its first upload. */
    href: text("href").notNull(),
    etag: text("etag"),
    uid: text("uid").notNull(),
    kind: text("kind", { enum: ["event", "task"] }).notNull(),
    ics: text("ics").notNull(),
    /** A local change the sync engine has not uploaded yet. */
    pending: text("pending", { enum: ["none", "create", "update", "delete"] }).notNull(),
    /** The server's version this object's local change started from (migration 2). */
    baseIcs: text("base_ics"),
    /** `boundsOf` from `@astrotime/core`: `null` start is undated, `null` end is unending. */
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("objects_calendar_href").on(t.calendarId, t.href),
    index("objects_calendar_start").on(t.calendarId, t.startMs),
    index("objects_calendar_uid").on(t.calendarId, t.uid),
  ],
);

export const conflicts = sqliteTable("conflicts", {
  id: text("id").primaryKey(),
  objectId: text("object_id")
    .notNull()
    .references(() => objects.id, { onDelete: "cascade" }),
  /** Our version the server refused (GLOSSARY.md: Conflict). */
  localIcs: text("local_ics").notNull(),
  createdAt: integer("created_at").notNull(),
});
