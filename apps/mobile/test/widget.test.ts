// Android's schedule widget (docs/plans/android.md#D317) with the plugins
// replaced: the snapshot handed to the shell as JSON, a tap's address read
// strictly, and a tap that started the app kept until the UI listens.
import type { WidgetOpen } from "@astrotime/ui";
import { expect, test } from "vite-plus/test";

import { androidWidget, WIDGET_URL, widgetOpenOf, type WidgetApp } from "../src/widget.ts";

const at = (open: unknown) =>
  `${WIDGET_URL}?${new URLSearchParams({ open: JSON.stringify(open) }).toString()}`;

test("a time is rebuilt with its own fields alone", () => {
  const zoned = {
    type: "zoned",
    local: "2026-11-04T09:00:00",
    timeZone: "Europe/Vilnius",
    epochMs: 1793775600000,
  };
  const open = (recurrenceId: unknown) =>
    widgetOpenOf(at({ kind: "item", objectId: "o1", recurrenceId, day: "2026-11-04" }));
  expect(open({ ...zoned, extra: 1 })).toMatchObject({ recurrenceId: zoned });
  // Past what a `Date` holds: no time.
  expect(open({ ...zoned, epochMs: 1e20 })).toBeNull();
  expect(open({ type: "floating", local: "2026-11-04T09:00:00", date: "x" })).toMatchObject({
    recurrenceId: { type: "floating", local: "2026-11-04T09:00:00" },
  });
});

test("a tap's address opens an item, a day or quick create", () => {
  const item = {
    kind: "item",
    objectId: "o1",
    recurrenceId: { type: "date", date: "2026-11-08" },
    day: "2026-11-08",
  };
  expect(widgetOpenOf(at(item))).toEqual(item);
  expect(widgetOpenOf(at({ ...item, recurrenceId: null }))).toEqual({
    ...item,
    recurrenceId: null,
  });
  expect(widgetOpenOf(at({ kind: "day", day: "2026-11-04" }))).toEqual({
    kind: "day",
    day: "2026-11-04",
  });
  expect(widgetOpenOf(at({ kind: "day" }))).toEqual({ kind: "day" });
  // Only what is known is kept.
  expect(widgetOpenOf(at({ kind: "create", day: "x", extra: 1 }))).toEqual({ kind: "create" });
});

test("anything else is no tap", () => {
  for (const url of [
    "io.github.astroreen.astrotime:/oauth?code=1",
    `${WIDGET_URL}?open=not-json`,
    `${WIDGET_URL}?other=1`,
    at(null),
    at({ kind: "delete" }),
    at({ kind: "day", day: "tomorrow" }),
    at({ kind: "item", objectId: 7, recurrenceId: null, day: "2026-11-04" }),
    at({ kind: "item", objectId: "o1", recurrenceId: "x", day: "2026-11-04" }),
    at({ kind: "item", objectId: "o1", day: "2026-11-04" }),
    // A day the calendar has not, or a time missing what its kind needs.
    at({ kind: "day", day: "2026-02-31" }),
    at({ kind: "day", day: "9999-99-99" }),
    // Years the views cannot step a period around.
    at({ kind: "day", day: "0000-01-01" }),
    at({ kind: "day", day: "9999-12-31" }),
    at({ kind: "item", objectId: "o1", recurrenceId: null, day: "2026-13-01" }),
    at({ kind: "item", objectId: "o1", recurrenceId: { type: "date" }, day: "2026-11-04" }),
    at({
      kind: "item",
      objectId: "o1",
      recurrenceId: { type: "zoned", local: "2026-11-04T09:00:00" },
      day: "2026-11-04",
    }),
    at({
      kind: "item",
      objectId: "o1",
      recurrenceId: { type: "x", date: "2026-11-04" },
      day: "2026-11-04",
    }),
    at({
      kind: "item",
      objectId: "o1",
      recurrenceId: { type: "floating", local: "2026-11-04T25:00:00" },
      day: "2026-11-04",
    }),
  ])
    expect(widgetOpenOf(url)).toBeNull();
});

/** `@capacitor/app` as it hears addresses: the one the app started at kept for the first listener. */
function fakeApp(launch?: string) {
  let listener: ((event: { url: string }) => void) | null = null;
  const app: WidgetApp = {
    addListener: async (_event, next) => {
      listener = next;
      if (launch) next({ url: launch });
    },
  };
  return { app, open: (url: string) => listener?.({ url }) };
}

test("the snapshot goes to the shell as JSON, at every change", async () => {
  const sent: string[] = [];
  const widget = androidWidget(
    { showWidget: async ({ snapshot }) => void sent.push(snapshot) },
    fakeApp().app,
  );
  const snapshot = {
    version: 1,
    days: [],
    empty: "Nothing",
    create: "New event",
    beyond: "Open AstroTime",
    locale: "en-US",
  } as const;
  await widget.show(snapshot);
  await widget.show(snapshot);
  // The shell leaves out the same one: it knows what the widget has.
  expect(sent.map((json) => JSON.parse(json) as unknown)).toEqual([snapshot, snapshot]);
});

test("a tap that started the app waits for the UI, heard once; a later one reaches it at once", async () => {
  const fake = fakeApp(at({ kind: "create" }));
  const widget = androidWidget({ showWidget: async () => {} }, fake.app);
  const heard: WidgetOpen[] = [];
  const stop = widget.onOpen((open) => heard.push(open));
  expect(heard).toEqual([{ kind: "create" }]);
  fake.open(at({ kind: "day" }));
  fake.open("io.github.astroreen.astrotime:/oauth?code=1");
  expect(heard).toEqual([{ kind: "create" }, { kind: "day" }]);
  stop();
  fake.open(at({ kind: "day" }));
  expect(heard).toHaveLength(2);
});
