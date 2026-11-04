// vCalendar 1.0 (`.vcs`, versit 1996) as iCalendar 2.0, for import
// (docs/plans/import.md#D266, #D272): what older phones (Nokia, Samsung,
// Sony) and Outlook's "vCalendar format" write. Each property is mapped to
// its iCalendar form where it has one: quoted-printable text in its charset,
// local times through the file's `TZ` and `DAYLIGHT`, alarms relative to the
// start, 1.0's rule grammar as an `RRULE`; what has no home is named in
// `notImported`, never written as something it is not. Loaded only for a
// vCalendar 1.0 file.
import { wallClockIn, zonedToEpoch } from "@astrotime/core";
import { zoneText } from "@astrotime/core/split";

export interface Converted {
  /** The file as iCalendar 2.0, for `splitCalendars`. */
  readonly text: string;
  /** The properties not carried over, by name. */
  readonly notImported: readonly string[];
}

interface Line {
  readonly name: string;
  readonly params: ReadonlyMap<string, string>;
  /** Bare parameters (`QUOTED-PRINTABLE`, `UTF-8`), as 1.0 allows. */
  readonly bare: readonly string[];
  readonly value: string;
}

export function vcalendarToIcs(text: string, options: { readonly timeZone: string }): Converted {
  const notImported = new Set<string>();
  const out: string[] = [];
  let zone: Zone = { offset: null, daylight: [], tzid: null, definition: [] };
  /** Whether the calendar's zone was settled (at its first component, after its `TZ` and `DAYLIGHT`). */
  let settled = false;
  /** The component being converted: its kind and its lines. */
  let component: { name: string; lines: Line[] } | null = null;
  const convert = () => {
    if (!component) return;
    if (!settled) {
      zone = settle(zone, options.timeZone);
      settled = true;
    }
    out.push(
      ...convertComponent(component.name, component.lines, zone, options.timeZone, notImported),
    );
    component = null;
  };
  /** One whose END never came: kept, as far as it went, and named (D272). */
  const cutShort = () => {
    if (!component) return;
    notImported.add(`${component.name} without END`);
    convert();
  };
  const close = () => {
    cutShort();
    if (zone.tzid !== null) out.push(...zone.definition);
    out.push("END:VCALENDAR");
  };
  let open = false;
  for (const line of linesOf(text)) {
    if (line.name === "BEGIN" || line.name === "END") {
      const kind = line.value.trim().toUpperCase();
      if (line.name === "BEGIN" && kind === "VCALENDAR") {
        if (open) close();
        open = true;
        settled = false;
        zone = { offset: null, daylight: [], tzid: null, definition: [] };
        out.push("BEGIN:VCALENDAR", "VERSION:2.0");
      } else if (line.name === "END" && kind === "VCALENDAR") {
        close();
        open = false;
      } else if (line.name === "BEGIN" && (kind === "VEVENT" || kind === "VTODO")) {
        cutShort();
        component = { name: kind, lines: [] };
      } else if (line.name === "END" && component && kind === component.name) convert();
      else notImported.add(`${line.name}:${kind}`);
      continue;
    }
    if (component) {
      component.lines.push(line);
      continue;
    }
    // The calendar's own lines.
    switch (line.name) {
      case "VERSION":
        break;
      case "TZ":
        zone = { ...zone, offset: offsetOf(line.value) };
        break;
      case "DAYLIGHT": {
        const period = daylightOf(line.value);
        if (period) zone = { ...zone, daylight: [...zone.daylight, period] };
        break;
      }
      case "PRODID":
        out.push(`PRODID:${escape(textOf(line))}`);
        break;
      default:
        if (line.name.startsWith("X-")) out.push(`${line.name}:${escape(textOf(line))}`);
        else notImported.add(line.name);
    }
  }
  if (open) close();
  return { text: `${out.join("\r\n")}\r\n`, notImported: [...notImported] };
}

/** The file's content lines: unfolded, a quoted-printable value's soft breaks joined. */
function linesOf(text: string): Line[] {
  const raw = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const lines: Line[] = [];
  let current = "";
  const flush = () => {
    if (current.trim() !== "") {
      const line = parse(current);
      if (line) lines.push(line);
    }
    current = "";
  };
  for (const piece of raw) {
    // A quoted-printable value ending in "=" (white space after it allowed)
    // goes on to the next line as it is, a space it starts with its text:
    // asked first, so that space is not taken for a fold.
    if (
      /QUOTED-PRINTABLE/i.test(current.slice(0, current.indexOf(":") + 1)) &&
      /=[ \t]*$/.test(current)
    ) {
      current = current.replace(/=[ \t]*$/, "") + piece;
      continue;
    }
    // Folded: a line that starts with white space goes on the one before (1.0 keeps the space).
    if (/^[ \t]/.test(piece) && current !== "") {
      current += piece;
      continue;
    }
    flush();
    current = piece;
  }
  flush();
  return lines;
}

function parse(text: string): Line | null {
  const colon = text.indexOf(":");
  if (colon < 0) return null;
  const [name = "", ...parts] = text.slice(0, colon).split(";");
  const params = new Map<string, string>();
  const bare: string[] = [];
  for (const part of parts) {
    const equals = part.indexOf("=");
    if (equals < 0) bare.push(part.toUpperCase());
    else params.set(part.slice(0, equals).toUpperCase(), part.slice(equals + 1));
  }
  return { name: name.toUpperCase(), params, bare, value: text.slice(colon + 1) };
}

/** A value as text: quoted-printable decoded in its charset, 1.0's `\;` unescaped. */
function textOf(line: Line): string {
  const encoding = (line.params.get("ENCODING") ?? line.bare.find(isEncoding) ?? "").toUpperCase();
  let value = line.value;
  if (encoding === "QUOTED-PRINTABLE") {
    const bytes: number[] = [];
    for (let i = 0; i < value.length; i++) {
      const hex = value[i] === "=" ? /^[0-9A-Fa-f]{2}/.exec(value.slice(i + 1, i + 3)) : null;
      if (hex) {
        bytes.push(parseInt(hex[0], 16));
        i += 2;
      } else {
        // Text already decoded from the file: its own UTF-8 bytes.
        bytes.push(...new TextEncoder().encode(value[i]));
      }
    }
    const charset =
      line.params.get("CHARSET") ??
      line.bare.find((b) => /^(UTF-8|WINDOWS-\d+|ISO-8859-\d+)$/.test(b)) ??
      "utf-8";
    try {
      value = new TextDecoder(charset).decode(new Uint8Array(bytes));
    } catch {
      value = new TextDecoder().decode(new Uint8Array(bytes));
    }
  }
  return value.replaceAll("\\;", ";").replaceAll(/\r\n|\r/g, "\n");
}

const isEncoding = (bare: string) => /^(QUOTED-PRINTABLE|BASE64|8BIT|7BIT)$/.test(bare);

/** Text as iCalendar's TEXT (RFC 5545 §3.3.11). */
const escape = (text: string) =>
  text
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");

// Time

/**
 * The file's `TZ` (minutes east of UTC) and its `DAYLIGHT` periods, and,
 * once settled, the zone its local times are written in: the user's own
 * where its offsets are the file's, else one made of them (`definition`,
 * its `VTIMEZONE`); none without a `TZ`, so they stay floating.
 */
interface Zone {
  readonly offset: number | null;
  readonly daylight: readonly {
    readonly offset: number;
    readonly from: number;
    readonly to: number;
  }[];
  readonly tzid: string | null;
  /** Whether `tzid` is an IANA zone (the user's), whose rules hold for every year. */
  readonly iana?: boolean;
  readonly definition: readonly string[];
}

/** The offset of an IANA zone at an instant, in minutes east of UTC. */
const offsetIn = (timeZone: string, utc: number) =>
  Math.round((Date.parse(`${wallClockIn(utc, timeZone)}Z`) - utc) / 60_000);

const DAY = 86_400_000;

/** `+0300` for 180 minutes. */
const offsetText = (minutes: number) =>
  `${minutes < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(minutes) / 60))}${pad(Math.abs(minutes) % 60)}`;

/**
 * The zone a calendar's local times are written in, so a series keeps its
 * wall clock across a change of offset: the user's own (its rules for every
 * year) where it has the file's offsets, in and out of each `DAYLIGHT`
 * period; else a `VTIMEZONE` made of the file's `TZ` and `DAYLIGHT`s
 * (exact for the years they name, the standard offset beyond).
 */
function settle(zone: Zone, timeZone: string): Zone {
  if (zone.offset === null) return zone;
  const std = zone.offset;
  const year = new Date(zone.daylight[0]?.from ?? Date.UTC(2020, 0, 1)).getUTCFullYear();
  const samples =
    zone.daylight.length > 0
      ? zone.daylight.flatMap((p) => [
          [p.from - p.offset * 60_000 + DAY, p.offset],
          [p.to - p.offset * 60_000 + DAY, std],
        ])
      : [
          [Date.UTC(year, 0, 15), std],
          [Date.UTC(year, 6, 15), std],
        ];
  if (samples.every(([utc, offset]) => offsetIn(timeZone, utc!) === offset)) {
    const definition = zoneText(timeZone, year).split(/\r?\n/).filter(Boolean);
    return { ...zone, tzid: timeZone, iana: true, definition };
  }
  const tzid = `vCalendar ${offsetText(std)}${zone.daylight.length > 0 ? `/${offsetText(zone.daylight[0]!.offset)}` : ""}`;
  const observance = (kind: string, start: number, from: number, to: number) => [
    `BEGIN:${kind}`,
    `DTSTART:${stamp(start, false)}`,
    `TZOFFSETFROM:${offsetText(from)}`,
    `TZOFFSETTO:${offsetText(to)}`,
    `END:${kind}`,
  ];
  const definition = [
    "BEGIN:VTIMEZONE",
    `TZID:${tzid}`,
    ...observance("STANDARD", Date.UTC(1970, 0, 1), std, std),
    ...zone.daylight.flatMap((p) => [
      ...observance("DAYLIGHT", p.from, std, p.offset),
      ...observance("STANDARD", p.to, p.offset, std),
    ]),
    "END:VTIMEZONE",
  ];
  return { ...zone, tzid, definition };
}

/** `-05`, `+03:00`, `+0530` as minutes east of UTC. */
function offsetOf(value: string): number | null {
  const match = /^([+-])?(\d{1,2}):?(\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

/** `TRUE;-04;19960407T025959;19961027T010000;EST;EDT`: the offset and the local times it runs between. */
function daylightOf(value: string) {
  const [on, offset, from, to] = value.split(";");
  if (on?.toUpperCase() !== "TRUE" || !offset || !from || !to) return null;
  const minutes = offsetOf(offset);
  const start = localMs(from);
  const end = localMs(to);
  return minutes === null || start === null || end === null
    ? null
    : { offset: minutes, from: start, to: end };
}

/** A 1.0 date or date-time as milliseconds of its wall clock read as UTC; null if unreadable. */
function localMs(value: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?Z?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = match;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (ms: number, utc: boolean) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}${utc ? "Z" : ""}`;
};

/** A 1.0 time as iCalendar writes it, and the instant it names (a floating one's wall clock read as UTC). */
interface Time {
  readonly kind: "date" | "utc" | "zoned" | "floating";
  /** What follows the property's name: `;VALUE=DATE:…`, `;TZID=…:…`, or `:…`. */
  readonly text: string;
  /** Its value alone, as a list (`EXDATE`) or a rule's `UNTIL` takes it. */
  readonly value: string;
  readonly ms: number;
}

/**
 * A 1.0 time as an iCalendar one: a date stays a date; UTC stays UTC; a
 * local time keeps its wall clock in the calendar's zone (`settle`), its
 * instant through the file's `TZ` (and the `DAYLIGHT` it falls in); with no
 * `TZ` it stays floating.
 */
function timeOf(value: string, zone: Zone): Time | null {
  const trimmed = value.trim();
  const ms = localMs(trimmed);
  if (ms === null) return null;
  if (/^\d{8}$/.test(trimmed))
    return { kind: "date", text: `;VALUE=DATE:${trimmed}`, value: trimmed, ms };
  if (trimmed.endsWith("Z")) {
    const utc = stamp(ms, true);
    return { kind: "utc", text: `:${utc}`, value: utc, ms };
  }
  const local = stamp(ms, false);
  if (zone.offset === null || zone.tzid === null)
    return { kind: "floating", text: `:${local}`, value: local, ms };
  // The instant by the zone's own rules where it is the user's, else by the file's offsets.
  const offset = zone.daylight.find((p) => ms >= p.from && ms < p.to)?.offset ?? zone.offset;
  return {
    kind: "zoned",
    text: `;TZID=${zone.tzid}:${local}`,
    value: local,
    ms: zone.iana
      ? zonedToEpoch(new Date(ms).toISOString().slice(0, 19), zone.tzid)
      : ms - offset * 60_000,
  };
}

/**
 * The day a time falls on for the user: an all-day event's (Outlook writes
 * local midnights, in UTC too: `…T210000Z` is the next day in UTC+3).
 */
function dayOf(value: string, zone: Zone, timeZone: string): string | null {
  const time = timeOf(value, zone);
  if (!time) return null;
  if (time.kind === "date") return time.value;
  if (time.kind === "floating") return time.value.slice(0, 8);
  // The instant on the file's wall clock where it has one, else the user's.
  const wall =
    zone.offset !== null
      ? new Date(time.ms + offsetAtUtc(zone, time.ms) * 60_000).toISOString()
      : `${wallClockIn(time.ms, timeZone)}Z`;
  return wall.slice(0, 10).replaceAll("-", "");
}

/** The file's offset at an instant: its `DAYLIGHT` where the instant falls in one. */
function offsetAtUtc(zone: Zone, utc: number): number {
  const daylight = zone.daylight.find(
    (p) => utc + p.offset * 60_000 >= p.from && utc + p.offset * 60_000 < p.to,
  );
  return daylight?.offset ?? zone.offset ?? 0;
}

/** A property of times: `NAME;VALUE=DATE:…`, `NAME;TZID=…:…` or `NAME:…`. */
const timeLine = (name: string, time: Time) => `${name}${time.text}`;

/** Seconds as an iCalendar DURATION: `-PT15M`, `P1D`. */
function duration(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  let rest = Math.abs(Math.round(seconds));
  if (rest === 0) return "PT0S";
  const days = Math.floor(rest / 86_400);
  rest -= days * 86_400;
  const h = Math.floor(rest / 3600);
  const m = Math.floor((rest % 3600) / 60);
  const s = rest % 60;
  const time = `${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s ? `${s}S` : ""}`;
  return `${sign}P${days ? `${days}D` : ""}${time ? `T${time}` : ""}`;
}

// Components

const PRIORITY: Record<string, string> = { "1": "1", "2": "5", "3": "9" };
const STATUS: Record<string, Record<string, string>> = {
  VEVENT: { TENTATIVE: "TENTATIVE", CONFIRMED: "CONFIRMED", CANCELLED: "CANCELLED" },
  VTODO: {
    "NEEDS ACTION": "NEEDS-ACTION",
    "NEEDS-ACTION": "NEEDS-ACTION",
    COMPLETED: "COMPLETED",
    "IN-PROCESS": "IN-PROCESS",
    CANCELLED: "CANCELLED",
  },
};
const PARTSTAT: Record<string, string> = {
  ACCEPTED: "ACCEPTED",
  CONFIRMED: "ACCEPTED",
  DECLINED: "DECLINED",
  TENTATIVE: "TENTATIVE",
  DELEGATED: "DELEGATED",
  COMPLETED: "COMPLETED",
  "NEEDS ACTION": "NEEDS-ACTION",
  SENT: "NEEDS-ACTION",
};
const EXPECT: Record<string, string> = {
  REQUIRE: "REQ-PARTICIPANT",
  REQUEST: "OPT-PARTICIPANT",
  FYI: "NON-PARTICIPANT",
  IMMEDIATE: "REQ-PARTICIPANT",
};

function convertComponent(
  name: string,
  lines: readonly Line[],
  zone: Zone,
  timeZone: string,
  notImported: Set<string>,
): string[] {
  const out = [`BEGIN:${name}`];
  const alarms: string[] = [];
  const at = (field: string) => {
    const line = lines.find((one) => one.name === field);
    return line ? timeOf(line.value, zone) : null;
  };
  const start = at("DTSTART");
  // A task's alarms without a start are its due time's.
  const due = name === "VTODO" ? at("DUE") : null;
  const allDay = lines.some(
    (line) =>
      line.name === "X-MICROSOFT-CDO-ALLDAYEVENT" && line.value.trim().toUpperCase() === "TRUE",
  );
  /** How the start is written: an exception date or a rule's end is written the same way (RFC 5545). */
  const startKind = allDay ? "date" : (start?.kind ?? "utc");
  let organizer = false;
  for (const line of lines) {
    const text = () => escape(textOf(line));
    switch (line.name) {
      case "SUMMARY":
      case "DESCRIPTION":
      case "LOCATION":
      case "UID":
      case "URL":
      case "RELATED-TO":
        out.push(`${line.name}:${line.name === "URL" ? textOf(line) : text()}`);
        break;
      case "CATEGORIES":
      case "RESOURCES":
        out.push(`${line.name}:${textOf(line).split(";").map(escape).join(",")}`);
        break;
      case "DTSTART":
      case "DTEND":
      case "DUE":
      case "COMPLETED":
      case "LAST-MODIFIED":
      case "DCREATED": {
        const iname = line.name === "DCREATED" ? "CREATED" : line.name;
        // Outlook's all-day event: from one local midnight to the next, as the user's days.
        if (allDay && (iname === "DTSTART" || iname === "DTEND")) {
          const day = dayOf(line.value, zone, timeZone);
          if (day) out.push(`${iname};VALUE=DATE:${day}`);
          else notImported.add(line.name);
          break;
        }
        const time = timeOf(line.value, zone);
        // CREATED, LAST-MODIFIED and COMPLETED are UTC (RFC 5545); a local one through its zone.
        const utc = iname === "CREATED" || iname === "LAST-MODIFIED" || iname === "COMPLETED";
        if (!time || (utc && (time.kind === "date" || time.kind === "floating")))
          notImported.add(line.name);
        else out.push(utc ? `${iname}:${stamp(time.ms, true)}` : timeLine(iname, time));
        break;
      }
      case "EXDATE":
      case "RDATE": {
        const values = line.value.split(";").filter((value) => value.trim() !== "");
        const list = timesLike(values, startKind, zone, timeZone);
        if (list) out.push(`${line.name}${list}`);
        else notImported.add(line.name);
        break;
      }
      case "RRULE":
      case "EXRULE": {
        // A rule's end: UTC for a zoned start (RFC 5545 §3.3.10), else as the start is written.
        const rule = ruleOf(line.value, (until) => {
          if (startKind !== "zoned") return timesLike([until], startKind, zone, timeZone);
          const time = timeOf(until, zone);
          return time ? stamp(time.ms, true) : null;
        });
        if (rule) out.push(`${line.name}:${rule}`);
        else notImported.add(line.name);
        break;
      }
      case "PRIORITY": {
        const value = line.value.trim();
        const priority = PRIORITY[value] ?? (/^[0-9]$/.test(value) ? value : null);
        if (priority) out.push(`PRIORITY:${priority}`);
        else notImported.add(line.name);
        break;
      }
      case "STATUS": {
        const status = STATUS[name]?.[line.value.trim().toUpperCase()];
        if (status) out.push(`STATUS:${status}`);
        else notImported.add(line.name);
        break;
      }
      case "CLASS": {
        const value = line.value.trim().toUpperCase();
        if (["PUBLIC", "PRIVATE", "CONFIDENTIAL"].includes(value)) out.push(`CLASS:${value}`);
        else notImported.add(line.name);
        break;
      }
      case "TRANSP": {
        const value = line.value.trim().toUpperCase();
        out.push(`TRANSP:${value === "0" || value === "OPAQUE" ? "OPAQUE" : "TRANSPARENT"}`);
        break;
      }
      case "SEQUENCE":
        if (/^\d+$/.test(line.value.trim())) out.push(`SEQUENCE:${line.value.trim()}`);
        break;
      case "ATTENDEE": {
        const { name: cn, address } = personOf(textOf(line));
        if (!address) {
          notImported.add(line.name);
          break;
        }
        const role = (line.params.get("ROLE") ?? "").toUpperCase();
        const cnParam = cn ? `;CN="${cn.replaceAll('"', "'")}"` : "";
        if ((role === "ORGANIZER" || role === "OWNER") && !organizer) {
          organizer = true;
          out.push(`ORGANIZER${cnParam}:mailto:${address}`);
          break;
        }
        const partstat = PARTSTAT[(line.params.get("STATUS") ?? "").toUpperCase()];
        const expect = EXPECT[(line.params.get("EXPECT") ?? "").toUpperCase()];
        const rsvp = line.params.get("RSVP")?.toUpperCase();
        out.push(
          `ATTENDEE${cnParam}${partstat ? `;PARTSTAT=${partstat}` : ""}${expect ? `;ROLE=${expect}` : ""}${rsvp === "YES" ? ";RSVP=TRUE" : rsvp === "NO" ? ";RSVP=FALSE" : ""}:mailto:${address}`,
        );
        break;
      }
      case "AALARM":
      case "DALARM":
      case "MALARM": {
        const alarm = alarmOf(line, start, due, zone);
        if (alarm) alarms.push(...alarm);
        else notImported.add(line.name);
        break;
      }
      case "ATTACH": {
        const value = textOf(line).trim();
        if (/^(https?|ftp|cid):/i.test(value)) out.push(`ATTACH:${value}`);
        else notImported.add(line.name);
        break;
      }
      // How many times it repeats, which its rule says already.
      case "RNUM":
        break;
      default:
        if (line.name.startsWith("X-")) out.push(`${line.name}:${text()}`);
        else notImported.add(line.name);
    }
  }
  out.push(...alarms, `END:${name}`);
  return out;
}

/** `Anna Berg <anna@example.com>`, `mailto:anna@example.com`, `anna@example.com`. */
function personOf(value: string): { name: string | null; address: string | null } {
  const angle = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (angle) return { name: angle[1]!.trim() || null, address: angle[2]!.replace(/^mailto:/i, "") };
  const address = value.trim().replace(/^mailto:/i, "");
  return { name: null, address: /^[^@\s]+@[^@\s]+$/.test(address) ? address : null };
}

/**
 * An `AALARM`, `DALARM` or `MALARM` (`run time;snooze;repeat;content`, a
 * mail alarm's content its address then its note) as a `VALARM`, its time
 * relative to the start, so each occurrence of a series has it.
 */
function alarmOf(line: Line, start: Time | null, due: Time | null, zone: Zone): string[] | null {
  const [run = "", snooze = "", repeat = "", ...content] = textOf(line).split(";");
  const time = timeOf(run, zone);
  if (!time) return null;
  // Relative to the start, else a task's due time; else at its instant,
  // which iCalendar writes in UTC alone (RFC 5545 §3.8.6.3): a floating or
  // dated one has none, and is named as not carried over.
  const trigger = start
    ? `TRIGGER:${duration((time.ms - start.ms) / 1000)}`
    : due
      ? `TRIGGER;RELATED=END:${duration((time.ms - due.ms) / 1000)}`
      : time.kind === "utc" || time.kind === "zoned"
        ? `TRIGGER;VALUE=DATE-TIME:${stamp(time.ms, true)}`
        : null;
  if (!trigger) return null;
  const out = ["BEGIN:VALARM"];
  if (line.name === "AALARM") out.push("ACTION:AUDIO", trigger);
  else if (line.name === "DALARM")
    out.push("ACTION:DISPLAY", trigger, `DESCRIPTION:${escape(content.join(";") || "Reminder")}`);
  else {
    const [address = "", ...note] = content;
    if (!/@/.test(address)) return null;
    out.push(
      "ACTION:EMAIL",
      trigger,
      `ATTENDEE:mailto:${address.replace(/^mailto:/i, "")}`,
      `SUMMARY:${escape(note.join(";") || "Reminder")}`,
      `DESCRIPTION:${escape(note.join(";") || "Reminder")}`,
    );
  }
  const every = snooze.trim().startsWith("P") ? snooze.trim() : null;
  if (every && /^\d+$/.test(repeat.trim()) && Number(repeat) > 0)
    out.push(`REPEAT:${Number(repeat)}`, `DURATION:${every}`);
  out.push("END:VALARM");
  return out;
}

/**
 * Times written as the start is (RFC 5545: an `EXDATE`'s, an `RDATE`'s, a
 * rule's `UNTIL`): what follows the property's name, `;VALUE=DATE:…`,
 * `;TZID=…:…` or `:…`, values comma-separated. Null for one that cannot be
 * read. A rule's `UNTIL` for a zoned start is written in UTC by `until`'s caller.
 */
function timesLike(
  values: readonly string[],
  startKind: Time["kind"],
  zone: Zone,
  timeZone: string,
): string | null {
  const written: string[] = [];
  for (const value of values) {
    if (startKind === "date") {
      const day = dayOf(value, zone, timeZone);
      if (!day) return null;
      written.push(day);
      continue;
    }
    const time = timeOf(value, zone);
    if (!time) return null;
    written.push(
      startKind === "floating"
        ? time.kind === "utc"
          ? stamp(time.ms, false)
          : time.value
        : startKind === "zoned" && time.kind === "zoned"
          ? time.value
          : stamp(time.ms, true),
    );
  }
  if (written.length === 0) return null;
  if (startKind === "date") return `;VALUE=DATE:${written.join(",")}`;
  if (startKind === "zoned" && zone.tzid !== null && written.every((w) => !w.endsWith("Z")))
    return `;TZID=${zone.tzid}:${written.join(",")}`;
  return `:${written.join(",")}`;
}

const WEEKDAY = /^(SU|MO|TU|WE|TH|FR|SA)\$?$/;
const FREQUENCY: Record<string, string> = {
  D: "DAILY",
  W: "WEEKLY",
  MP: "MONTHLY",
  MD: "MONTHLY",
  YM: "YEARLY",
  YD: "YEARLY",
};

/**
 * 1.0's rule grammar (`W1 MO WE #10`, `MP1 1+ MO #0`, `MD1 1 15 20271231T000000`)
 * as an iCalendar `RRULE`; null for what it cannot say (a rule of several
 * parts, a modifier it does not know).
 */
function ruleOf(value: string, until: (value: string) => string | null): string | null {
  const tokens = value.trim().split(/\s+/);
  const head = /^(D|W|MP|MD|YM|YD)(\d+)$/.exec(tokens[0] ?? "");
  if (!head) return null;
  const [, kind = "", interval = "1"] = head;
  const parts = [`FREQ=${FREQUENCY[kind]}`];
  if (interval !== "1") parts.push(`INTERVAL=${interval}`);
  const days: string[] = [];
  const numbers: string[] = [];
  const occurrences: string[] = [];
  let end: string | null = null;
  for (const token of tokens.slice(1)) {
    if (end !== null) return null; // Another rule after this one's end: several parts.
    if (/^#\d+$/.test(token)) {
      end = token === "#0" ? "" : `COUNT=${token.slice(1)}`;
      continue;
    }
    // Its end as its start is written: a date, UTC for a zoned or UTC start, floating for a floating one.
    const last = /^\d{8}(T\d{4,6}Z?)?$/.test(token) ? until(token) : null;
    if (last) {
      end = `UNTIL=${last.replace(/^.*:/, "")}`;
      continue;
    }
    const day = WEEKDAY.exec(token);
    if (day && (kind === "W" || kind === "MP")) {
      days.push(day[1]!);
      continue;
    }
    const occurrence = /^(\d)([+-])$/.exec(token);
    if (occurrence && kind === "MP") {
      occurrences.push(`${occurrence[2] === "-" ? "-" : ""}${occurrence[1]}`);
      continue;
    }
    const number = /^(\d{1,3})([+-])?$/.exec(token);
    if ((number || token === "LD") && (kind === "MD" || kind === "YM" || kind === "YD")) {
      numbers.push(token === "LD" ? "-1" : `${number![2] === "-" ? "-" : ""}${number![1]}`);
      continue;
    }
    return null;
  }
  if (kind === "W" && days.length > 0) parts.push(`BYDAY=${days.join(",")}`);
  if (kind === "MP") {
    if (occurrences.length === 0 || days.length === 0) return null;
    parts.push(`BYDAY=${occurrences.flatMap((o) => days.map((d) => `${o}${d}`)).join(",")}`);
  }
  if (numbers.length > 0)
    parts.push(
      `${kind === "MD" ? "BYMONTHDAY" : kind === "YM" ? "BYMONTH" : "BYYEARDAY"}=${numbers.join(",")}`,
    );
  // No end given: 1.0's default is two occurrences.
  if (end === null) parts.push("COUNT=2");
  else if (end !== "") parts.push(end);
  return parts.join(";");
}
