// Search (design D53): a field in the top bar that finds events and tasks by
// their title in the local store, in every visible calendar, ignoring case
// and diacritics (`Store.search`). A result shows when it happens and in its
// colour; choosing it shows the item (the calendar's `onPick`).
import {
  CalendarObject,
  ExpansionLimitError,
  occurrencesBetween,
  wallClockOf,
  type Item,
  type Occurrence,
} from "@astrotime/core";
import type { Store, StoredObject } from "@astrotime/storage";
import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { addDays } from "../calendar/dates.ts";
import type { Formats } from "../calendar/format.ts";
import { liveQuery } from "../calendar/live.ts";
import { useCalendar } from "./context.ts";
import { EmptyState } from "./empty-state.tsx";
import { BackIcon, CheckCircleIcon, SearchIcon } from "./icons.tsx";

export interface SearchResult {
  readonly stored: StoredObject;
  readonly item: Item;
  /** The next occurrence from today, else the last one; `null`: an undated task. */
  readonly occurrence: Occurrence | null;
}

/**
 * When a result is: its day, and its time or times; a task by its due, the
 * day and the time it is due on.
 */
export function resultWhen(
  { item, occurrence }: SearchResult,
  context: { noDate: string; formats: Formats; timeZone: string; today: string },
): string {
  const { noDate, formats, timeZone, today } = context;
  if (!occurrence) return noDate;
  const { start, end } = occurrence;
  if (item.kind === "task" && item.due) {
    // A due date is the task's last day; its occurrence ends the day after (D42).
    if (end.type === "date") return formats.day(addDays(end.date, -1), today);
    return `${formats.day(wallClockOf(end, timeZone).slice(0, 10), today)}, ${formats.time(end, timeZone)}`;
  }
  const day = formats.day(wallClockOf(start, timeZone).slice(0, 10), today);
  if (start.type === "date") return day;
  const time =
    item.kind === "task" || wallClockOf(start, timeZone) === wallClockOf(end, timeZone)
      ? formats.time(item.kind === "task" ? end : start, timeZone)
      : formats.timeRange(start, end, timeZone);
  return `${day}, ${time}`;
}

/** The search field that stands in for the top bar while searching. */
export function SearchBar({
  query,
  onQuery,
  onClose,
}: {
  query: string;
  onQuery: (query: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-14 shrink-0 items-center gap-1 px-1.5">
      <button
        type="button"
        aria-label={t("search.close")}
        onClick={onClose}
        className="grid size-10 shrink-0 place-items-center rounded-full text-ink hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
      >
        <BackIcon />
      </button>
      <input
        type="search"
        // The field is what the search button opened, so it takes the focus.
        autoFocus
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        aria-label={t("search.label")}
        placeholder={t("search.label")}
        className="h-10 min-w-0 flex-1 rounded-full bg-raised px-4 text-input text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent"
      />
    </div>
  );
}

export function SearchResults({
  store,
  calendarIds,
  query,
  today,
  colorOf,
  onPick,
}: {
  store: Store;
  calendarIds: readonly string[];
  query: string;
  today: string;
  colorOf: (result: SearchResult) => string;
  onPick: (result: SearchResult) => void;
}) {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  const [results, setResults] = useState<{ query: string; found: SearchResult[] }>({
    query: "",
    found: [],
  });
  const ids = calendarIds.join(",");
  useEffect(() => {
    const asked = ids === "" ? [] : ids.split(",");
    return liveQuery(
      store,
      async () => ({
        query,
        found: resultsOf(await store.search(asked, query), today, timeZone),
      }),
      setResults,
    );
  }, [store, ids, query, today, timeZone]);

  const when = (result: SearchResult) =>
    resultWhen(result, { noDate: t("search.noDate"), formats, timeZone, today });

  const blank = query.trim() === "";
  const none = !blank && results.query === query && results.found.length === 0;
  // The status stays while search is open and only its words change, so a
  // screen reader says "Nothing found" when a query comes to find nothing
  // (design D134); the results are a list of their own, outside it.
  const status = (
    <div role="status">
      {blank || none ? (
        <EmptyState
          icon={<SearchIcon className="size-6" />}
          title={t(blank ? "search.hint" : "search.none")}
          hint={t("search.scope")}
        />
      ) : null}
    </div>
  );
  if (blank || none) return status;
  return (
    <>
      {status}
      <ul aria-label={t("search.results")} className="flex flex-col py-1">
        {results.found.map((result) => {
          const title = result.item.summary?.trim() || t("item.untitled");
          const time = when(result);
          return (
            <li key={result.stored.id}>
              <button
                type="button"
                aria-label={`${title}, ${time}`}
                onClick={() => onPick(result)}
                className="item-color flex w-full items-start gap-4 px-5 py-2.5 text-left hover:bg-raised focus-visible:bg-raised focus-visible:-outline-offset-2"
                style={{ "--item": colorOf(result) } as CSSProperties}
              >
                <span aria-hidden="true" className="grid h-5 w-[18px] shrink-0 place-items-center">
                  {result.item.kind === "task" ? (
                    <CheckCircleIcon className="size-[18px] text-[var(--item-fill)]" />
                  ) : (
                    <span className="size-3 rounded-full bg-[var(--item-fill)]" />
                  )}
                </span>
                {/* The space keeps the title and the time apart as words, as the name says them (WCAG 2.5.3). */}
                <span className="flex min-w-0 flex-col">
                  <span className="text-row break-words text-ink">{title}</span>{" "}
                  <span className="text-small text-ink-muted">{time}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The results in time order, the undated last. */
function resultsOf(rows: readonly StoredObject[], today: string, timeZone: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const stored of rows) {
    let object: CalendarObject;
    try {
      object = CalendarObject.parse(stored.ics);
    } catch {
      continue;
    }
    const occurrence = shownOccurrence(object, today, timeZone);
    const item = occurrence?.item ?? object.master ?? object.exceptions[0];
    if (item) results.push({ stored, item, occurrence });
  }
  const key = (result: SearchResult) =>
    result.occurrence ? wallClockOf(result.occurrence.start, timeZone) : "￿";
  return results.toSorted((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** A series by its next occurrence from today (within a year), else its last; an item by itself. */
function shownOccurrence(
  object: CalendarObject,
  today: string,
  timeZone: string,
): Occurrence | null {
  try {
    if (!object.master?.recurring) {
      const all = occurrencesBetween(object, { from: "0001-01-01", to: "9000-01-01", timeZone });
      const from = `${today}T00:00:00`;
      return all.find((o) => wallClockOf(o.end, timeZone) >= from) ?? all.at(-1) ?? null;
    }
    const next = occurrencesBetween(object, { from: today, to: addDays(today, 366), timeZone });
    if (next[0]) return next[0];
    return occurrencesBetween(object, { from: "0001-01-01", to: today, timeZone }).at(-1) ?? null;
  } catch (error) {
    // A series too dense to expand (D33) is found, without a date.
    if (error instanceof ExpansionLimitError) return null;
    throw error;
  }
}
