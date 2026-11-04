import { readFileSync } from "node:fs";

import { CalendarObject, type Task } from "@astrotime/core";
import { describe, expect, test } from "vite-plus/test";

import { readImport } from "../src/import/read.ts";

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
});
