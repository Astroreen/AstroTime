// Google Tasks (docs/plans/providers.md#D252): each task list a calendar of
// VTODOs, each task one calendar object made from the Tasks API's JSON and
// written back as the fields Google keeps, by PATCH, so what Google keeps
// that iCalendar cannot say (a task's position, its links) is never touched.
// What a VTODO says that Google cannot keep is written without it and said
// (`WriteResult.dropped`).
import { Authorization, send, type HttpClient, type TokenSource } from "@astrotime/caldav";
import {
  ALL_RIGHTS,
  type Changes,
  type Provider,
  type RemoteCalendar,
  type RemoteObject,
  type SyncState,
  type WriteResult,
} from "@astrotime/core/provider";

export const TASKS_API = "https://tasks.googleapis.com/tasks/v1/";

/** A task as the Tasks API gives it (only what AstroTime reads). */
export interface GoogleTask {
  readonly id: string;
  readonly etag?: string;
  readonly title?: string;
  readonly notes?: string;
  /** RFC 3339; Google keeps the day only. */
  readonly due?: string;
  readonly status?: "needsAction" | "completed";
  readonly completed?: string;
  readonly parent?: string;
  readonly position?: string;
  readonly updated?: string;
  readonly deleted?: boolean;
}

/** The properties of a VTODO that Google Tasks keeps, or that say nothing of the task. */
const KEPT = new Set([
  "UID",
  "DTSTAMP",
  "CREATED",
  "LAST-MODIFIED",
  "SEQUENCE",
  "SUMMARY",
  "DESCRIPTION",
  "DUE",
  "STATUS",
  "COMPLETED",
  "RELATED-TO",
  "X-GOOGLE-TASKS-POSITION",
]);

const escape = (text: string) =>
  text.replace(/[\\;,]/g, (char) => `\\${char}`).replace(/\r?\n/g, "\\n");

const unescape = (text: string) =>
  text.replace(/\\([\\;,nN])/g, (_all, char: string) =>
    char === "n" || char === "N" ? "\n" : char,
  );

/** RFC 5545 §3.1: lines over 75 octets folded (by characters here, which is within it). */
const fold = (line: string) => {
  if (line.length <= 74) return line;
  const parts = [line.slice(0, 74)];
  for (let at = 74; at < line.length; at += 73) parts.push(line.slice(at, at + 73));
  return parts.join("\r\n ");
};

/** `20261104T101500Z` from an RFC 3339 time. */
const utc = (time: string) =>
  new Date(time).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

/** A task as one calendar object: its VTODO, what Google keeps of it and no more. */
export function vtodoOf(task: GoogleTask): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AstroTime//Google Tasks//EN",
    "BEGIN:VTODO",
    `UID:${task.id}`,
    `DTSTAMP:${utc(task.updated ?? "1970-01-01T00:00:00Z")}`,
    ...(task.updated ? [`LAST-MODIFIED:${utc(task.updated)}`] : []),
    `SUMMARY:${escape(task.title ?? "")}`,
    ...(task.notes ? [`DESCRIPTION:${escape(task.notes)}`] : []),
    ...(task.due ? [`DUE;VALUE=DATE:${task.due.slice(0, 10).replaceAll("-", "")}`] : []),
    `STATUS:${task.status === "completed" ? "COMPLETED" : "NEEDS-ACTION"}`,
    ...(task.status === "completed" && task.completed ? [`COMPLETED:${utc(task.completed)}`] : []),
    ...(task.parent ? [`RELATED-TO:${task.parent}`] : []),
    ...(task.position ? [`X-GOOGLE-TASKS-POSITION:${task.position}`] : []),
    "END:VTODO",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** A VTODO's properties by name, unfolded, with their parameters and values. */
function propertiesOf(ics: string): { name: string; params: string; value: string }[] {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const found: { name: string; params: string; value: string }[] = [];
  let depth = 0;
  let inTodo = false;
  for (const line of unfolded.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!match) continue;
    const [, rawName = "", params = "", value = ""] = match;
    const name = rawName.toUpperCase();
    if (name === "BEGIN") {
      if (value.toUpperCase() === "VTODO" && depth === 0) inTodo = true;
      else if (inTodo) {
        depth += 1;
        // A VALARM inside the task: a reminder Google does not keep.
        if (depth === 1) found.push({ name: value.toUpperCase(), params: "", value: "" });
      }
      continue;
    }
    if (name === "END") {
      if (inTodo && depth > 0) depth -= 1;
      else if (value.toUpperCase() === "VTODO") break;
      continue;
    }
    if (inTodo && depth === 0) found.push({ name, params, value });
  }
  return found;
}

/**
 * A VTODO as the Tasks API's fields, for an insert or a PATCH: the title,
 * notes, due day, status and parent; and what it says that Google cannot
 * keep, by property (`DUE`'s time among it: Google keeps the day).
 */
export function taskFieldsOf(ics: string): {
  readonly fields: Record<string, string | null>;
  readonly dropped: readonly string[];
} {
  const properties = propertiesOf(ics);
  const first = (name: string) => properties.find((property) => property.name === name);
  const dropped = new Set<string>();
  for (const { name } of properties) if (!KEPT.has(name)) dropped.add(name);
  const due = first("DUE");
  let dueDay: string | null = null;
  if (due) {
    const day = /^(\d{4})(\d{2})(\d{2})/.exec(due.value);
    if (day) dueDay = `${day[1]}-${day[2]}-${day[3]}T00:00:00.000Z`;
    if (!/VALUE=DATE(?:;|$)/i.test(due.params) || due.value.includes("T")) dropped.add("DUE time");
  }
  const status = first("STATUS")?.value.toUpperCase() ?? "NEEDS-ACTION";
  if (status !== "COMPLETED" && status !== "NEEDS-ACTION") dropped.add(`STATUS ${status}`);
  return {
    fields: {
      title: unescape(first("SUMMARY")?.value ?? ""),
      notes: first("DESCRIPTION") ? unescape(first("DESCRIPTION")!.value) : null,
      due: dueDay,
      status: status === "COMPLETED" ? "completed" : "needsAction",
    },
    dropped: [...dropped],
  };
}

/** Each list's tasks at `<TASKS_API>lists/<id>/tasks/`, each task there by its id. */
const listUrl = (id: string) => `${TASKS_API}lists/${encodeURIComponent(id)}/tasks/`;

/** A Google account's task lists, as a provider: one calendar of VTODOs each. */
export class GoogleTasks implements Provider {
  private readonly http: HttpClient;
  private readonly authorization: Authorization;
  private readonly clock: () => number;

  constructor(http: HttpClient, tokens: TokenSource, clock: () => number = Date.now) {
    this.http = http;
    this.authorization = new Authorization(tokens);
    this.clock = clock;
  }

  private async json<T>(
    method: string,
    url: string,
    body?: Record<string, unknown>,
    accept: readonly number[] = [],
  ): Promise<{ status: number; value: T | null }> {
    const response = await send(
      this.http,
      this.authorization,
      {
        method,
        url,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      accept,
    );
    return {
      status: response.status,
      value: response.body ? (JSON.parse(response.body) as T) : null,
    };
  }

  async calendars(): Promise<RemoteCalendar[]> {
    const lists: RemoteCalendar[] = [];
    let page: string | undefined;
    do {
      const url = new URL(`${TASKS_API}users/@me/lists`);
      url.searchParams.set("maxResults", "100");
      if (page) url.searchParams.set("pageToken", page);
      const { value } = await this.json<{
        items?: { id: string; title?: string }[];
        nextPageToken?: string;
      }>("GET", url.href);
      for (const list of value?.items ?? [])
        lists.push({
          url: listUrl(list.id),
          name: list.title ?? "",
          color: null,
          components: ["VTODO"],
          rights: ALL_RIGHTS,
        });
      page = value?.nextPageToken;
    } while (page);
    return lists;
  }

  /**
   * What changed since `state`'s time (the Tasks API's `updatedMin`, deleted
   * ones among them); without one, every task, and what the device has that
   * Google no longer lists is removed. The next state is the time this
   * listing began, so nothing written meanwhile is missed.
   */
  async changes(
    calendarUrl: string,
    state: SyncState,
    known: ReadonlyMap<string, string | null>,
  ): Promise<Changes> {
    const began = new Date(this.clock()).toISOString();
    const changed: RemoteObject[] = [];
    const removed: string[] = [];
    const listed = new Set<string>();
    let page: string | undefined;
    do {
      const url = new URL(calendarUrl);
      for (const [name, value] of [
        ["maxResults", "100"],
        ["showCompleted", "true"],
        ["showHidden", "true"],
        ["showDeleted", "true"],
      ] as const)
        url.searchParams.set(name, value);
      if (state.syncToken) url.searchParams.set("updatedMin", state.syncToken);
      if (page) url.searchParams.set("pageToken", page);
      const { value } = await this.json<{ items?: GoogleTask[]; nextPageToken?: string }>(
        "GET",
        url.href,
      );
      for (const task of value?.items ?? []) {
        const href = `${calendarUrl}${encodeURIComponent(task.id)}`;
        if (task.deleted) {
          if (known.has(href)) removed.push(href);
          continue;
        }
        listed.add(href);
        if (known.get(href) !== (task.etag ?? null))
          changed.push({ href, etag: task.etag ?? null, ics: vtodoOf(task) });
      }
      page = value?.nextPageToken;
    } while (page);
    if (!state.syncToken)
      for (const href of known.keys()) if (!listed.has(href)) removed.push(href);
    return { changed, removed, syncToken: began, ctag: null };
  }

  async fetch(href: string): Promise<RemoteObject | null> {
    const { status, value } = await this.json<GoogleTask>("GET", href, undefined, [404]);
    if (status === 404 || !value || value.deleted) return null;
    return { href, etag: value.etag ?? null, ics: vtodoOf(value) };
  }

  /** Inserted in the list `href` names; Google gives its id, and its href with it. */
  async create(href: string, ics: string): Promise<WriteResult> {
    const list = href.slice(0, href.lastIndexOf("/") + 1);
    const { fields, dropped } = taskFieldsOf(ics);
    const body = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null));
    const { value } = await this.json<GoogleTask>("POST", list, body);
    if (!value) throw new Error("The Tasks API gave no task back.");
    return {
      ok: true,
      href: `${list}${encodeURIComponent(value.id)}`,
      etag: value.etag ?? null,
      ...(dropped.length > 0 ? { dropped } : {}),
    };
  }

  /**
   * The fields Google keeps, as the item now says them (`PATCH`): nothing
   * else Google keeps is sent, so it stays as it is there. The Tasks API
   * takes no `If-Match`, so the last write wins (D252).
   */
  async update(href: string, ics: string): Promise<WriteResult> {
    const { fields, dropped } = taskFieldsOf(ics);
    const { status, value } = await this.json<GoogleTask>("PATCH", href, fields, [404]);
    if (status === 404 || !value) return { ok: false, reason: "gone" };
    return {
      ok: true,
      href,
      etag: value.etag ?? null,
      ...(dropped.length > 0 ? { dropped } : {}),
    };
  }

  async remove(href: string): Promise<WriteResult> {
    const { status } = await this.json("DELETE", href, undefined, [404]);
    return status === 404 ? { ok: false, reason: "gone" } : { ok: true, href, etag: null };
  }
}
