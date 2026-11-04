// Google Takeout's Tasks (`Tasks.json`) as iCalendar 2.0, for import
// (docs/plans/import.md#D266, #D272): each task list a `VCALENDAR` of its
// own, named as the list, each task a `VTODO` with its notes, due day,
// status and completion, a subtask naming its parent (`RELATED-TO`), its
// links as attachments, its place in the list kept as an `X-` property.
// The fields are the Tasks API's (`tasks#taskList`, `tasks#task`), which
// Takeout writes. A task the user deleted (Takeout keeps it, `deleted`) is
// left out, as it is in Google Tasks. Loaded only for such a file.

export interface TakeoutConverted {
  readonly text: string;
  readonly notImported: readonly string[];
}

interface Task {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly notes?: unknown;
  readonly status?: unknown;
  readonly due?: unknown;
  readonly completed?: unknown;
  readonly updated?: unknown;
  readonly parent?: unknown;
  readonly position?: unknown;
  readonly deleted?: unknown;
  readonly links?: unknown;
}

interface TaskList {
  readonly title?: unknown;
  readonly items?: unknown;
}

/** Takeout's `Tasks.json`: `tasks#taskLists`, one `tasks#taskList`, or a list of them. */
export function takeoutToIcs(json: unknown): TakeoutConverted {
  const lists: TaskList[] = Array.isArray(json)
    ? (json as TaskList[])
    : (json as { kind?: unknown }).kind === "tasks#taskList"
      ? [json as TaskList]
      : (((json as { items?: unknown }).items ?? []) as TaskList[]);
  const notImported = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    const tasks = (Array.isArray(list.items) ? list.items : []) as Task[];
    const uidOf = (id: unknown) => `google-task-${String(id)}`;
    out.push(
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//AstroTime//Import from Google Takeout//EN",
    );
    if (typeof list.title === "string") out.push(`X-WR-CALNAME:${escape(list.title)}`);
    for (const task of tasks) {
      if (task.deleted === true || task.id === undefined) continue;
      const lines = ["BEGIN:VTODO", `UID:${uidOf(task.id)}`];
      const updated = stamp(task.updated);
      lines.push(`DTSTAMP:${updated ?? "19700101T000000Z"}`);
      if (updated) lines.push(`LAST-MODIFIED:${updated}`);
      if (typeof task.title === "string" && task.title !== "")
        lines.push(`SUMMARY:${escape(task.title)}`);
      if (typeof task.notes === "string" && task.notes !== "")
        lines.push(`DESCRIPTION:${escape(task.notes)}`);
      // Google keeps a task's due day alone, as midnight UTC.
      if (typeof task.due === "string" && /^\d{4}-\d{2}-\d{2}/.test(task.due))
        lines.push(`DUE;VALUE=DATE:${task.due.slice(0, 10).replaceAll("-", "")}`);
      if (task.status === "completed") {
        lines.push("STATUS:COMPLETED");
        const completed = stamp(task.completed);
        if (completed) lines.push(`COMPLETED:${completed}`);
      } else lines.push("STATUS:NEEDS-ACTION");
      if (task.parent !== undefined) lines.push(`RELATED-TO:${uidOf(task.parent)}`);
      if (typeof task.position === "string") lines.push(`X-GOOGLE-TASKS-POSITION:${task.position}`);
      for (const link of Array.isArray(task.links) ? task.links : []) {
        const url = (link as { link?: unknown }).link;
        if (typeof url === "string" && /^https?:/i.test(url)) lines.push(`ATTACH:${url}`);
        else notImported.add("links");
      }
      lines.push("END:VTODO");
      out.push(...lines);
    }
    out.push("END:VCALENDAR");
  }
  return { text: `${out.join("\r\n")}\r\n`, notImported: [...notImported] };
}

/** An RFC 3339 time as iCalendar's UTC `YYYYMMDDTHHMMSSZ`; null if it is none. */
function stamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().replaceAll(/[-:]|\.\d+/g, "");
}

/** Text as iCalendar's TEXT (RFC 5545 §3.3.11). */
const escape = (text: string) =>
  text
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");
