// Microsoft To Do over Graph (docs/plans/providers.md#D253): each list a
// calendar of VTODOs, each task one calendar object; a write is a PATCH of
// the fields that changed against Graph's own version, with its `If-Match`.
import {
  ALL_RIGHTS,
  type Changes,
  type Provider,
  type RemoteCalendar,
  type RemoteObject,
  type SyncState,
  type WriteResult,
} from "@astrotime/core/provider";
import {
  calendarText,
  componentsOf,
  escapeText,
  lineOf,
  timeOf,
  unescapeText,
  utcText,
  type Component,
} from "@astrotime/core/lines";

import {
  dayIn,
  GRAPH,
  keptEtag,
  sentEtag,
  utcOf,
  zoneOf,
  type Graph,
  type GraphTime,
} from "./graph.ts";

/** A task as Graph gives it (only what AstroTime reads). */
export interface TodoTask {
  readonly id: string;
  readonly "@odata.etag"?: string;
  readonly title?: string;
  readonly body?: { readonly content?: string };
  readonly dueDateTime?: GraphTime | null;
  readonly completedDateTime?: GraphTime | null;
  readonly status?: "notStarted" | "inProgress" | "completed" | "waitingOnOthers" | "deferred";
  readonly importance?: "low" | "normal" | "high";
  readonly categories?: readonly string[];
  readonly lastModifiedDateTime?: string;
}

const STATUS_IN: Record<string, string> = {
  notStarted: "NEEDS-ACTION",
  waitingOnOthers: "NEEDS-ACTION",
  deferred: "NEEDS-ACTION",
  inProgress: "IN-PROCESS",
  completed: "COMPLETED",
};

/** A task as one calendar object. */
export function vtodoOf(task: TodoTask): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AstroTime//Microsoft To Do//EN",
    "BEGIN:VTODO",
    `UID:${task.id}`,
    `DTSTAMP:${utcText(task.lastModifiedDateTime ?? "1970-01-01T00:00:00Z")}`,
    `SUMMARY:${escapeText(task.title ?? "")}`,
  ];
  if (task.body?.content) lines.push(`DESCRIPTION:${escapeText(task.body.content)}`);
  // A due day is its midnight in the zone the value names, whatever `Prefer` asked.
  if (task.dueDateTime)
    lines.push(
      `DUE;VALUE=DATE:${dayIn(utcOf(task.dueDateTime), zoneOf(task.dueDateTime.timeZone))}`,
    );
  lines.push(`STATUS:${STATUS_IN[task.status ?? "notStarted"] ?? "NEEDS-ACTION"}`);
  if (task.status === "completed" && task.completedDateTime)
    lines.push(`COMPLETED:${utcText(utcOf(task.completedDateTime))}`);
  if (task.importance === "high") lines.push("PRIORITY:1");
  if (task.importance === "low") lines.push("PRIORITY:9");
  if (task.categories?.length)
    lines.push(`CATEGORIES:${task.categories.map(escapeText).join(",")}`);
  lines.push("END:VTODO", "END:VCALENDAR");
  return calendarText(lines);
}

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
  "PRIORITY",
  "CATEGORIES",
]);

/**
 * A VTODO as To Do's fields, its due day the midnight of `zone`, the
 * user's; and what it says that To Do cannot keep, by property.
 */
export function todoFieldsOf(
  component: Component,
  zone = "UTC",
): {
  readonly fields: Record<string, unknown>;
  readonly dropped: readonly string[];
} {
  const dropped = new Set<string>();
  for (const { name } of component.properties) if (!KEPT.has(name)) dropped.add(name);
  for (const inner of component.components) dropped.add(inner.name);
  const text = (name: string) => {
    const line = lineOf(component, name);
    return line ? unescapeText(line.value) : null;
  };
  const due = lineOf(component, "DUE");
  let dueDateTime: GraphTime | null = null;
  if (due) {
    const { time, date } = timeOf(due);
    dueDateTime = { dateTime: `${time.slice(0, 10)}T00:00:00`, timeZone: zone };
    if (!date) dropped.add("DUE time");
  }
  const status = (lineOf(component, "STATUS")?.value ?? "NEEDS-ACTION").toUpperCase();
  if (status === "CANCELLED") dropped.add("STATUS CANCELLED");
  const priority = Number(lineOf(component, "PRIORITY")?.value ?? "0");
  const completed = lineOf(component, "COMPLETED");
  return {
    fields: {
      title: text("SUMMARY") ?? "",
      body: { contentType: "text", content: text("DESCRIPTION") ?? "" },
      dueDateTime,
      status:
        status === "COMPLETED"
          ? "completed"
          : status === "IN-PROCESS"
            ? "inProgress"
            : "notStarted",
      importance: priority >= 1 && priority <= 4 ? "high" : priority >= 6 ? "low" : "normal",
      categories: (lineOf(component, "CATEGORIES")?.value ?? "")
        .split(/(?<!\\),/)
        .filter(Boolean)
        .map(unescapeText),
      ...(status === "COMPLETED" && completed
        ? {
            completedDateTime: {
              dateTime: timeOf(completed).time.replace(/Z$/, ""),
              timeZone: "UTC",
            },
          }
        : {}),
    },
    dropped: [...dropped],
  };
}

const todoIn = (ics: string) =>
  (componentsOf(ics)[0]?.components ?? []).find((component) => component.name === "VTODO") ?? null;

/** A Microsoft account's To Do lists, as a provider. */
export class MicrosoftTodo implements Provider {
  private readonly graph: Graph;
  /** The user's zone, whose midnight a due day is written as (an IANA name). */
  private readonly zone: string;

  constructor(graph: Graph, zone = new Intl.DateTimeFormat().resolvedOptions().timeZone) {
    this.graph = graph;
    this.zone = zone;
  }

  async calendars(): Promise<RemoteCalendar[]> {
    const lists = await this.graph.all<{ id: string; displayName?: string }>(
      `${GRAPH}me/todo/lists`,
    );
    return lists.map((list) => ({
      url: `${GRAPH}me/todo/lists/${encodeURIComponent(list.id)}/tasks/`,
      name: list.displayName ?? "",
      color: null,
      components: ["VTODO"],
      rights: ALL_RIGHTS,
    }));
  }

  async changes(
    calendarUrl: string,
    _state: SyncState,
    known: ReadonlyMap<string, string | null>,
  ): Promise<Changes> {
    const tasks = await this.graph.all<TodoTask>(`${calendarUrl.replace(/\/$/, "")}?$top=100`);
    const changed: RemoteObject[] = [];
    const listed = new Set<string>();
    for (const task of tasks) {
      const href = `${calendarUrl}${encodeURIComponent(task.id)}`;
      listed.add(href);
      const etag = keptEtag(task["@odata.etag"]);
      // No ETag on either side is never "unchanged" (D37): fetched again.
      if (etag === null || known.get(href) !== etag)
        changed.push({ href, etag, ics: vtodoOf(task) });
    }
    return {
      changed,
      removed: [...known.keys()].filter((href) => !listed.has(href)),
      syncToken: null,
      ctag: null,
    };
  }

  async fetch(href: string): Promise<RemoteObject | null> {
    const { status, value } = await this.graph.json<TodoTask>("GET", href, { accept: [404] });
    if (status === 404 || !value) return null;
    return { href, etag: keptEtag(value["@odata.etag"]), ics: vtodoOf(value) };
  }

  async create(href: string, ics: string): Promise<WriteResult> {
    const list = href.slice(0, href.lastIndexOf("/") + 1);
    const todo = todoIn(ics);
    if (!todo) throw new Error("A calendar object with no task.");
    const { fields, dropped } = todoFieldsOf(todo, this.zone);
    const { value } = await this.graph.json<TodoTask>("POST", list.replace(/\/$/, ""), {
      body: fields,
    });
    if (!value) throw new Error("Graph gave no task back.");
    return {
      ok: true,
      href: `${list}${encodeURIComponent(value.id)}`,
      etag: keptEtag(value["@odata.etag"]),
      ...(dropped.length > 0 ? { dropped } : {}),
    };
  }

  /** The fields that changed against Graph's own version, read just before: one `PATCH` with `If-Match`. */
  async update(href: string, ics: string, etag: string | null): Promise<WriteResult> {
    const todo = todoIn(ics);
    if (!todo) throw new Error("A calendar object with no task.");
    const current = await this.graph.json<TodoTask>("GET", href, { accept: [404] });
    if (current.status === 404 || !current.value) return { ok: false, reason: "gone" };
    const before = todoFieldsOf(todoIn(vtodoOf(current.value))!, this.zone).fields;
    const { fields, dropped } = todoFieldsOf(todo, this.zone);
    const changed = Object.fromEntries(
      Object.entries(fields).filter(
        ([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value),
      ),
    );
    let task = current.value;
    if (Object.keys(changed).length > 0) {
      // No ETag kept here: Graph's just read is no proof our base was it
      // (D37), so the sync fetches, merges and writes against that one.
      if (etag === null && task["@odata.etag"]) return { ok: false, reason: "conflict" };
      const patched = await this.graph.json<TodoTask>("PATCH", href, {
        body: changed,
        etag: sentEtag(etag),
        accept: [404, 412],
      });
      if (patched.status === 404) return { ok: false, reason: "gone" };
      if (patched.status === 412) return { ok: false, reason: "conflict" };
      task = patched.value ?? task;
    }
    return {
      ok: true,
      href,
      etag: keptEtag(task["@odata.etag"]),
      ...(dropped.length > 0 ? { dropped } : {}),
    };
  }

  async remove(href: string, etag: string | null): Promise<WriteResult> {
    const { status } = await this.graph.json("DELETE", href, {
      etag: sentEtag(etag),
      accept: [404, 412],
    });
    if (status === 404) return { ok: false, reason: "gone" };
    if (status === 412) return { ok: false, reason: "conflict" };
    return { ok: true, href, etag: null };
  }
}
