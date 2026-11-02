import { readFileSync } from "node:fs";

import { CalendarObject } from "../src/index.ts";

export const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

export const load = (name: string) => CalendarObject.parse(fixture(name));

/** Unfolded content lines (RFC 5545 §3.1). */
export function contentLines(ics: string): string[] {
  return ics
    .replaceAll(/\r\n[ \t]/g, "")
    .split("\r\n")
    .filter(Boolean);
}

/**
 * `NAME;B=2;A="1":value` → `NAME;A=1;B=2:value`: parameters sorted, quotes
 * off. A line's meaning, which D7 keeps: the order and quoting of its
 * parameters carry none (RFC 5545 §3.2), and ical.js writes its own.
 */
export function canonicalLine(line: string): string {
  let inQuotes = false;
  let colon = -1;
  const breaks: number[] = [];
  for (let i = 0; i < line.length && colon < 0; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c === ";") breaks.push(i);
    else if (!inQuotes && c === ":") colon = i;
  }
  const head = line.slice(0, colon);
  const name = head.slice(0, breaks[0] ?? head.length).toUpperCase();
  const params = breaks
    .map((at, i) => head.slice(at + 1, breaks[i + 1] ?? head.length).replaceAll('"', ""))
    // VALUE=URI on ATTACH or VALUE=TEXT is the default and may be dropped.
    .filter((param) => !/^VALUE=(URI|TEXT)$/i.test(param) || name.startsWith("X-"))
    .toSorted();
  return [name, ...params].join(";") + line.slice(colon);
}
