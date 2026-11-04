import { readFileSync } from "node:fs";

import { CalendarObject, type Task } from "@astrotime/core";
import { describe, expect, test } from "vite-plus/test";

import { NotImportableError, readImport } from "../src/import/read.ts";

const bytes = readFileSync(new URL("fixtures/import/takeout-tasks.json", import.meta.url));

describe("Google Takeout's tasks (import D266, D272)", () => {
  test("each list a source named as it, each task with its notes, due day, status and parent", async () => {
    const file = await readImport(
      { name: "Tasks.json", bytes },
      {
        language: "en",
        timeZone: "Europe/Vilnius",
        newUid: () => "x",
        pause: () => Promise.resolve(),
      },
    );
    expect(file.sources.map((source) => [source.name, source.items.length])).toEqual([
      ["My Tasks", 2],
      ["Работа", 1],
    ]);
    const [passport, photos] = file.sources[0]!.items.map((item) => CalendarObject.parse(item.ics));
    expect(passport!.master as Task).toMatchObject({
      summary: "Renew the passport",
      description: "Bring two photos; the old one too.",
      due: { type: "date", date: "2026-11-20" },
      status: "NEEDS-ACTION",
    });
    expect(passport!.master!.attachments.map((a) => a.uri)).toEqual([
      "https://mail.google.com/mail/#all/18f0a1b2c3d4e5f6",
    ]);
    expect(photos!.master as Task).toMatchObject({
      status: "COMPLETED",
      completed: expect.objectContaining({ epochMs: Date.UTC(2026, 10, 3, 7, 45) }),
    });
    // The subtask names its parent's UID.
    expect(photos!.serialize()).toContain(`RELATED-TO:${passport!.uid}`);
    expect(passport!.serialize()).toContain("X-GOOGLE-TASKS-POSITION:00000000000000000000");
    // The task the user deleted is not brought back.
    expect(file.sources[0]!.items.some((item) => item.ics.includes("Something deleted"))).toBe(
      false,
    );
    expect(file.sources[0]!.notImported).toEqual([]);
  });

  test("the same tasks give the same UIDs: a second import finds them there", async () => {
    const read = () =>
      readImport(
        { name: "Tasks.json", bytes },
        { language: "en", timeZone: "UTC", newUid: () => "x", pause: () => Promise.resolve() },
      );
    const [first, again] = [await read(), await read()];
    expect(again.sources.flatMap((s) => s.items.map((i) => i.uid))).toEqual(
      first.sources.flatMap((s) => s.items.map((i) => i.uid)),
    );
  });

  const fromJson = (json: unknown, name = "Tasks.json") =>
    readImport(
      { name, bytes: new TextEncoder().encode(JSON.stringify(json)) },
      { language: "en", timeZone: "UTC", newUid: () => "x", pause: () => Promise.resolve() },
    );
  const task = (fields: Record<string, unknown>) => ({ kind: "tasks#task", ...fields });
  const list = (items: unknown[], title = "List") => ({ kind: "tasks#taskList", title, items });

  test("no value becomes a line of its own: text escaped, a link parsed, a place digits alone", async () => {
    const file = await fromJson(
      list([
        task({
          id: "a",
          title: "Evil\r\nEND:VTODO\r\nBEGIN:VTODO",
          notes: "Line\rbreak\u0007",
          position: "1\r\nX-INJECTED:1",
          links: [
            { link: "https://example.com/\r\nX-INJECTED:1" },
            { link: "javascript:alert(1)" },
            { link: "https://example.com/ok" },
          ],
        }),
      ]),
    );
    const [item] = file.sources[0]!.items;
    // One task, as many lines as it should have: none injected at a line's start.
    expect(item!.ics.match(/^BEGIN:VTODO\r$/gm)).toHaveLength(1);
    expect(item!.ics).not.toMatch(/^X-INJECTED/m);
    const object = CalendarObject.parse(item!.ics);
    expect(object.master).toMatchObject({
      summary: "Evil\nEND:VTODO\nBEGIN:VTODO",
      description: "Line\nbreak",
    });
    expect(object.master!.attachments.map((a) => a.uri)).toEqual(["https://example.com/ok"]);
    expect(file.sources[0]!.notImported).toEqual(["links"]);
  });

  test("one task list alone, and a bare array of them", async () => {
    expect(
      (await fromJson(list([task({ id: "a", title: "A" })], "One"))).sources.map((s) => s.name),
    ).toEqual(["One"]);
    expect(
      (
        await fromJson([list([task({ id: "a" })], "One"), list([task({ id: "b" })], "Two")])
      ).sources.map((s) => s.name),
    ).toEqual(["One", "Two"]);
  });

  test("a malformed file is refused or read as far as it goes, never a crash", async () => {
    // Not JSON at all, though it starts as JSON does: said so, as before.
    await expect(
      readImport(
        { name: "broken.json", bytes: new TextEncoder().encode('{"kind": "tasks#taskLists",') },
        { language: "en", timeZone: "UTC", newUid: () => "x", pause: () => Promise.resolve() },
      ),
    ).rejects.toThrow(NotImportableError);
    // Not Takeout's shape at all.
    await expect(fromJson(null)).rejects.toThrow(NotImportableError);
    await expect(fromJson({ kind: "tasks#taskLists", items: null })).rejects.toThrow(
      NotImportableError,
    );
    // Takeout's, with values of the wrong shape: those left out.
    const file = await fromJson({
      kind: "tasks#taskLists",
      items: [
        null,
        list([
          null,
          7,
          "x",
          task({ id: { not: "an id" } }),
          task({ id: "ok", title: 5, due: 3, links: "no" }),
        ]),
      ],
    });
    expect(file.sources.flatMap((s) => s.items.map((i) => i.uid))).toEqual(["google-task-ok"]);
  });

  test("a jCal file that names tasks#taskList in a description is jCal, not Takeout's", async () => {
    const jcal = [
      "vcalendar",
      [["version", {}, "text", "2.0"]],
      [
        [
          "vevent",
          [
            ["uid", {}, "text", "j"],
            ["dtstamp", {}, "date-time", "2026-11-01T08:00:00Z"],
            ["dtstart", {}, "date-time", "2026-11-05T09:00:00Z"],
            ["description", {}, "text", 'About "tasks#taskList" in the API'],
          ],
          [],
        ],
      ],
    ];
    const file = await fromJson(jcal, "calendar.json");
    expect(file.sources[0]!.items.map((item) => item.uid)).toEqual(["j"]);
  });

  test("a subtask whose parent was deleted or is not in the file names no parent, and that is said", async () => {
    const file = await fromJson(
      list([
        task({ id: "gone", title: "Gone", deleted: true }),
        task({ id: "a", title: "Under a deleted one", parent: "gone" }),
        task({ id: "b", title: "Under a stranger", parent: "elsewhere" }),
        task({ id: "c", title: "Under a kept one", parent: "a" }),
      ]),
    );
    const [a, b, c] = file.sources[0]!.items;
    expect(a!.ics).not.toContain("RELATED-TO");
    expect(b!.ics).not.toContain("RELATED-TO");
    expect(c!.ics).toContain("RELATED-TO:google-task-a");
    expect(file.sources[0]!.notImported).toEqual(["parent"]);
  });
});
