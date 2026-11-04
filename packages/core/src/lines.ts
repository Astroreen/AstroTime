// iCalendar's text, line by line (RFC 5545 §3.1, §3.3.11): what a provider
// that maps another service's JSON to calendar objects needs to write them
// and read them back (docs/plans/providers.md#D252, D253). A subpath of its
// own (`@astrotime/core/lines`), loaded with such a provider, never with the
// app; it imports nothing.

/** A TEXT value as iCalendar writes it: `\`, `;`, `,` and line breaks escaped. */
export const escapeText = (text: string): string =>
  text.replace(/[\\;,]/g, (char) => `\\${char}`).replace(/\r?\n/g, "\\n");

/** A TEXT value as written, read back. */
export const unescapeText = (text: string): string =>
  text.replace(/\\([\\;,nN])/g, (_all, char: string) =>
    char === "n" || char === "N" ? "\n" : char,
  );

/** A content line folded at 75 octets or fewer (by characters, which keeps within it). */
export function foldLine(line: string): string {
  if (line.length <= 74) return line;
  const parts = [line.slice(0, 74)];
  for (let at = 74; at < line.length; at += 73) parts.push(line.slice(at, at + 73));
  return parts.join("\r\n ");
}

/** Lines as a calendar object's text: each folded, CRLF after each. */
export const calendarText = (lines: readonly string[]): string =>
  `${lines.map(foldLine).join("\r\n")}\r\n`;

/** One property: its name in upper case, its parameters as written, its value. */
export interface Line {
  readonly name: string;
  readonly params: string;
  readonly value: string;
}

/** One component: its name, its properties in order, the components inside it. */
export interface Component {
  readonly name: string;
  readonly properties: Line[];
  readonly components: Component[];
}

/** A calendar object's text as its components, folds undone: the `VCALENDAR` and all inside it. */
export function componentsOf(text: string): Component[] {
  const top: Component[] = [];
  const open: Component[] = [];
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    const match = /^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!match) continue;
    const name = match[1]!.toUpperCase();
    const value = match[3]!;
    if (name === "BEGIN") {
      const component: Component = { name: value.toUpperCase(), properties: [], components: [] };
      (open.at(-1)?.components ?? top).push(component);
      open.push(component);
    } else if (name === "END") open.pop();
    else open.at(-1)?.properties.push({ name, params: match[2] ?? "", value });
  }
  return top;
}

/** A component's first property of `name`. */
export const lineOf = (component: Component, name: string): Line | undefined =>
  component.properties.find((property) => property.name === name);

/**
 * A DATE or DATE-TIME as RFC 3339 (`2026-11-10` or `2026-11-10T09:00:00Z`);
 * a local time (no `Z`) as written, its zone in `zone` (the line's TZID).
 */
export function timeOf(line: Line): { readonly time: string; readonly date: boolean; readonly zone: string | null } {
  const value = line.value;
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) return { time: `${date[1]}-${date[2]}-${date[3]}`, date: true, zone: null };
  const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!time) return { time: value, date: false, zone: null };
  const [, y, mo, d, h, mi, s, z] = time;
  return {
    time: `${y}-${mo}-${d}T${h}:${mi}:${s}${z}`,
    date: false,
    zone: z ? null : (/;TZID=("?)([^;:"]+)\1/i.exec(line.params)?.[2] ?? null),
  };
}

/** An RFC 3339 instant as iCalendar's UTC DATE-TIME, `20261104T101500Z`. */
export const utcText = (time: string): string =>
  new Date(time).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
