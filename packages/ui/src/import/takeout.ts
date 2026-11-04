// Google Takeout's Tasks (`Tasks.json`) as iCalendar 2.0, for import
// (docs/plans/import.md#D266, #D272): each task list a `VCALENDAR` of its
// own, named as the list, each task a `VTODO` with its notes, due day,
// status and completion, a subtask naming its parent (`RELATED-TO`), its
// links as attachments, its place in the list kept as an `X-` property.
// The fields are the Tasks API's (`tasks#taskList`, `tasks#task`), which
// Takeout writes. A task the user deleted (Takeout keeps it, `deleted`) is
// left out, as it is in Google Tasks. Loaded only for such a file.

import { NotCalendarError } from "@astrotime/core/split";

export interface TakeoutConverted {
  readonly text: string;
  readonly notImported: readonly string[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether parsed JSON is Takeout's tasks: `tasks#taskLists`, one `tasks#taskList`, or a list of them. */
export function isTakeoutTasks(json: unknown): boolean {
  if (isObject(json))
    return json["kind"] === "tasks#taskLists" || json["kind"] === "tasks#taskList";
  return (
    Array.isArray(json) &&
    json.length > 0 &&
    json.every((list) => isObject(list) && list["kind"] === "tasks#taskList")
  );
}

/**
 * Takeout's `Tasks.json` as iCalendar. Whatever it holds is read as data:
 * a value of the wrong shape is left out, never a crash, and each value is
 * written so it cannot become a line of its own (text escaped, control
 * characters dropped; a link parsed as a URL and written as one; a place
 * digits alone). Not Takeout's tasks at all: `NotCalendarError`.
 */
export function takeoutToIcs(json: unknown): TakeoutConverted {
  if (!isTakeoutTasks(json)) throw new NotCalendarError("The JSON is not Google Takeout's tasks.");
  const lists: unknown[] = Array.isArray(json)
    ? json
    : (json as Record<string, unknown>)["kind"] === "tasks#taskList"
      ? [json]
      : Array.isArray((json as Record<string, unknown>)["items"])
        ? ((json as Record<string, unknown>)["items"] as unknown[])
        : [];
  const notImported = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!isObject(list)) continue;
    const tasks = Array.isArray(list["items"]) ? (list["items"] as unknown[]) : [];
    // The tasks kept: a subtask names its parent only when the parent is among them.
    const kept = new Set(
      tasks
        .filter((task) => isObject(task) && task["deleted"] !== true)
        .map((task) => idOf((task as Record<string, unknown>)["id"]))
        .filter((id) => id !== null),
    );
    out.push(
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//AstroTime//Import from Google Takeout//EN",
    );
    if (typeof list["title"] === "string") out.push(`X-WR-CALNAME:${escape(list["title"])}`);
    for (const task of tasks) {
      if (!isObject(task) || task["deleted"] === true) continue;
      const id = idOf(task["id"]);
      if (!id) continue;
      const lines = ["BEGIN:VTODO", `UID:google-task-${id}`];
      const updated = stamp(task["updated"]);
      lines.push(`DTSTAMP:${updated ?? "19700101T000000Z"}`);
      if (updated) lines.push(`LAST-MODIFIED:${updated}`);
      if (typeof task["title"] === "string" && task["title"] !== "")
        lines.push(`SUMMARY:${escape(task["title"])}`);
      if (typeof task["notes"] === "string" && task["notes"] !== "")
        lines.push(`DESCRIPTION:${escape(task["notes"])}`);
      // Google keeps a task's due day alone, as midnight UTC.
      const due =
        typeof task["due"] === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(task["due"]) : null;
      if (due) lines.push(`DUE;VALUE=DATE:${due[1]}${due[2]}${due[3]}`);
      if (task["status"] === "completed") {
        lines.push("STATUS:COMPLETED");
        const completed = stamp(task["completed"]);
        if (completed) lines.push(`COMPLETED:${completed}`);
      } else lines.push("STATUS:NEEDS-ACTION");
      // Its parent, when the file has it; a parent deleted or not in the file
      // would leave a link to nothing: left out, and named.
      const parent = idOf(task["parent"]);
      if (parent && kept.has(parent)) lines.push(`RELATED-TO:google-task-${parent}`);
      else if (task["parent"] !== undefined) notImported.add("parent");
      if (typeof task["position"] === "string" && /^\d+$/.test(task["position"]))
        lines.push(`X-GOOGLE-TASKS-POSITION:${task["position"]}`);
      for (const link of Array.isArray(task["links"]) ? (task["links"] as unknown[]) : []) {
        const url = isObject(link) ? linkOf(link["link"]) : null;
        if (url) lines.push(`ATTACH:${url}`);
        else notImported.add("links");
      }
      lines.push("END:VTODO");
      out.push(...lines);
    }
    out.push("END:VCALENDAR");
  }
  return { text: `${out.join("\r\n")}\r\n`, notImported: [...notImported] };
}

/** Google's id of a task, as a UID can carry it: letters, digits, `-` and `_` (its ids are base64url). */
function idOf(value: unknown): string | null {
  const id = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

/** A link as an http(s) URL, parsed and written back by the URL parser; none for another. */
function linkOf(value: unknown): string | null {
  // A control character in it (a line break the URL parser would quietly
  // drop, changing the address): no link it means to name.
  if (typeof value !== "string" || [...value].some(isControl)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // The parser leaves no white space unescaped; nothing that could end a line remains.
  return [...url.href].some((c) => isControl(c) || c === " ") ? null : url.href;
}

/** An RFC 3339 time as iCalendar's UTC `YYYYMMDDTHHMMSSZ`; null if it is none. */
function stamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().replaceAll(/[-:]|\.\d+/g, "");
}

/** Text as iCalendar's TEXT (RFC 5545 §3.3.11): a line break of any kind escaped, other control characters dropped. */
const escape = (text: string) =>
  text
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r\n?|\n/g, "\\n")
    .split("")
    // A tab is text's own (RFC 5545 §3.3.11); the other control characters go.
    .filter((c) => c === "\t" || !isControl(c))
    .join("");

/** A control character (C0 or DEL): none may reach a content line. */
const isControl = (c: string) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f;
