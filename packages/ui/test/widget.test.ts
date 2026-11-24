// The home screen widget's snapshot (docs/plans/android.md#D317) on the demo
// data in a real store: the Agenda's days from today, the undone row on
// today, the views' colours darkened for white text, the user's words.
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { describe, expect, test } from "vite-plus/test";

import { showWidget, type ScheduleSnapshot, type WidgetHost } from "../src/background.ts";
import { loadDemo } from "../src/demo/index.ts";
import { KEYS, memoryPreferences } from "../src/preferences.ts";
import { fillOf, rgbOf } from "../src/widget/fill.ts";
import { ObjectCache } from "../src/calendar/query.ts";
import { Formats } from "../src/calendar/format.ts";
import { localeSettings } from "../src/calendar/locale.ts";
import { createI18n } from "../src/i18n/index.ts";
import { scheduleSnapshot, WIDGET_DAYS } from "../src/widget/schedule.ts";

const timeZone = "Europe/Vilnius";
const NOW = Date.parse("2026-11-04T10:40:00+02:00");

/** The demo's snapshot, with the preferences `stored` gives for its store. */
async function snapshotOf(
  stored: (store: Store) => Promise<Record<string, string>> = async () => ({}),
  languages = ["en-US"],
) {
  const store = await Store.open(nodeDriver());
  await loadDemo(store, { languages: ["en-US"], timeZone, now: NOW });
  const shown: ScheduleSnapshot[] = [];
  const widget: WidgetHost = {
    show: (snapshot) => void shown.push(snapshot),
    onOpen: () => () => {},
  };
  const snapshot = await showWidget({
    store,
    widget,
    preferences: memoryPreferences(await stored(store)),
    languages,
    timeZone,
    now: NOW,
  });
  return { snapshot, shown, store };
}

const contrastWithWhite = (hex: string) => {
  const linear = rgbOf(hex)!.map((c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]! + 0.05);
};

describe("the snapshot", () => {
  test("the Agenda's days from today: the undone row first on today, then its items", async () => {
    const { snapshot, shown } = await snapshotOf();
    expect(shown).toEqual([snapshot]);
    const [today, tomorrow] = snapshot.days;
    expect(today).toMatchObject({
      day: "2026-11-04",
      weekday: "Wed",
      date: "4",
      month: "November",
      label: "Wednesday, November 4",
    });
    expect(today!.rows[0]).toMatchObject({
      kind: "undone",
      text: "3 undone tasks",
      open: { kind: "day", day: "2026-11-04" },
    });
    const titles = (rows: ScheduleSnapshot["days"][number]["rows"]) =>
      rows.map((row) => (row.kind === "item" ? row.title : row.text));
    expect(titles(today!.rows)).toEqual([
      "3 undone tasks",
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
    // An all-day item has no time line; a day of several says which day it is.
    expect(today!.rows[1]).toMatchObject({ time: null, label: "Mom's birthday, All day" });
    expect(tomorrow!.rows[0]).toMatchObject({ title: "Developer conference", time: "Day 1 of 3" });
    expect(snapshot).toMatchObject({ empty: "Nothing planned today", create: "New event" });
  });

  test("a tap on an item opens its occurrence on its day", async () => {
    const { snapshot } = await snapshotOf();
    const standUp = snapshot.days[1]!.rows.find(
      (row) => row.kind === "item" && row.title === "Stand-up",
    );
    expect(standUp?.open).toMatchObject({
      kind: "item",
      day: "2026-11-05",
      recurrenceId: { type: "zoned", local: "2026-11-05T09:00:00" },
    });
  });

  test(`names every one of ${WIDGET_DAYS} days from today, those with nothing too`, async () => {
    const { snapshot } = await snapshotOf();
    const days = snapshot.days.map(({ day }) => day);
    expect(days).toHaveLength(WIDGET_DAYS);
    expect(days[0]).toBe("2026-11-04");
    expect(days.at(-1)).toBe("2026-12-04");
    // A day with nothing keeps its words, for the widget's today after midnight.
    const empty = snapshot.days.find((day) => day.rows.length === 0)!;
    expect(empty.month).toMatch(/^(November|December)$/);
    expect(snapshot.days.find((day) => day.day === "2026-12-01")).toMatchObject({
      month: "December",
      weekday: "Tue",
    });
  });

  test("past the most rows, a day is cut and the snapshot ends with it", async () => {
    const store = await Store.open(nodeDriver());
    await loadDemo(store, { languages: ["en-US"], timeZone, now: NOW });
    const settings = localeSettings(["en-US"]);
    const i18n = createI18n(settings.language);
    const snapshot = await scheduleSnapshot({
      store,
      cache: new ObjectCache(),
      hidden: new Set(),
      hideCompleted: false,
      words: { t: i18n.t.bind(i18n), formats: new Formats(settings), timeZone },
      now: NOW,
      limit: 13,
    });
    // Today has 11 rows, tomorrow 4: two of tomorrow's make 13, and no day
    // with items follows to read as nothing planned.
    expect(snapshot.days.map((day) => day.rows.length)).toEqual([11, 2]);
  });

  test("in the language and clock chosen, without hidden calendars or completed tasks", async () => {
    const { snapshot } = await snapshotOf(async (store) => {
      const work = (await store.calendars()).find((calendar) => calendar.name === "Work")!;
      return {
        [KEYS.settings]: JSON.stringify({ language: "ru", clock: 24, hideCompleted: true }),
        [KEYS.hiddenCalendars]: JSON.stringify([work.id]),
      };
    });
    const today = snapshot.days[0]!;
    expect(today).toMatchObject({ weekday: "ср", month: "Ноябрь", label: "среда, 4 ноября" });
    const rows = today.rows.filter((row) => row.kind === "item");
    expect(rows.some((row) => row.done)).toBe(false);
    expect(rows.map((row) => row.title)).not.toContain("Stand-up");
    expect(rows.find((row) => row.title === "Call with Anna")?.time).toBe("11:15–11:45");
    expect(snapshot.empty).toBe("На сегодня ничего не запланировано");
  });
});

describe("the fill", () => {
  test("white text on it reaches 4.5:1, for every colour and a done task's", () => {
    for (let r = 0; r < 256; r += 15)
      for (let g = 0; g < 256; g += 15)
        for (let b = 0; b < 256; b += 15) {
          expect(contrastWithWhite(fillOf([r, g, b]))).toBeGreaterThanOrEqual(4.5);
          expect(contrastWithWhite(fillOf([r, g, b], true))).toBeGreaterThanOrEqual(4.5);
        }
  });

  test("a colour dark enough is kept; a light one keeps its hue, darkened", () => {
    expect(fillOf(rgbOf("#1b5e20")!)).toBe("#1b5e20");
    expect(fillOf(rgbOf("white")!)).toBe("#757575");
    expect(rgbOf("not a colour")).toBeNull();
    expect(rgbOf("#abc")).toEqual([0xaa, 0xbb, 0xcc]);
    // Nextcloud's calendar colours carry an alpha, which an opaque row leaves out.
    expect(rgbOf("#0082c9ff")).toEqual([0x00, 0x82, 0xc9]);
    expect(rgbOf("#abcd")).toEqual([0xaa, 0xbb, 0xcc]);
  });
});
