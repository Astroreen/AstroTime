// A CSV of events or tasks as iCalendar 2.0, for import
// (docs/plans/import.md#D266, #D272): Outlook's "Export to a file" (its
// calendar and its tasks, in English and in Russian), Thunderbird's CSV
// export (Outlook's columns), and the columns Google Calendar's own import
// documents. Each row is one item at the user's wall clock in their zone;
// its UID is made from what it says, so the same file imported twice finds
// its items already there (D270). A column with no home in iCalendar is
// named in `notImported`. Loaded only for a CSV.
import { zonedToEpoch } from "@astrotime/core";
import { NotCalendarError, zoneText } from "@astrotime/core/split";

export interface CsvConverted {
  readonly text: string;
  readonly notImported: readonly string[];
  /** How its dates were read, and whether that was guessed (no day past 12 told it). */
  readonly dates: { readonly order: DateOrder; readonly guessed: boolean } | null;
}

export type DateOrder = "dmy" | "mdy" | "ymd";

type Field =
  | "subject"
  | "startDate"
  | "startTime"
  | "endDate"
  | "endTime"
  | "allDay"
  | "description"
  | "location"
  | "private"
  | "categories"
  | "reminderOn"
  | "reminderDate"
  | "reminderTime"
  | "organizer"
  | "required"
  | "optional"
  | "resources"
  | "priority"
  | "sensitivity"
  | "showAs"
  | "dueDate"
  | "completedDate"
  | "percent"
  | "status"
  | "complete";

/** Each field's column names, lower case: Outlook's in English and Russian, Thunderbird's, Google's. */
const COLUMNS: Record<Field, readonly string[]> = {
  subject: ["subject", "тема", "title", "summary"],
  startDate: ["start date", "дата начала"],
  startTime: ["start time", "время начала"],
  endDate: ["end date", "дата окончания"],
  endTime: ["end time", "время окончания"],
  allDay: ["all day event", "all day", "целый день", "событие на весь день"],
  description: ["description", "notes", "описание", "заметки"],
  location: ["location", "место", "расположение"],
  private: ["private", "частное", "личное"],
  categories: ["categories", "категории"],
  reminderOn: ["reminder on/off", "напоминание вкл/выкл"],
  reminderDate: ["reminder date", "дата напоминания"],
  reminderTime: ["reminder time", "время напоминания"],
  organizer: ["meeting organizer", "организатор собрания"],
  required: ["required attendees", "обязательные участники"],
  optional: ["optional attendees", "необязательные участники"],
  resources: ["meeting resources", "ресурсы собрания"],
  priority: ["priority", "важность", "приоритет"],
  sensitivity: ["sensitivity", "пометка", "конфиденциальность"],
  showAs: ["show time as", "показывать время как"],
  dueDate: ["due date", "срок"],
  completedDate: ["date completed", "дата завершения"],
  percent: ["% complete", "% выполнения", "процент завершения"],
  status: ["status", "состояние"],
  complete: ["complete", "выполнено"],
};

/** What says nothing in a column: Outlook writes `0`, `False`, `Normal` where nothing was given. */
const EMPTY = new Set(["", "0", "0%", "false", "ложь", "normal", "обычная", "обычный"]);

const TRUE = new Set(["true", "yes", "1", "on", "истина", "да", "вкл"]);
const isTrue = (value: string) => TRUE.has(value.trim().toLowerCase());

export function csvToIcs(
  text: string,
  options: { readonly language: string; readonly timeZone: string },
): CsvConverted {
  const rows = parseCsv(text);
  /** The column names as written, for naming one not imported, and in lower case, to find them. */
  const written = rows[0]?.map((name) => name.trim().replace(/^"|"$/g, "")) ?? [];
  const header = written.map((name) => name.toLowerCase());
  const column = new Map<Field, number>();
  for (const [field, names] of Object.entries(COLUMNS) as [Field, readonly string[]][]) {
    const at = header.findIndex((name) => names.includes(name));
    if (at >= 0) column.set(field, at);
  }
  const tasks = column.has("dueDate") && !column.has("endDate");
  if (!column.has("subject") || !(column.has("startDate") || column.has("dueDate")))
    throw new NotCalendarError("The CSV has no column of titles and dates AstroTime knows.");
  // Google's layout gives an all-day event's last day; Outlook's and Thunderbird's the day after.
  const lastDayInclusive = !column.has("reminderOn");
  const known = new Set(column.values());
  const body = rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== ""));

  const dateFields: Field[] = ["startDate", "endDate", "reminderDate", "dueDate", "completedDate"];
  const dates = body.flatMap((row) =>
    dateFields.map((field) => cell(row, column, field)).filter((value) => value !== ""),
  );
  const order = dateOrder(dates, options.language);

  const notImported = new Set<string>();
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AstroTime//Import from CSV//EN"];
  const components: string[][] = [];
  let firstYear: number | null = null;
  for (const row of body) {
    // A column with a value no field took: named, not written.
    for (const [at, value] of row.entries())
      if (!known.has(at) && !EMPTY.has(value.trim().toLowerCase()) && header[at])
        notImported.add(written[at]!);
    const get = (field: Field) => cell(row, column, field);
    const date = (field: Field) => dateOf(get(field), order.order);
    const out: string[] = [];
    const push = (line: string) => out.push(line);
    if (get("subject")) push(`SUMMARY:${escape(get("subject"))}`);
    if (get("description")) push(`DESCRIPTION:${escape(get("description"))}`);
    if (get("location")) push(`LOCATION:${escape(get("location"))}`);
    const categories = get("categories")
      .split(/[;,]/)
      .map((category) => category.trim())
      .filter(Boolean);
    if (categories.length > 0) push(`CATEGORIES:${categories.map(escape).join(",")}`);
    const classification = isTrue(get("private")) ? "PRIVATE" : sensitivity(get("sensitivity"));
    if (classification) push(`CLASS:${classification}`);
    const priority = priorityOf(get("priority"));
    if (priority) push(`PRIORITY:${priority}`);
    else if (get("priority")) notImported.add(written[column.get("priority")!]!);

    if (tasks) {
      const start = date("startDate");
      const due = date("dueDate");
      if (start) push(`DTSTART;VALUE=DATE:${start}`);
      if (due) push(`DUE;VALUE=DATE:${due}`);
      const completed = date("completedDate");
      const done = completed !== null || isTrue(get("complete"));
      if (completed) push(`COMPLETED:${utc(`${completed}T000000`, options.timeZone)}`);
      const status = taskStatus(get("status"), done);
      if (status) push(`STATUS:${status}`);
      else if (get("status")) notImported.add(written[column.get("status")!]!);
      const percent = /^(\d{1,3})\s*%?$/.exec(get("percent").trim())?.[1];
      if (percent) push(`PERCENT-COMPLETE:${Math.min(100, Number(percent))}`);
      const at = reminderAt(get, order.order);
      if (at && isTrue(get("reminderOn")))
        out.push(
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `TRIGGER;VALUE=DATE-TIME:${utc(at, options.timeZone)}`,
          `DESCRIPTION:${escape(get("subject") || "Reminder")}`,
          "END:VALARM",
        );
      firstYear ??= Number((due ?? start ?? "").slice(0, 4)) || null;
    } else {
      const startDay = date("startDate");
      if (!startDay) {
        notImported.add(written[column.get("startDate")!] ?? "Start Date");
        continue;
      }
      const startTime = timeOf(get("startTime"));
      const allDay = isTrue(get("allDay")) || startTime === null;
      if (allDay) {
        const endDay = date("endDate");
        // The day after its last: Google's says its last day, the others the day after.
        const after =
          endDay && endDay > startDay
            ? lastDayInclusive
              ? nextDay(endDay)
              : endDay
            : nextDay(startDay);
        push(`DTSTART;VALUE=DATE:${startDay}`);
        push(`DTEND;VALUE=DATE:${after}`);
      } else {
        const zone = options.timeZone;
        push(`DTSTART;TZID=${zone}:${startDay}T${startTime}`);
        const endTime = timeOf(get("endTime"));
        const endDay = date("endDate") ?? startDay;
        if (endTime) push(`DTEND;TZID=${zone}:${endDay}T${endTime}`);
        firstYear ??= Number(startDay.slice(0, 4));
      }
      const showAs = get("showAs").trim().toLowerCase();
      if (["0", "free", "свободен", "свободно"].includes(showAs)) push("TRANSP:TRANSPARENT");
      const organizer = addressOf(get("organizer"));
      if (organizer) push(`ORGANIZER:mailto:${organizer}`);
      else if (get("organizer")) notImported.add(written[column.get("organizer")!]!);
      for (const [field, role] of [
        ["required", "REQ-PARTICIPANT"],
        ["optional", "OPT-PARTICIPANT"],
      ] as const) {
        const people = get(field)
          .split(";")
          .map((person) => person.trim())
          .filter(Boolean);
        for (const person of people) {
          const address = addressOf(person);
          if (address) push(`ATTENDEE;ROLE=${role}:mailto:${address}`);
          else notImported.add(written[column.get(field)!]!);
        }
      }
      const resources = get("resources")
        .split(";")
        .map((one) => one.trim())
        .filter(Boolean);
      if (resources.length > 0) push(`RESOURCES:${resources.map(escape).join(",")}`);
      // A reminder, relative to the start.
      const at = reminderAt(get, order.order);
      if (at && isTrue(get("reminderOn"))) {
        const start = allDay ? `${startDay}T000000` : `${startDay}T${startTime}`;
        const seconds = (wallMs(at) - wallMs(start)) / 1000;
        out.push(
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `TRIGGER:${duration(seconds)}`,
          `DESCRIPTION:${escape(get("subject") || "Reminder")}`,
          "END:VALARM",
        );
      }
    }
    const kind = tasks ? "VTODO" : "VEVENT";
    // The same row gives the same UID: imported again, it is found there (D270).
    components.push([
      `BEGIN:${kind}`,
      `UID:csv-${hash(row.join("\u0000"))}`,
      "DTSTAMP:19700101T000000Z",
      ...out,
      `END:${kind}`,
    ]);
  }
  if (firstYear !== null)
    lines.push(...zoneText(options.timeZone, firstYear).split(/\r?\n/).filter(Boolean));
  for (const component of components) lines.push(...component);
  lines.push("END:VCALENDAR");
  return {
    text: `${lines.join("\r\n")}\r\n`,
    notImported: [...notImported],
    dates: dates.length > 0 ? order : null,
  };
}

const cell = (row: readonly string[], column: ReadonlyMap<Field, number>, field: Field) => {
  const at = column.get(field);
  return at === undefined ? "" : (row[at] ?? "").trim();
};

/** RFC 4180's CSV, its delimiter the comma, semicolon or tab its first line uses most. */
export function parseCsv(text: string): string[][] {
  const first = text.slice(0, text.search(/\r?\n|$/));
  const outside = first.replace(/"[^"]*"/g, "");
  const delimiter = [",", ";", "\t"]
    .map((d) => [d, outside.split(d).length] as const)
    .toSorted((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(value);
      value = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

/**
 * The order the dates are written in: year first when they start with one;
 * else told by a part past 12 (a day); else the user's language's
 * (`ru`: day first, otherwise month first), said as guessed.
 */
function dateOrder(
  values: readonly string[],
  language: string,
): { order: DateOrder; guessed: boolean } {
  const parts = values.map((value) => value.split(/[./-]/).map(Number));
  if (parts.some((p) => String(p[0]).length === 4)) return { order: "ymd", guessed: false };
  if (parts.some((p) => (p[0] ?? 0) > 12)) return { order: "dmy", guessed: false };
  if (parts.some((p) => (p[1] ?? 0) > 12)) return { order: "mdy", guessed: false };
  if (values.some((value) => value.includes("."))) return { order: "dmy", guessed: true };
  return { order: language.startsWith("en") ? "mdy" : "dmy", guessed: true };
}

/** A date as `YYYYMMDD`, in the order given; null if it is none. */
function dateOf(value: string, order: DateOrder): string | null {
  const parts = value.trim().split(/\s+/)[0]?.split(/[./-]/) ?? [];
  if (parts.length !== 3) return null;
  const [a, b, c] = parts.map(Number) as [number, number, number];
  let [y, m, d] = order === "ymd" ? [a, b, c] : order === "dmy" ? [c, b, a] : [c, a, b];
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${String(y).padStart(4, "0")}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
}

/** `9:00 AM`, `21:30`, `09:00:00 PM` as `HHMMSS`; null if it is none. */
function timeOf(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])?\.?[Mm]?\.?$/.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const meridiem = match[4]?.toLowerCase();
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  if (hour > 23 || Number(match[2]) > 59) return null;
  return `${String(hour).padStart(2, "0")}${match[2]}${match[3] ?? "00"}`;
}

/** The reminder's wall clock, `YYYYMMDDTHHMMSS`, from its date and time columns. */
function reminderAt(get: (field: Field) => string, order: DateOrder): string | null {
  const day = dateOf(get("reminderDate"), order);
  const time = timeOf(get("reminderTime"));
  return day && time ? `${day}T${time}` : null;
}

const wallMs = (local: string) =>
  Date.UTC(
    Number(local.slice(0, 4)),
    Number(local.slice(4, 6)) - 1,
    Number(local.slice(6, 8)),
    Number(local.slice(9, 11)),
    Number(local.slice(11, 13)),
    Number(local.slice(13, 15)),
  );

/** A wall clock in a zone as a UTC `YYYYMMDDTHHMMSSZ`. */
function utc(local: string, timeZone: string): string {
  const iso = `${local.slice(0, 4)}-${local.slice(4, 6)}-${local.slice(6, 8)}T${local.slice(9, 11)}:${local.slice(11, 13)}:${local.slice(13, 15)}`;
  return `${new Date(zonedToEpoch(iso, timeZone)).toISOString().replaceAll(/[-:]|\.\d+/g, "")}`;
}

function nextDay(day: string): string {
  const next = new Date(wallMs(`${day}T000000`) + 86_400_000).toISOString();
  return next.slice(0, 10).replaceAll("-", "");
}

function duration(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const minutes = Math.round(Math.abs(seconds) / 60);
  return minutes === 0 ? "PT0S" : `${sign}PT${minutes}M`;
}

const PRIORITY: Record<string, string> = {
  high: "1",
  высокая: "1",
  normal: "5",
  обычная: "5",
  low: "9",
  низкая: "9",
};
const priorityOf = (value: string) =>
  value ? (PRIORITY[value.trim().toLowerCase()] ?? null) : null;

function sensitivity(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (["private", "personal", "личная", "личное", "частная"].includes(v)) return "PRIVATE";
  if (["confidential", "конфиденциальная", "конфиденциально"].includes(v)) return "CONFIDENTIAL";
  return null;
}

function taskStatus(value: string, done: boolean): string | null {
  const v = value.trim().toLowerCase();
  if (done || ["completed", "завершена", "выполнена"].includes(v)) return "COMPLETED";
  if (["in progress", "выполняется"].includes(v)) return "IN-PROCESS";
  if (["not started", "не начата", ""].includes(v)) return v === "" ? null : "NEEDS-ACTION";
  return null;
}

/** An e-mail address in a cell (`Anna Berg <anna@example.com>`, `anna@example.com`); none for a name alone. */
function addressOf(value: string): string | null {
  const address = /<([^>]+@[^>]+)>/.exec(value)?.[1] ?? value.trim();
  return /^[^@\s<>]+@[^@\s<>]+$/.test(address) ? address : null;
}

/** Text as iCalendar's TEXT (RFC 5545 §3.3.11). */
const escape = (text: string) =>
  text
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");

/** FNV-1a, twice over: a row's own 16 hex digits. */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
