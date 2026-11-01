// The tasks screen's lists (design D52) on the demo data and on tasks made
// for the case: the order picked, subtasks under their parent, a series by
// its earliest occurrence not done, the completed ones apart.
import { completeTask } from "@astrotime/core";
import { Store, type StoredObject } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { describe, expect, test } from "vite-plus/test";

import { TaskCache, taskLists, type Sort, type TaskNode } from "../src/calendar/tasks.ts";
import { loadDemo } from "../src/demo/index.ts";

const timeZone = "Europe/Vilnius";
const today = "2026-11-04";
const NOW = Date.parse("2026-11-04T10:40:00+02:00");
const collator = new Intl.Collator("en");

async function demo() {
  const store = await Store.open(nodeDriver());
  await loadDemo(store, { languages: ["en-US"], timeZone, now: NOW });
  const calendars = await store.calendars();
  const id = (name: string) => calendars.find((calendar) => calendar.name === name)!.id;
  return { store, tasks: id("Tasks"), personal: id("Personal"), work: id("Work") };
}

const titles = (nodes: readonly TaskNode[]): unknown[] =>
  nodes.map(({ row, children }) =>
    children.length > 0 ? [row.task.summary, titles(children)] : row.task.summary,
  );

describe("the task lists of the demo data", () => {
  test("each list of tasks: its undone tasks as a tree, the count, the completed apart", async () => {
    const { store, tasks, personal, work } = await demo();
    const rows = new TaskCache().rows(await store.tasks([tasks, personal, work]), today, timeZone);
    const lists = taskLists(rows, { sort: "mine", collator, timeZone });
    expect([...lists.keys()].toSorted()).toEqual([personal, tasks].toSorted());
    const list = lists.get(tasks)!;
    expect(list.undoneCount).toBe(7);
    expect(titles(list.undone)).toEqual([
      "Reply to Olga",
      "Return the library books",
      "Send the report",
      "Take out the recycling",
      "Water the plants",
      ["Write the proposal", ["Collect the figures"]],
    ]);
    expect(list.completed.map((row) => row.task.summary).toSorted()).toEqual([
      "Book the tickets",
      "Call the bank",
      "Tidy the desk",
    ]);
  });

  test.each<[Sort, unknown[]]>([
    [
      "date",
      [
        "Take out the recycling",
        "Reply to Olga",
        "Send the report",
        ["Write the proposal", ["Collect the figures"]],
        "Water the plants",
        "Return the library books",
      ],
    ],
    [
      "starred",
      [
        "Return the library books",
        "Reply to Olga",
        "Send the report",
        "Take out the recycling",
        "Water the plants",
        ["Write the proposal", ["Collect the figures"]],
      ],
    ],
  ])("sorted by %s", async (sort, expected) => {
    const { store, tasks } = await demo();
    const rows = new TaskCache().rows(await store.tasks([tasks]), today, timeZone);
    expect(titles(taskLists(rows, { sort, collator, timeZone }).get(tasks)!.undone)).toEqual(
      expected,
    );
  });

  test("a series shows by its earliest occurrence not done, and completing it brings the next", async () => {
    const { store, tasks } = await demo();
    const cache = new TaskCache();
    const recycling = async () =>
      cache
        .rows(await store.tasks([tasks]), today, timeZone)
        .find((row) => row.object.uid === "demo-recycling")!;
    const first = await recycling();
    expect(first).toMatchObject({
      recurring: true,
      done: false,
      due: { type: "date", date: "2026-10-25" },
    });
    await store.saveLocal(
      tasks,
      completeTask(first.object, true, { now: NOW, recurrenceId: first.recurrenceId }),
      first.stored.href,
    );
    expect(await recycling()).toMatchObject({ due: { type: "date", date: "2026-11-01" } });
  });
});

describe("tasks made for the case", () => {
  const vtodo = (uid: string, fields: string) =>
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:${uid}\r\nSUMMARY:${uid}\r\n${fields}END:VTODO\r\nEND:VCALENDAR\r\n`;
  const rowsOf = (objects: [string, string][]) =>
    new TaskCache().rows(
      objects.map(([uid, fields]): StoredObject => ({
        id: uid,
        calendarId: "list",
        href: `${uid}.ics`,
        etag: null,
        uid,
        kind: "task",
        ics: vtodo(uid, fields),
        pending: "none",
        baseIcs: null,
        startMs: null,
        endMs: null,
        done: null,
        titles: null,
        updatedAt: 0,
      })),
      today,
      timeZone,
    );

  test("my order is X-APPLE-SORT-ORDER, else the creation time, as Nextcloud Tasks reads it", () => {
    const rows = rowsOf([
      ["late", "CREATED:20261020T000000Z\r\n"],
      ["early", "CREATED:20261001T000000Z\r\n"],
      ["placed", "X-APPLE-SORT-ORDER:1\r\n"],
    ]);
    const list = taskLists(rows, { sort: "mine", collator, timeZone }).get("list")!;
    expect(titles(list.undone)).toEqual(["placed", "early", "late"]);
  });

  test("parents that name each other in a loop are cut, not lost", () => {
    const rows = rowsOf([
      ["a", "RELATED-TO:b\r\n"],
      ["b", "RELATED-TO:a\r\n"],
      ["c", "RELATED-TO:c\r\n"],
    ]);
    const list = taskLists(rows, { sort: "mine", collator, timeZone }).get("list")!;
    expect(list.undoneCount).toBe(3);
    expect(titles(list.undone)).toEqual(["c", ["a", ["b"]]]);
  });

  test("the completed: the most recently completed first", () => {
    const rows = rowsOf([
      ["older", "STATUS:COMPLETED\r\nCOMPLETED:20261101T100000Z\r\n"],
      ["newer", "STATUS:COMPLETED\r\nCOMPLETED:20261103T100000Z\r\n"],
      ["cancelled", "STATUS:CANCELLED\r\n"],
    ]);
    const list = taskLists(rows, { sort: "mine", collator, timeZone }).get("list")!;
    expect(list.undoneCount).toBe(0);
    expect(list.completed.map((row) => row.task.summary)).toEqual(["newer", "older", "cancelled"]);
  });
});
