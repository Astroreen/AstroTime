// Outlook's calendars over Microsoft Graph (docs/plans/providers.md#D253):
// each event one calendar object, a series its master with the exceptions
// `instances` gives, as iCalendar in the store; a write is a PATCH of the
// fields that changed against Graph's own version (read just before, so
// what Graph keeps that the store does not hold is never sent), with the
// event's `If-Match`.
import {
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
import { zoneText } from "@astrotime/core/split";
import { ianaName, isKnownTimeZone, wallClockIn, zonedToEpoch } from "@astrotime/core/time";

import { GRAPH, utcOf, type Graph, type GraphTime } from "./graph.ts";

/** An event as Graph gives it (only what AstroTime reads). */
export interface GraphEvent {
  readonly id: string;
  readonly "@odata.etag"?: string;
  readonly iCalUId?: string;
  readonly subject?: string;
  readonly body?: { readonly content?: string };
  readonly start: GraphTime;
  readonly end: GraphTime;
  /** The zone the event was made in, IANA or Windows (`W. Europe Standard Time`). */
  readonly originalStartTimeZone?: string;
  readonly originalEndTimeZone?: string;
  readonly isAllDay?: boolean;
  readonly location?: { readonly displayName?: string };
  readonly categories?: readonly string[];
  readonly showAs?: string;
  readonly sensitivity?: string;
  readonly isCancelled?: boolean;
  readonly type?: "singleInstance" | "occurrence" | "exception" | "seriesMaster";
  readonly recurrence?: Recurrence | null;
  /** An exception's own occurrence, RFC 3339 UTC. */
  readonly originalStart?: string;
  readonly lastModifiedDateTime?: string;
  readonly onlineMeeting?: { readonly joinUrl?: string } | null;
}

export interface Recurrence {
  readonly pattern: {
    readonly type:
      | "daily"
      | "weekly"
      | "absoluteMonthly"
      | "relativeMonthly"
      | "absoluteYearly"
      | "relativeYearly";
    readonly interval?: number;
    readonly daysOfWeek?: readonly string[];
    readonly dayOfMonth?: number;
    readonly month?: number;
    readonly index?: "first" | "second" | "third" | "fourth" | "last";
    readonly firstDayOfWeek?: string;
  };
  readonly range: {
    readonly type: "endDate" | "noEnd" | "numbered";
    readonly startDate: string;
    readonly endDate?: string;
    readonly numberOfOccurrences?: number;
  };
}

const DAYS: Record<string, string> = {
  sunday: "SU",
  monday: "MO",
  tuesday: "TU",
  wednesday: "WE",
  thursday: "TH",
  friday: "FR",
  saturday: "SA",
};
const DAY_NAMES = Object.fromEntries(Object.entries(DAYS).map(([name, code]) => [code, name]));
const INDEX: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };
const INDEX_NAMES: Record<string, Recurrence["pattern"]["index"]> = {
  "1": "first",
  "2": "second",
  "3": "third",
  "4": "fourth",
  "-1": "last",
};

/** iCalendar's `20261231T225959Z` as RFC 3339. */
const isoOf = (value: string) =>
  value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z");
const compact = (date: string) => date.slice(0, 10).replaceAll("-", "");
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * The IANA zone a Graph zone name stands for (an IANA name, a Windows one);
 * `UTC` for Graph's own (`tzone://Microsoft/Utc`) and for one no zone
 * database knows (`Customized Time Zone`).
 */
function zoneOf(name: string | undefined): string {
  if (!name) return "UTC";
  const iana = ianaName(name);
  return iana !== "UTC" && isKnownTimeZone(iana) ? iana : "UTC";
}

/** A UTC instant (RFC 3339) as a DATE-TIME's value and parameter in `zone`: `;TZID=…:…` or `:…Z`. */
function zonedText(instant: string, zone: string): string {
  if (zone === "UTC") return `:${utcText(instant)}`;
  return `;TZID=${zone}:${wallClockIn(Date.parse(instant), zone).replace(/[-:]/g, "")}`;
}

/**
 * Graph's recurrence as an `RRULE`'s value; its end day's last second in
 * `zone`, the series' own, as `UNTIL` in UTC (RFC 5545 for a zoned start).
 */
export function rruleOf(recurrence: Recurrence, allDay: boolean, zone = "UTC"): string {
  const { pattern, range } = recurrence;
  const parts: string[] = [];
  const byDay = (prefix = "") =>
    `BYDAY=${(pattern.daysOfWeek ?? []).map((day) => `${prefix}${DAYS[day.toLowerCase()]}`).join(",")}`;
  const index = pattern.index ? String(INDEX[pattern.index]) : "1";
  switch (pattern.type) {
    case "daily":
      parts.push("FREQ=DAILY");
      break;
    case "weekly":
      parts.push("FREQ=WEEKLY", byDay());
      if (pattern.firstDayOfWeek) parts.push(`WKST=${DAYS[pattern.firstDayOfWeek.toLowerCase()]}`);
      break;
    case "absoluteMonthly":
      parts.push("FREQ=MONTHLY", `BYMONTHDAY=${pattern.dayOfMonth}`);
      break;
    case "relativeMonthly":
      parts.push("FREQ=MONTHLY", byDay(index));
      break;
    case "absoluteYearly":
      parts.push("FREQ=YEARLY", `BYMONTH=${pattern.month}`, `BYMONTHDAY=${pattern.dayOfMonth}`);
      break;
    case "relativeYearly":
      parts.push("FREQ=YEARLY", `BYMONTH=${pattern.month}`, byDay(index));
      break;
  }
  if ((pattern.interval ?? 1) > 1) parts.push(`INTERVAL=${pattern.interval}`);
  if (range.type === "numbered") parts.push(`COUNT=${range.numberOfOccurrences}`);
  if (range.type === "endDate" && range.endDate)
    parts.push(
      `UNTIL=${
        allDay
          ? compact(range.endDate)
          : utcText(
              new Date(zonedToEpoch(`${range.endDate.slice(0, 10)}T23:59:59`, zone)).toISOString(),
            )
      }`,
    );
  return parts.join(";");
}

/**
 * An `RRULE`'s value as Graph's recurrence; `null` for a rule Graph has no
 * shape for. What the rule leaves out comes from the start, as RFC 5545
 * says (`FREQ=WEEKLY` on the start's weekday); `startDate` is the start's
 * day and `zone` its zone, in which `UNTIL`'s day is read.
 */
export function recurrenceOf(rule: string, startDate: string, zone = "UTC"): Recurrence | null {
  const parts = new Map(rule.split(";").map((part) => part.split("=") as [string, string]));
  const known = new Set([
    "FREQ",
    "INTERVAL",
    "BYDAY",
    "BYMONTHDAY",
    "BYMONTH",
    "COUNT",
    "UNTIL",
    "WKST",
  ]);
  if ([...parts.keys()].some((key) => !known.has(key))) return null;
  // One whole number in Graph's range, or none; a list (`BYMONTHDAY=1,15`)
  // or one from the end (`-1`) is a shape Graph has none for.
  const whole = (name: string, max: number) => {
    const value = parts.get(name);
    if (value === undefined) return undefined;
    return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max ? Number(value) : null;
  };
  const [interval, count, monthDay, byMonth] = [
    whole("INTERVAL", 999),
    whole("COUNT", 999),
    whole("BYMONTHDAY", 31),
    whole("BYMONTH", 12),
  ];
  if ([interval, count, monthDay, byMonth].includes(null)) return null;
  const days = (parts.get("BYDAY") ?? "").split(",").filter(Boolean);
  const startDay = Number(startDate.slice(8, 10));
  const startMonth = Number(startDate.slice(5, 7));
  const plainDays = days.map((day) => /^([+-]?\d)?([A-Z]{2})$/.exec(day));
  if (plainDays.some((match) => !match)) return null;
  const indexes = new Set(plainDays.map((match) => match![1] ?? ""));
  const names = plainDays.map((match) => DAY_NAMES[match![2]!]!);
  const until = parts.get("UNTIL");
  const range: Recurrence["range"] = parts.has("COUNT")
    ? { type: "numbered", startDate, numberOfOccurrences: count! }
    : until
      ? {
          type: "endDate",
          startDate,
          endDate: until.endsWith("Z")
            ? wallClockIn(Date.parse(isoOf(until)), zone).slice(0, 10)
            : `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`,
        }
      : { type: "noEnd", startDate };
  const base = { interval: interval ?? 1 };
  const relative = indexes.size === 1 && [...indexes][0] !== "";
  const index = relative ? INDEX_NAMES[[...indexes][0]!.replace("+", "")] : undefined;
  if (relative && !index) return null;
  const wkst = parts.get("WKST");
  switch (parts.get("FREQ")) {
    case "DAILY":
      return days.length === 0 ? { pattern: { ...base, type: "daily" }, range } : null;
    case "WEEKLY":
      if (relative) return null;
      return {
        pattern: {
          ...base,
          type: "weekly",
          daysOfWeek:
            names.length > 0 ? names : [WEEKDAYS[new Date(`${startDate}T00:00:00Z`).getUTCDay()]!],
          ...(wkst ? { firstDayOfWeek: DAY_NAMES[wkst]! } : {}),
        },
        range,
      };
    case "MONTHLY":
      if (days.length === 0)
        return {
          pattern: {
            ...base,
            type: "absoluteMonthly",
            dayOfMonth: monthDay ?? startDay,
          },
          range,
        };
      return relative
        ? { pattern: { ...base, type: "relativeMonthly", daysOfWeek: names, index: index! }, range }
        : null;
    case "YEARLY": {
      // `BYDAY=4TH` with no month is the year's 4th Thursday, which Graph cannot say.
      if (relative && !parts.has("BYMONTH")) return null;
      const month = byMonth ?? startMonth;
      if (days.length === 0)
        return {
          pattern: {
            ...base,
            type: "absoluteYearly",
            month,
            dayOfMonth: monthDay ?? startDay,
          },
          range,
        };
      return relative
        ? {
            pattern: { ...base, type: "relativeYearly", month, daysOfWeek: names, index: index! },
            range,
          }
        : null;
    }
    default:
      return null;
  }
}

/**
 * An all-day event's day: Graph gives its midnight as an instant (`Prefer`
 * in UTC), so the day is that instant's in the event's own zone; Vilnius's
 * 6 November starts on the 5th in UTC. A zone not known here (UTC in its
 * place) takes the nearest midnight, right for every offset within 12 hours.
 */
function dayIn(instant: string, zone: string): string {
  const epoch = Date.parse(instant);
  return compact(
    zone === "UTC" ? new Date(epoch + 12 * 3_600_000).toISOString() : wallClockIn(epoch, zone),
  );
}

/** The zones an event's start and end are written in: its own, as Outlook shows it. */
const zonesOf = (event: GraphEvent, master: GraphEvent | null) => {
  const start = zoneOf(event.originalStartTimeZone ?? master?.originalStartTimeZone);
  return {
    start,
    end: zoneOf(
      event.originalEndTimeZone ??
        master?.originalEndTimeZone ??
        event.originalStartTimeZone ??
        master?.originalStartTimeZone,
    ),
  };
};

/**
 * One event's VEVENT lines; an exception's with its `RECURRENCE-ID` and its
 * series' UID. Times in the event's own zone, so a series keeps its wall
 * clock across a DST change (D33) and its `BYDAY` its start's weekday.
 */
function veventLines(event: GraphEvent, master: GraphEvent | null): string[] {
  const allDay = event.isAllDay === true;
  const zones = zonesOf(event, master);
  const time = (name: string, at: GraphTime, zone: string) =>
    allDay
      ? `${name};VALUE=DATE:${dayIn(utcOf(at), zone)}`
      : `${name}${zonedText(utcOf(at), zone)}`;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${master ? (master.iCalUId ?? master.id) : (event.iCalUId ?? event.id)}`,
    `DTSTAMP:${utcText(event.lastModifiedDateTime ?? "1970-01-01T00:00:00Z")}`,
  ];
  if (master && event.originalStart)
    lines.push(
      master.isAllDay
        ? `RECURRENCE-ID;VALUE=DATE:${dayIn(event.originalStart, zonesOf(master, null).start)}`
        : `RECURRENCE-ID${zonedText(event.originalStart, zonesOf(master, null).start)}`,
    );
  lines.push(time("DTSTART", event.start, zones.start), time("DTEND", event.end, zones.end));
  lines.push(`SUMMARY:${escapeText(event.subject ?? "")}`);
  if (event.body?.content) lines.push(`DESCRIPTION:${escapeText(event.body.content)}`);
  if (event.location?.displayName) lines.push(`LOCATION:${escapeText(event.location.displayName)}`);
  if (event.categories?.length)
    lines.push(`CATEGORIES:${event.categories.map(escapeText).join(",")}`);
  if (event.showAs === "free") lines.push("TRANSP:TRANSPARENT");
  if (event.sensitivity === "private" || event.sensitivity === "confidential")
    lines.push("CLASS:PRIVATE");
  if (event.isCancelled) lines.push("STATUS:CANCELLED");
  if (!master && event.recurrence)
    lines.push(`RRULE:${rruleOf(event.recurrence, allDay, zones.start)}`);
  // Graph sets it, AstroTime shows it (Outlook's own export writes it so), and never sends it.
  if (event.onlineMeeting?.joinUrl)
    lines.push(`X-MICROSOFT-SKYPETEAMSMEETINGURL:${escapeText(event.onlineMeeting.joinUrl)}`);
  lines.push("END:VEVENT");
  return lines;
}

/**
 * An event, with the exceptions of its series, as one calendar object; a
 * VTIMEZONE for each zone its times name (foundation D104).
 */
export function veventOf(event: GraphEvent, exceptions: readonly GraphEvent[] = []): string {
  const zones = new Set(
    event.isAllDay
      ? []
      : [event, ...exceptions].flatMap((one) =>
          Object.values(zonesOf(one, one === event ? null : event)),
        ),
  );
  zones.delete("UTC");
  const year = Number(event.start.dateTime.slice(0, 4));
  return calendarText([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AstroTime//Microsoft Graph//EN",
    ...[...zones].flatMap((zone) =>
      zoneText(zone, year)
        .replace(/\r?\n[ \t]/g, "")
        .split(/\r?\n/)
        .filter(Boolean),
    ),
    ...veventLines(event, null),
    ...exceptions.flatMap((exception) => veventLines(exception, event)),
    "END:VCALENDAR",
  ]);
}

/** The VEVENT properties Graph keeps, or that say nothing of the event. */
const KEPT = new Set([
  "UID",
  "DTSTAMP",
  "CREATED",
  "LAST-MODIFIED",
  "SEQUENCE",
  "RECURRENCE-ID",
  "DTSTART",
  "DTEND",
  "DURATION",
  "SUMMARY",
  "DESCRIPTION",
  "LOCATION",
  "CATEGORIES",
  "TRANSP",
  "CLASS",
  "STATUS",
  "RRULE",
  "X-MICROSOFT-SKYPETEAMSMEETINGURL",
]);

/**
 * A time line as Graph's `{ dateTime, timeZone }`: UTC, the line's own zone,
 * or for a floating time (no `Z`, no TZID) `floating`, the user's: a wall
 * clock stays the wall clock it says.
 */
function graphTime(
  component: Component,
  name: string,
  floating: string,
): { time: GraphTime; date: boolean } | null {
  const line = lineOf(component, name);
  if (!line) return null;
  const { time, date, zone } = timeOf(line);
  // A day is the user's: its midnight in their zone, as Outlook makes one.
  if (date) return { time: { dateTime: `${time}T00:00:00`, timeZone: floating }, date };
  if (time.endsWith("Z")) return { time: { dateTime: time.slice(0, -1), timeZone: "UTC" }, date };
  return { time: { dateTime: time, timeZone: zone ? ianaName(zone) : floating }, date };
}

/** A wall clock moved by an RFC 5545 `DURATION` (`P1D`, `PT1H30M`, `-PT15M`); `null` for another. */
function after(dateTime: string, duration: string): string | null {
  const parts = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    duration,
  );
  if (!parts) return null;
  const [, sign, w, d, h, m, sec] = parts.map((part) => part ?? "0");
  const seconds =
    (Number(w) * 7 * 86_400 +
      Number(d) * 86_400 +
      Number(h) * 3600 +
      Number(m) * 60 +
      Number(sec)) *
    (sign === "-" ? -1 : 1);
  return new Date(Date.parse(`${dateTime}Z`) + seconds * 1000).toISOString().slice(0, 19);
}

/**
 * A VEVENT as Graph's fields; and what it says that Graph cannot keep, by
 * property (an `RRULE` of a shape Graph has none for among it).
 */
export function eventFieldsOf(
  component: Component,
  floating = "UTC",
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
  const start = graphTime(component, "DTSTART", floating);
  // No DTEND: its DURATION's end, or none (a day for a date, the start's own instant otherwise).
  const duration = lineOf(component, "DURATION")?.value;
  const end =
    graphTime(component, "DTEND", floating) ??
    (start && {
      time: {
        ...start.time,
        dateTime:
          after(start.time.dateTime, duration ?? (start.date ? "P1D" : "PT0S")) ??
          start.time.dateTime,
      },
      date: start.date,
    });
  const fields: Record<string, unknown> = {
    subject: text("SUMMARY") ?? "",
    body: { contentType: "text", content: text("DESCRIPTION") ?? "" },
    location: { displayName: text("LOCATION") ?? "" },
    categories: (lineOf(component, "CATEGORIES")?.value ?? "")
      .split(/(?<!\\),/)
      .filter(Boolean)
      .map(unescapeText),
    showAs: lineOf(component, "TRANSP")?.value.toUpperCase() === "TRANSPARENT" ? "free" : "busy",
    sensitivity: /^(PRIVATE|CONFIDENTIAL)$/i.test(lineOf(component, "CLASS")?.value ?? "")
      ? "private"
      : "normal",
    ...(start ? { start: start.time, isAllDay: start.date } : {}),
    ...(end ? { end: end.time } : {}),
  };
  // No rule is `null`, which ends a series; a rule Graph cannot say is not sent, and said.
  const rule = lineOf(component, "RRULE");
  if (!rule) fields["recurrence"] = null;
  else if (start) {
    const recurrence = recurrenceOf(
      rule.value,
      start.time.dateTime.slice(0, 10),
      start.time.timeZone,
    );
    if (recurrence) fields["recurrence"] = recurrence;
    else dropped.add("RRULE");
  }
  if (
    lineOf(component, "STATUS") &&
    lineOf(component, "STATUS")!.value.toUpperCase() !== "CONFIRMED"
  )
    dropped.add("STATUS");
  return { fields, dropped: [...dropped] };
}

/** The master's and the exceptions' components of a calendar object. */
function eventsIn(ics: string): { master: Component | null; exceptions: Component[] } {
  const events = (componentsOf(ics)[0]?.components ?? []).filter((c) => c.name === "VEVENT");
  return {
    master: events.find((event) => !lineOf(event, "RECURRENCE-ID")) ?? null,
    exceptions: events.filter((event) => lineOf(event, "RECURRENCE-ID")),
  };
}

/** A series' exceptions as what Graph would be asked to keep of each, for comparing. */
const exceptionsKey = (exceptions: readonly Component[], zone: string) =>
  JSON.stringify(
    exceptions
      .map((c) => [lineOf(c, "RECURRENCE-ID")?.value ?? "", eventFieldsOf(c, zone).fields] as const)
      .toSorted(([a], [b]) => a.localeCompare(b)),
  );

/** How far around today a series' exceptions are read (`instances` takes a window). */
const WINDOW_BEFORE_MS = 365 * 86_400_000;
const WINDOW_AFTER_MS = 2 * 365 * 86_400_000;

/** An object's ETag: the event's own, then its exceptions' (an edit of one changes it). */
const etagOf = (event: GraphEvent, exceptions: readonly GraphEvent[]) =>
  [event["@odata.etag"] ?? "", ...exceptions.map((e) => e["@odata.etag"] ?? "")].join(" ");
/** The event's own `@odata.etag`, for its `If-Match`. */
const ownEtag = (etag: string | null) => (etag ? etag.split(" ")[0]! : null);

/** A Microsoft account's Outlook calendars, as a provider. */
export class OutlookCalendars implements Provider {
  private readonly graph: Graph;
  private readonly clock: () => number;
  /** The user's zone, a floating time's when written (an IANA name). */
  private readonly zone: string;

  constructor(
    graph: Graph,
    clock: () => number = Date.now,
    zone = new Intl.DateTimeFormat().resolvedOptions().timeZone,
  ) {
    this.graph = graph;
    this.clock = clock;
    this.zone = zone;
  }

  async calendars(): Promise<RemoteCalendar[]> {
    const calendars = await this.graph.all<{
      id: string;
      name?: string;
      hexColor?: string;
      canEdit?: boolean;
    }>(`${GRAPH}me/calendars?$top=100`);
    return calendars.map((calendar) => ({
      url: `${GRAPH}me/calendars/${encodeURIComponent(calendar.id)}/events/`,
      name: calendar.name ?? "",
      color: calendar.hexColor || null,
      components: ["VEVENT"],
      rights:
        calendar.canEdit === false
          ? { create: false, edit: false, delete: false }
          : { create: true, edit: true, delete: true },
    }));
  }

  private itemUrl(href: string): string {
    return `${GRAPH}me/events/${href.slice(href.lastIndexOf("/") + 1)}`;
  }

  private async exceptionsOf(eventId: string): Promise<GraphEvent[]> {
    const now = this.clock();
    const url = new URL(`${GRAPH}me/events/${encodeURIComponent(eventId)}/instances`);
    url.searchParams.set("startDateTime", new Date(now - WINDOW_BEFORE_MS).toISOString());
    url.searchParams.set("endDateTime", new Date(now + WINDOW_AFTER_MS).toISOString());
    url.searchParams.set("$top", "100");
    return (await this.graph.all<GraphEvent>(url.href)).filter(
      (event) => event.type === "exception",
    );
  }

  /**
   * Every single event and series master of the calendar, compared with
   * what the device has by ETag. A series whose master is unchanged is not
   * asked its exceptions again: an exception edited elsewhere, its master
   * untouched, comes with the master's next change (to be recorded, D253).
   */
  async changes(
    calendarUrl: string,
    _state: SyncState,
    known: ReadonlyMap<string, string | null>,
  ): Promise<Changes> {
    const events = await this.graph.all<GraphEvent>(`${calendarUrl.replace(/\/$/, "")}?$top=100`);
    const changed: RemoteObject[] = [];
    const listed = new Set<string>();
    for (const event of events) {
      const href = `${calendarUrl}${encodeURIComponent(event.id)}`;
      listed.add(href);
      const kept = known.get(href) ?? null;
      if (kept !== null && ownEtag(kept) === (event["@odata.etag"] ?? "")) continue;
      const exceptions = event.type === "seriesMaster" ? await this.exceptionsOf(event.id) : [];
      changed.push({ href, etag: etagOf(event, exceptions), ics: veventOf(event, exceptions) });
    }
    const removed = [...known.keys()].filter((href) => !listed.has(href));
    return { changed, removed, syncToken: null, ctag: null };
  }

  async fetch(href: string): Promise<RemoteObject | null> {
    const { status, value } = await this.graph.json<GraphEvent>("GET", this.itemUrl(href), {
      accept: [404],
    });
    if (status === 404 || !value) return null;
    const exceptions = value.type === "seriesMaster" ? await this.exceptionsOf(value.id) : [];
    return { href, etag: etagOf(value, exceptions), ics: veventOf(value, exceptions) };
  }

  async create(href: string, ics: string): Promise<WriteResult> {
    const calendarUrl = href.slice(0, href.lastIndexOf("/") + 1);
    const { master, exceptions } = eventsIn(ics);
    if (!master) throw new Error("A calendar object with no event.");
    const { fields, dropped } = eventFieldsOf(master, this.zone);
    // Graph's `iCalUId` is its own; `transactionId`, the UID here, makes a
    // create sent again (its answer lost) the event already made, not a second.
    const uid = lineOf(master, "UID")?.value;
    const { value } = await this.graph.json<GraphEvent>("POST", calendarUrl.replace(/\/$/, ""), {
      body: {
        ...Object.fromEntries(Object.entries(fields).filter(([, field]) => field !== null)),
        ...(uid ? { transactionId: uid } : {}),
      },
    });
    if (!value) throw new Error("Graph gave no event back.");
    // A series made here with its own exceptions: written as a series, its exceptions not (D253's Deferred).
    const notKept = exceptions.length > 0 ? [...dropped, "RECURRENCE-ID"] : dropped;
    return {
      ok: true,
      href: `${calendarUrl}${encodeURIComponent(value.id)}`,
      etag: etagOf(value, []),
      ...(notKept.length > 0 ? { dropped: notKept } : {}),
    };
  }

  /**
   * The fields that changed against Graph's own version, read just before:
   * one `PATCH` with the event's `If-Match`; refused (`412`), a conflict for
   * the sync's merge. An occurrence's own edit is not written yet (Deferred).
   */
  async update(href: string, ics: string, etag: string | null): Promise<WriteResult> {
    const { master, exceptions } = eventsIn(ics);
    if (!master) throw new Error("A calendar object with no event.");
    const current = await this.graph.json<GraphEvent>("GET", this.itemUrl(href), { accept: [404] });
    if (current.status === 404 || !current.value) return { ok: false, reason: "gone" };
    const now = eventsIn(veventOf(current.value)).master!;
    const before = eventFieldsOf(now, this.zone).fields;
    const { fields, dropped } = eventFieldsOf(master, this.zone);
    // Every field either side has: one gone here is `null` in `fields` (a
    // series made single). One only Graph's has is one not sent (an RRULE
    // Graph cannot say, among `dropped`), left as Graph has it.
    const changed = Object.fromEntries(
      Object.entries(fields).filter(
        ([key, value]) => JSON.stringify(before[key] ?? null) !== JSON.stringify(value),
      ),
    );
    const own = ownEtag(etag) ?? current.value["@odata.etag"] ?? null;
    let event = current.value;
    if (Object.keys(changed).length > 0) {
      const patched = await this.graph.json<GraphEvent>("PATCH", this.itemUrl(href), {
        body: changed,
        etag: own,
        accept: [404, 412],
      });
      if (patched.status === 404) return { ok: false, reason: "gone" };
      if (patched.status === 412) return { ok: false, reason: "conflict" };
      event = patched.value ?? event;
    }
    const serverExceptions = event.type === "seriesMaster" ? await this.exceptionsOf(event.id) : [];
    const edited =
      exceptionsKey(exceptions, this.zone) !==
      exceptionsKey(eventsIn(veventOf(event, serverExceptions)).exceptions, this.zone);
    const notKept = edited ? [...dropped, "RECURRENCE-ID"] : dropped;
    return {
      ok: true,
      href,
      etag: etagOf(event, serverExceptions),
      ...(notKept.length > 0 ? { dropped: [...new Set(notKept)] } : {}),
    };
  }

  async remove(href: string, etag: string | null): Promise<WriteResult> {
    const { status } = await this.graph.json("DELETE", this.itemUrl(href), {
      etag: ownEtag(etag),
      accept: [404, 412],
    });
    if (status === 404) return { ok: false, reason: "gone" };
    if (status === 412) return { ok: false, reason: "conflict" };
    return { ok: true, href, etag: null };
  }
}
