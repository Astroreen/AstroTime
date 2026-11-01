// The Month and Agenda layouts on the demo data (design D86, D87): the
// month's weeks of one-line rows folded to what fits, and the Agenda's days.
import type { Span } from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { describe, expect, test } from "vite-plus/test";

import { agendaDays } from "../src/calendar/agenda.ts";
import { addDays, monthDays } from "../src/calendar/dates.ts";
import { foldWeek, layoutMonth } from "../src/calendar/month.ts";
import { ObjectCache, type StripSpan } from "../src/calendar/query.ts";
import { loadDemo } from "../src/demo/index.ts";

const timeZone = "Europe/Vilnius";
const today = "2026-11-04";
const NOW = Date.parse("2026-11-04T10:40:00+02:00");

/** The demo's occurrences from `from` to `to`, and its undone tasks. */
async function demo(from: string, to: string) {
  const store = await Store.open(nodeDriver());
  await loadDemo(store, { languages: ["en-US"], timeZone, now: NOW });
  const ids = (await store.calendars()).map((calendar) => calendar.id);
  const range = { from, to, timeZone };
  const entries = new ObjectCache().entries(await store.objectsBetween(ids, range), range);
  const undone = (await store.undoneTasksBefore(ids, today, timeZone)).length;
  return { entries, context: { today, timeZone, undone } };
}

const title = ({ entry }: StripSpan) => entry?.occurrence.item.summary ?? "(undone)";

describe("the month (design D86)", () => {
  // Monday weeks, as in Russian: October 26 to December 6.
  const days = monthDays(today, 1);

  test("six weeks from the week holding the 1st", () => {
    expect(days).toHaveLength(42);
    expect([days[0], days.at(-1)]).toEqual(["2026-10-26", "2026-12-06"]);
  });

  test("a week's rows: spans over their days, all-day items, then timed ones in time order", async () => {
    const { entries, context } = await demo(days[0]!, addDays(days.at(-1)!, 1));
    const weeks = layoutMonth(entries, days, context);
    expect(weeks.map((week) => week.days[0])).toEqual([
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
    ]);
    const week = weeks[1]!;
    const wednesday = week.spans
      .filter(({ span }) => span.firstDay <= 2 && span.lastDay >= 2)
      .toSorted((a, b) => a.span.row - b.span.row)
      .map(title);
    expect(wednesday).toEqual([
      "Mom's birthday",
      "(undone)",
      "Buy a gift",
      "Call the bank",
      "Pay the rent",
      "Stand-up",
      "Design review",
      "Budget planning",
      "Call with Anna",
      "Lunch with Marta",
      "Send the report",
    ]);
    const spanOf = (name: string) => week.spans.find((s) => title(s) === name)!.span;
    expect(spanOf("Developer conference")).toMatchObject({ firstDay: 3, lastDay: 5, row: 0 });
    // The night train, timed over midnight, runs from Sunday into the next week.
    expect(spanOf("Night train")).toMatchObject({ firstDay: 6, continuesAfter: true });
    expect(weeks[2]!.spans.find((s) => title(s) === "Night train")!.span).toMatchObject({
      firstDay: 0,
      lastDay: 0,
      continuesBefore: true,
    });
    // Undone tasks due before today are on today's chip only (design D51).
    expect(weeks.flatMap((w) => w.spans).filter((s) => title(s) === "Reply to Olga")).toEqual([]);
    expect(weeks.flatMap((w) => w.spans).filter((s) => s.entry === null)).toHaveLength(1);
  });
});

describe("a week folded to the rows its tiles fit", () => {
  const span = (firstDay: number, lastDay: number, row: number): StripSpan => ({
    span: {
      occurrence: null as never,
      firstDay,
      lastDay,
      row,
      continuesBefore: false,
      continuesAfter: false,
    } satisfies Span,
    entry: null,
  });

  test("everything fits: nothing folds", () => {
    const spans = [span(0, 0, 0), span(0, 0, 1)];
    expect(foldWeek(spans, 2)).toEqual({ shown: spans, more: [] });
  });

  test("a day past its rows gives its last row to +N; other days keep theirs", () => {
    const monday = [span(0, 0, 0), span(0, 0, 1), span(0, 0, 2), span(0, 0, 3)];
    const tuesday = [span(1, 1, 0), span(1, 1, 1), span(1, 1, 2)];
    const { shown, more } = foldWeek([...monday, ...tuesday], 3);
    expect(shown).toEqual([monday[0], monday[1], ...tuesday]);
    expect(more).toEqual([{ index: 0, count: 2 }]);
  });

  test("a span in the last row folds on every day it covers, and they say +N too", () => {
    const long = span(0, 2, 1);
    const spans = [span(0, 0, 0), long, span(0, 0, 2), span(1, 1, 0)];
    const { shown, more } = foldWeek(spans, 2);
    expect(shown).toEqual([spans[0], spans[3]]);
    expect(more).toEqual([
      { index: 0, count: 2 },
      { index: 1, count: 1 },
      { index: 2, count: 1 },
    ]);
  });
});

describe("the Agenda (design D87)", () => {
  const from = "2026-11-01";
  const to = "2026-11-22";

  test("the days with something on them, today headed by the undone tasks chip", async () => {
    const { entries, context } = await demo(from, to);
    const days = agendaDays(entries, from, to, context);
    const byDay = new Map(days.map((day) => [day.day, day]));
    const titles = (day: string) =>
      byDay.get(day)!.items.map((item) => item.entry.occurrence.item.summary);
    // All-day items in the strip's order, then timed ones in time order.
    expect(titles(today)).toEqual([
      "Mom's birthday",
      "Buy a gift",
      "Call the bank",
      "Pay the rent",
      "Stand-up",
      "Design review",
      "Budget planning",
      "Call with Anna",
      "Lunch with Marta",
      "Send the report",
    ]);
    expect(days.filter((day) => day.undone).map((day) => day.day)).toEqual([today]);
    // A Saturday with nothing on it is left out; the days are in order.
    expect(byDay.has("2026-11-14")).toBe(false);
    expect(days.map((day) => day.day)).toEqual(days.map((day) => day.day).toSorted());
  });

  test("an item over several days is on each of them, and says which day it is", async () => {
    const { entries, context } = await demo(from, to);
    const days = agendaDays(entries, from, to, context);
    const conference = days.flatMap(({ day, items }) =>
      items
        .filter((item) => item.entry.occurrence.item.summary === "Developer conference")
        .map((item) => [day, item.part]),
    );
    expect(conference).toEqual([
      ["2026-11-05", { index: 1, total: 3 }],
      ["2026-11-06", { index: 2, total: 3 }],
      ["2026-11-07", { index: 3, total: 3 }],
    ]);
    // A timed item over midnight is on both days, timed.
    const train = days.filter(({ items }) =>
      items.some((item) => item.entry.occurrence.item.summary === "Night train" && !item.allDay),
    );
    expect(train.map(({ day }) => day)).toEqual(["2026-11-08", "2026-11-09"]);
  });

  test("today is there even with nothing on it; other empty days are not", () => {
    const days = agendaDays([], from, to, { today, timeZone, undone: 0 });
    expect(days).toEqual([{ day: today, items: [], undone: false }]);
    expect(agendaDays([], "2026-12-01", "2026-12-08", { today, timeZone, undone: 2 })).toEqual([]);
  });
});
