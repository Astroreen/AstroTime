// A file picked for import, read on the device (docs/plans/import.md#D265):
// its format told from its bytes, not its name, each calendar or task list
// it holds a source (D268) with its events and tasks and its problems. The
// page is given back every so often, so a big file leaves the UI alive.
import { CalendarObject, wallClockOf, type ItemTime } from "@astrotime/core";
import {
  jcalText,
  NotCalendarError,
  splitCalendars,
  type SplitCalendar,
  type SplitProblem,
} from "@astrotime/core/split";

import { decodeText } from "./decode.ts";

/** An event or a task of the file, as one calendar object. */
export interface ImportItem {
  readonly uid: string;
  readonly kind: "event" | "task";
  readonly ics: string;
  /** The first and last day it starts on (its exceptions too), `YYYY-MM-DD`; none when undated. */
  readonly first: string | null;
  readonly last: string | null;
}

/** A calendar or task list of the file (D268). */
export interface Source {
  readonly id: string;
  /** The file's name for it, else the file's own name. */
  readonly name: string;
  readonly color: string | null;
  readonly items: readonly ImportItem[];
  /** Components AstroTime does not keep (`VJOURNAL`, `VFREEBUSY`). */
  readonly others: number;
  readonly problems: readonly SplitProblem[];
}

export interface ReadFile {
  readonly sources: readonly Source[];
  /** The encoding guessed for a file that is not UTF-8 and did not say (D267). */
  readonly guessed: string | null;
  /** Files in an archive that were not read. */
  readonly unread: readonly string[];
}

/** Why a file cannot be imported: it is no format AstroTime reads, holds nothing, or is too big. */
export class NotImportableError extends Error {
  override name = "NotImportableError";
  readonly tooBig: boolean;
  constructor(message: string, options?: ErrorOptions & { readonly tooBig?: boolean }) {
    super(message, options);
    this.tooBig = options?.tooBig ?? false;
  }
}

/**
 * The largest file read: its text is held whole while it is split, twice
 * over as a string, so a phone's page is not the one to read a bigger one.
 * Ten years of a busy calendar is a few megabytes.
 */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

export interface ReadOptions {
  readonly language: string;
  readonly timeZone: string;
  readonly newUid: () => string;
  /** Gives the page back; between every so many objects. */
  readonly pause?: () => Promise<void>;
}

const PAUSE_EVERY = 200;
const yieldToPage = () => new Promise<void>((resolve) => setTimeout(resolve));

export async function readImport(
  file: { readonly name: string; readonly bytes: Uint8Array },
  options: ReadOptions,
): Promise<ReadFile> {
  if (file.bytes.length > MAX_FILE_BYTES)
    throw new NotImportableError(`${file.name} is too big.`, { tooBig: true });
  const sources: Source[] = [];
  const unread: string[] = [];
  let guessed: string | null = null;
  const files = [file];
  // A ZIP's own signature (`PK\3\4`); its reader loads only for one.
  const [p, k, three, four] = file.bytes;
  if (p === 0x50 && k === 0x4b && three === 0x03 && four === 0x04) {
    files.length = 0;
    const archive = await (await import("./zip.ts")).unzip(file.bytes);
    unread.push(...archive.unread);
    for (const entry of archive.entries) {
      if (/\.(ics|ical|ifb|icalendar|json)$/i.test(entry.name)) files.push(entry);
      else unread.push(entry.name);
    }
  }
  for (const one of files) {
    const decoded = decodeText(one.bytes, options.language);
    guessed ??= decoded.guessed;
    let calendars: SplitCalendar[];
    try {
      calendars = splitCalendars(textOf(decoded.text), { newUid: options.newUid });
    } catch (error) {
      if (!(error instanceof NotCalendarError || error instanceof SyntaxError)) throw error;
      // In an archive, one file AstroTime cannot read is named, not the archive's end.
      if (files.length > 1 || file !== one) {
        unread.push(one.name);
        continue;
      }
      throw new NotImportableError(`${one.name} is no calendar AstroTime reads.`, {
        cause: error,
      });
    }
    for (const calendar of calendars) {
      sources.push(await sourceOf(calendar, baseName(one.name), sources.length, options));
    }
  }
  if (sources.length === 0) throw new NotImportableError(`${file.name} holds no calendar.`);
  return { sources, guessed, unread };
}

/** iCalendar's text, from jCal's JSON (RFC 7265) when it is that. */
function textOf(text: string): string {
  const start = text.trimStart();
  return start.startsWith("[") || start.startsWith("{") ? jcalText(JSON.parse(text)) : text;
}

const baseName = (name: string) => name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || name;

async function sourceOf(
  calendar: SplitCalendar,
  fileName: string,
  index: number,
  options: ReadOptions,
): Promise<Source> {
  const pause = options.pause ?? yieldToPage;
  const items: ImportItem[] = [];
  const problems = [...calendar.problems];
  let others = 0;
  for (const [n, object] of calendar.objects.entries()) {
    if (n > 0 && n % PAUSE_EVERY === 0) await pause();
    if (object.kind !== "VEVENT" && object.kind !== "VTODO") {
      others++;
      continue;
    }
    const parsed = CalendarObject.parse(object.ics);
    const days = [parsed.master, ...parsed.exceptions]
      .map((item) => {
        if (!item) return null;
        const time: ItemTime | null = item.kind === "event" ? item.start : (item.due ?? item.start);
        return time ? wallClockOf(time, options.timeZone).slice(0, 10) : null;
      })
      .filter((day) => day !== null)
      .toSorted();
    items.push({
      uid: object.uid,
      kind: parsed.kind,
      ics: object.ics,
      first: days[0] ?? null,
      last: days.at(-1) ?? null,
    });
  }
  return {
    id: String(index),
    name: calendar.name ?? fileName,
    color: calendar.color,
    items,
    others,
    problems,
  };
}
