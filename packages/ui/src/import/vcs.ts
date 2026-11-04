// vCalendar 1.0 (`.vcs`, versit 1996) as iCalendar 2.0, for import
// (docs/plans/import.md#D266, #D272): what older phones (Nokia, Samsung,
// Sony) and Outlook's "vCalendar format" write. Each property is mapped to
// its iCalendar form where it has one: quoted-printable text in its charset,
// local times through the file's `TZ` and `DAYLIGHT`, alarms relative to the
// start, 1.0's rule grammar as an `RRULE`; what has no home is named in
// `notImported`, never written as something it is not. Loaded only for a
// vCalendar 1.0 file.

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

export function vcalendarToIcs(text: string): Converted {
  const notImported = new Set<string>();
  const out: string[] = [];
  let zone: Zone = { offset: null, daylight: [] };
  /** The component being converted: its kind, its start (for its alarms), its lines. */
  let component: { name: string; lines: Line[] } | null = null;
  for (const line of linesOf(text)) {
    if (line.name === "BEGIN" || line.name === "END") {
      const kind = line.value.trim().toUpperCase();
      if (line.name === "BEGIN" && kind === "VCALENDAR") {
        zone = { offset: null, daylight: [] };
        out.push("BEGIN:VCALENDAR", "VERSION:2.0");
      } else if (line.name === "END" && kind === "VCALENDAR") out.push("END:VCALENDAR");
      else if (line.name === "BEGIN" && (kind === "VEVENT" || kind === "VTODO"))
        component = { name: kind, lines: [] };
      else if (line.name === "END" && component && kind === component.name) {
        out.push(...convertComponent(component.name, component.lines, zone, notImported));
        component = null;
      } else notImported.add(`${line.name}:${kind}`);
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
    // Folded: a line that starts with white space goes on the one before (1.0 keeps the space).
    if (/^[ \t]/.test(piece) && current !== "") {
      current += piece;
      continue;
    }
    // A quoted-printable value ending in "=" goes on to the next line.
    if (
      /QUOTED-PRINTABLE/i.test(current.slice(0, current.indexOf(":") + 1)) &&
      current.endsWith("=")
    ) {
      current = current.slice(0, -1) + piece;
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

/** The file's `TZ` (minutes east of UTC) and its `DAYLIGHT` periods. */
interface Zone {
  readonly offset: number | null;
  readonly daylight: readonly {
    readonly offset: number;
    readonly from: number;
    readonly to: number;
  }[];
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

/**
 * A 1.0 time as an iCalendar one, with the instant it names in milliseconds:
 * UTC stays UTC; a local time goes through the file's `TZ` (and `DAYLIGHT`
 * where it falls in one) to UTC; with no `TZ` it stays floating.
 */
function timeOf(value: string, zone: Zone): { text: string; ms: number } | null {
  const trimmed = value.trim();
  const ms = localMs(trimmed);
  if (ms === null) return null;
  if (/^\d{8}$/.test(trimmed)) return { text: `VALUE=DATE:${trimmed}`, ms };
  if (trimmed.endsWith("Z")) return { text: `:${stamp(ms, true)}`, ms };
  if (zone.offset === null) return { text: `:${stamp(ms, false)}`, ms };
  const offset = zone.daylight.find((p) => ms >= p.from && ms < p.to)?.offset ?? zone.offset;
  const utc = ms - offset * 60_000;
  return { text: `:${stamp(utc, true)}`, ms: utc };
}

/** A property of times: `NAME;VALUE=DATE:…` or `NAME:…`. */
const timeLine = (name: string, time: { text: string }) =>
  time.text.startsWith(":") ? `${name}${time.text}` : `${name};${time.text}`;

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
  notImported: Set<string>,
): string[] {
  const out = [`BEGIN:${name}`];
  const alarms: string[] = [];
  const startLine = lines.find((line) => line.name === "DTSTART");
  const start = startLine ? timeOf(startLine.value, zone) : null;
  const allDay = lines.some(
    (line) =>
      line.name === "X-MICROSOFT-CDO-ALLDAYEVENT" && line.value.trim().toUpperCase() === "TRUE",
  );
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
        // Outlook's all-day event: from one local midnight to the next, as dates.
        const date =
          allDay && (iname === "DTSTART" || iname === "DTEND")
            ? line.value.trim().slice(0, 8)
            : null;
        const time = date ? { text: `VALUE=DATE:${date}` } : timeOf(line.value, zone);
        if (time) out.push(timeLine(iname, time));
        else notImported.add(line.name);
        break;
      }
      case "EXDATE":
      case "RDATE": {
        const times = line.value.split(";").map((value) => timeOf(value, zone));
        if (times.some((time) => time === null) || times.length === 0) notImported.add(line.name);
        else {
          const dates = times.every((time) => time!.text.startsWith("VALUE=DATE"));
          out.push(
            `${line.name}${dates ? ";VALUE=DATE" : ""}:${times.map((time) => time!.text.replace(/^(VALUE=DATE)?:/, "")).join(",")}`,
          );
        }
        break;
      }
      case "RRULE":
      case "EXRULE": {
        const rule = ruleOf(line.value, zone);
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
        const alarm = alarmOf(line, start, zone);
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
function alarmOf(line: Line, start: { ms: number } | null, zone: Zone): string[] | null {
  const [run = "", snooze = "", repeat = "", ...content] = textOf(line).split(";");
  const time = timeOf(run, zone);
  if (!time) return null;
  const trigger = start
    ? `TRIGGER:${duration((time.ms - start.ms) / 1000)}`
    : timeLine("TRIGGER;VALUE=DATE-TIME", time);
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
function ruleOf(value: string, zone: Zone): string | null {
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
    const until = /^\d{8}(T\d{4,6}Z?)?$/.test(token) ? timeOf(token, zone) : null;
    if (until) {
      end = `UNTIL=${until.text.replace(/^(VALUE=DATE)?:/, "")}`;
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
