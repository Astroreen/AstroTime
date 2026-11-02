// Attachments (docs/plans/foundation.md#D229): read with their names, types
// and sizes as each client writes them, kept as written, removed and added
// by an edit with nothing else touched.
import { describe, expect, test } from "vite-plus/test";

import { CalendarObject, editItem, inlineFile } from "../src/index.ts";
import { canonicalLine, contentLines, fixture, load } from "./support.ts";

const NOW = Date.parse("2026-11-04T08:40:00Z");

/** The `ATTACH` lines of an object, unfolded and with their parameters in order. */
const attachLines = (ics: string) =>
  contentLines(ics)
    .filter((line) => /^ATTACH[;:]/i.test(line))
    .map(canonicalLine);

describe("reading", () => {
  test("Nextcloud Calendar's: a file of the user's by its link, its name the path's last part", () => {
    const item = load("nextcloud-calendar-event-attachments.ics").master!;
    expect(item.attachments).toEqual([
      { uri: "/index.php/f/241", name: "Q3 report.pdf", type: "application/pdf", size: null },
      { uri: "/index.php/f/318", name: "whiteboard.png", type: "image/png", size: null },
    ]);
  });

  test("Apple's: a managed attachment with its size, and a bare link", () => {
    const item = load("apple-event-attachments.ics").master!;
    expect(item.attachments).toEqual([
      {
        uri: "https://caldav.example.com/attachments/3A9E0B6D/boarding-pass.pdf",
        name: "boarding-pass.pdf",
        type: "application/pdf",
        size: 48213,
      },
      { uri: "https://example.org/ferry-timetable", name: null, type: null, size: null },
    ]);
  });

  test("Outlook's inline file: listed with its size, decoded only when opened", () => {
    const object = load("outlook-event-inline-attachment.ics");
    expect(object.master!.attachments).toEqual([
      { uri: null, name: "agenda.txt", type: "text/plain", size: 21 },
    ]);
    const file = inlineFile(object, null, 0)!;
    expect(new TextDecoder().decode(file.bytes)).toBe("1. Budget\n2. Roadmap\n");
    expect(file).toMatchObject({ type: "text/plain", name: "agenda.txt" });
    // A link has no inline file.
    expect(inlineFile(load("apple-event-attachments.ics"), null, 0)).toBeNull();
  });

  test("an alarm's sound (Apple's ATTACH in a VALARM) is not an attachment of the item", () => {
    expect(load("apple-event-attendees.ics").master!.attachments).toEqual([]);
  });
});

describe("editing", () => {
  test("one removed: the others stay as written, every parameter with them", () => {
    const before = fixture("nextcloud-calendar-event-attachments.ics");
    const { ics } = editItem(
      CalendarObject.parse(before),
      { attachments: { remove: [0], add: [] } },
      { now: NOW },
    );
    expect(attachLines(ics)).toEqual(attachLines(before).slice(1));
    expect(CalendarObject.parse(ics).master!.attachments.map((a) => a.name)).toEqual([
      "whiteboard.png",
    ]);
  });

  test("one added: its name, type, size and a provider's own parameters, after the others", () => {
    const before = fixture("apple-event-attachments.ics");
    const { ics } = editItem(
      CalendarObject.parse(before),
      {
        attachments: {
          remove: [],
          add: [
            {
              uri: "https://cloud.example.com/index.php/f/77",
              name: "/Calendar/notes.md",
              type: "text/markdown",
              size: 512,
              parameters: { "X-NC-FILE-ID": "77", "X-NC-HAS-PREVIEW": "false" },
            },
            { uri: "https://example.org/map" },
          ],
        },
      },
      { now: NOW },
    );
    expect(attachLines(ics)).toEqual([
      ...attachLines(before),
      "ATTACH;FILENAME=/Calendar/notes.md;FMTTYPE=text/markdown;SIZE=512;X-NC-FILE-ID=77;X-NC-HAS-PREVIEW=false:https://cloud.example.com/index.php/f/77",
      "ATTACH:https://example.org/map",
    ]);
    expect(CalendarObject.parse(ics).master!.attachments.at(-2)).toEqual({
      uri: "https://cloud.example.com/index.php/f/77",
      name: "notes.md",
      type: "text/markdown",
      size: 512,
    });
  });

  test("an inline file kept through another edit, its data byte for byte", () => {
    const before = fixture("outlook-event-inline-attachment.ics");
    const { ics } = editItem(CalendarObject.parse(before), { summary: "Plan" }, { now: NOW });
    expect(attachLines(ics)).toEqual(attachLines(before));
  });
});
