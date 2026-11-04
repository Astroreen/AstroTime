// `calendar-query`'s filter (RFC 4791 §9.7) as far as D280 serves it: the
// component, and its time range through core's `occurrencesBetween`.
import { CalendarObject, occurrencesBetween, type ItemTime } from "@astrotime/core";

import type { Component } from "./database.ts";
import { CALDAV, child, type Element } from "./xml.ts";

export interface Filter {
  /** `null`: any component. */
  readonly component: Component | null;
  /** Instants, start inclusive and end exclusive; `null` when there is no time range. */
  readonly range: { readonly start: number; readonly end: number } | null;
}

const DAY = 86_400_000;
/** How far an open-ended range reaches (RFC 4791 §9.9 allows either end missing). */
const OPEN_END_MS = 10 * 366 * DAY;

/**
 * The filter of a `calendar-query`: `VCALENDAR`'s component filter and its
 * time range. Property and parameter filters inside it are not read; the
 * answer is then more than they asked for, never less.
 */
export function filterOf(query: Element): Filter {
  const calendar = child(child(query, CALDAV, "filter"), CALDAV, "comp-filter");
  const inner = calendar?.children.find((c) => c.ns === CALDAV && c.name === "comp-filter");
  const name = inner?.attributes["name"]?.toUpperCase();
  const range = child(inner, CALDAV, "time-range");
  const start = instantOf(range?.attributes["start"]);
  const end = instantOf(range?.attributes["end"]);
  return {
    component: name === "VEVENT" || name === "VTODO" ? name : null,
    range:
      range === null || (start === null && end === null)
        ? null
        : {
            start: start ?? (end as number) - OPEN_END_MS,
            end: end ?? (start as number) + OPEN_END_MS,
          },
  };
}

/** A UTC date-time as CalDAV writes one, `20261101T000000Z`. */
function instantOf(value: string | undefined): number | null {
  const match = value && /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number) as number[];
  return Date.UTC(y!, mo! - 1, d!, h!, mi!, s!);
}

/** A time as an instant; a date or a floating time read in UTC (RFC 4791 §9.9 leaves it to the server). */
function epochOf(time: ItemTime): number {
  switch (time.type) {
    case "date":
      return Date.parse(`${time.date}T00:00:00Z`);
    case "floating":
      return Date.parse(`${time.local}Z`);
    case "zoned":
      return time.epochMs;
  }
}

const day = (epochMs: number) => new Date(epochMs).toISOString().slice(0, 10);

/** Whether an object with this text matches the filter's time range. */
export function inRange(ics: string, range: NonNullable<Filter["range"]>): boolean {
  // A task with neither DTSTART nor DUE matches any range (RFC 4791 §9.9).
  if (/^BEGIN:VTODO\r?$/m.test(ics) && !/^(DTSTART|DUE)[;:]/m.test(ics)) return true;
  try {
    // Days around the range, then each occurrence's own instants.
    const occurrences = occurrencesBetween(CalendarObject.parse(ics), {
      from: day(range.start - DAY),
      to: day(range.end + 2 * DAY),
      timeZone: "UTC",
    });
    return occurrences.some((occurrence) => {
      const start = epochOf(occurrence.start);
      const end = epochOf(occurrence.end);
      return end > start
        ? start < range.end && end > range.start
        : start >= range.start && start < range.end;
    });
  } catch {
    // A series too dense to expand, or text core cannot read: answered
    // rather than hidden, the client decides.
    return true;
  }
}
