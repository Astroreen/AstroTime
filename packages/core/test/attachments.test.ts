// Attachments (docs/plans/foundation.md#D229): read with their names, types
// and sizes as each client writes them, kept as written, removed and added
// by an edit with nothing else touched.
import { describe, expect, test } from "vite-plus/test";

import {
  CalendarObject,
  editItem,
  inlineFile,
  zonedTime,
  type NewAttachment,
} from "../src/index.ts";
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

/** An object of `lines`, in Vilnius's time. */
const ics = (...components: string[][]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AstroTime//Test//EN",
    ...components.flatMap((lines) => [["BEGIN:VEVENT"], lines, ["END:VEVENT"]].flat()),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
const vilnius = (local: string) => zonedTime(local, "Europe/Vilnius");

describe("reading, every client's way", () => {
  const first = (...attach: string[]) =>
    CalendarObject.parse(
      ics([
        "UID:a",
        "DTSTAMP:20261101T000000Z",
        "DTSTART:20261105T090000Z",
        "SUMMARY:A",
        ...attach,
      ]),
    ).master!.attachments[0]!;

  test("a name: FILENAME first, then Outlook's, Apple's, Oracle's own parameter", () => {
    expect(
      first("ATTACH;X-APPLE-FILENAME=apple.pdf;FILENAME=standard.pdf:https://x.org/1").name,
    ).toBe("standard.pdf");
    expect(
      first("ATTACH;X-ORACLE-FILENAME=oracle.pdf;X-APPLE-FILENAME=apple.pdf:https://x.org/1").name,
    ).toBe("apple.pdf");
    expect(first("ATTACH;X-ORACLE-FILENAME=oracle.pdf:https://x.org/1").name).toBe("oracle.pdf");
    expect(
      first("ATTACH;X-FILENAME=outlook.pdf;X-APPLE-FILENAME=apple.pdf:https://x.org/1").name,
    ).toBe("outlook.pdf");
    expect(first("ATTACH:https://x.org/1").name).toBeNull();
  });

  test("a SIZE that is no size: an inline file counts its own, a link has none", () => {
    expect(first("ATTACH;ENCODING=BASE64;VALUE=BINARY;SIZE=-5:QUJD").size).toBe(3);
    expect(first("ATTACH;SIZE=big:https://x.org/1").size).toBeNull();
    expect(first("ATTACH;SIZE=1.5:https://x.org/1").size).toBeNull();
  });

  test("an inline file's size from its base64: padding counted off, a folded line's spaces too", () => {
    expect(first("ATTACH;ENCODING=BASE64;VALUE=BINARY:QQ==").size).toBe(1);
    expect(first("ATTACH;ENCODING=BASE64;VALUE=BINARY:QUI=").size).toBe(2);
    expect(first("ATTACH;ENCODING=BASE64;VALUE=BINARY:QUJD").size).toBe(3);
    // 60 bytes, folded across lines as a client writes a long one.
    const sixty = btoa("x".repeat(60));
    expect(
      first(`ATTACH;ENCODING=BASE64;VALUE=BINARY:${sixty.slice(0, 40)}\r\n ${sixty.slice(40)}`)
        .size,
    ).toBe(60);
  });
});

describe("a series", () => {
  const A = "ATTACH;FILENAME=a.pdf:https://x.org/a";
  const B = "ATTACH;FILENAME=b.pdf:https://x.org/b";
  const C = "ATTACH;FILENAME=c.pdf:https://x.org/c";
  const series = ics(
    [
      "UID:s",
      "DTSTAMP:20261101T000000Z",
      "DTSTART;TZID=Europe/Vilnius:20261102T090000",
      "DURATION:PT1H",
      "RRULE:FREQ=WEEKLY;COUNT=4",
      "SUMMARY:Weekly",
      A,
      B,
    ],
    // An exception with the series' attachments, and one with its own (an inline file).
    [
      "UID:s",
      "DTSTAMP:20261101T000000Z",
      "RECURRENCE-ID;TZID=Europe/Vilnius:20261109T090000",
      "DTSTART;TZID=Europe/Vilnius:20261109T100000",
      "DURATION:PT1H",
      "SUMMARY:Weekly",
      A,
      B,
    ],
    [
      "UID:s",
      "DTSTAMP:20261101T000000Z",
      "RECURRENCE-ID;TZID=Europe/Vilnius:20261116T090000",
      "DTSTART;TZID=Europe/Vilnius:20261116T090000",
      "DURATION:PT1H",
      "SUMMARY:Weekly",
      C,
      "ATTACH;ENCODING=BASE64;VALUE=BINARY;FILENAME=note.txt:aGk=",
    ],
  );
  const names = (object: CalendarObject) => [
    object.master!.attachments.map((a) => a.name),
    ...object.exceptions.map((e) => e.attachments.map((a) => a.name)),
  ];

  test("removed from every occurrence: also from the exception that had the series' list, not from one with its own", () => {
    const { ics: after } = editItem(
      CalendarObject.parse(series),
      { attachments: { remove: [0], add: [{ uri: "https://x.org/d", name: "d.pdf" }] } },
      { now: NOW, scope: "all", recurrenceId: vilnius("2026-11-02T09:00:00") },
    );
    expect(names(CalendarObject.parse(after))).toEqual([
      ["b.pdf", "d.pdf"],
      ["b.pdf", "d.pdf"],
      ["c.pdf", "note.txt"],
    ]);
  });

  test("removed from one occurrence: its exception only", () => {
    const { ics: after } = editItem(
      CalendarObject.parse(series),
      { attachments: { remove: [0], add: [] } },
      { now: NOW, scope: "this", recurrenceId: vilnius("2026-11-16T09:00:00") },
    );
    expect(names(CalendarObject.parse(after))).toEqual([
      ["a.pdf", "b.pdf"],
      ["a.pdf", "b.pdf"],
      ["note.txt"],
    ]);
  });

  test("an occurrence's inline file is its exception's; one with none is the series'", () => {
    const object = CalendarObject.parse(series);
    const file = inlineFile(object, vilnius("2026-11-16T09:00:00"), 1)!;
    expect(new TextDecoder().decode(file.bytes)).toBe("hi");
    expect(inlineFile(object, vilnius("2026-11-23T09:00:00"), 1)).toBeNull();
  });
});

test("a name with , ; : and a quote is quoted as RFC 6868 says and read back as it was", () => {
  const name = 'C:\\Users\\me\\Q3; final, "really".pdf';
  const { ics: after } = editItem(
    load("apple-event-attachments.ics"),
    {
      attachments: {
        remove: [],
        add: [{ uri: "https://x.org/q", name, parameters: { "X-NOTE": "a;b" } }],
      },
    },
    { now: NOW },
  );
  expect(attachLines(after).at(-1)).toBe(
    "ATTACH;FILENAME=C:\\Users\\me\\Q3; final, ^'really^'.pdf;X-NOTE=a;b:https://x.org/q",
  );
  expect(CalendarObject.parse(after).master!.attachments.at(-1)!.name).toBe(
    'Q3; final, "really".pdf',
  );
});

describe("what is added is checked", () => {
  const added = (attachment: NewAttachment) =>
    attachLines(
      editItem(
        load("apple-event-attachments.ics"),
        { attachments: { remove: [], add: [attachment] } },
        { now: NOW },
      ).ics,
    ).at(-1);

  test("a name with a quote, ; and : is quoted, a line break in it a space; a type that is none left out", () => {
    expect(
      added({
        uri: "https://x.org/n",
        name: 'Plan "A": v2;\r\nfinal',
        type: "text/plain\r\nX-EVIL:1",
        size: -1,
      }),
    ).toBe("ATTACH;FILENAME=Plan ^'A^': v2; final:https://x.org/n");
  });

  test("a parameter that is no token, or one the attachment writes itself, is refused; nothing written", () => {
    const object = load("apple-event-attachments.ics");
    const refused = (attachment: NewAttachment) => () =>
      editItem(object, { attachments: { remove: [0], add: [attachment] } }, { now: NOW });
    expect(refused({ uri: "https://x.org/n", parameters: { "BAD KEY": "1" } })).toThrow(RangeError);
    expect(refused({ uri: "https://x.org/n", parameters: { "X-A;B": "1" } })).toThrow(RangeError);
    expect(refused({ uri: "https://x.org/n", parameters: { VALUE: "BINARY" } })).toThrow(
      RangeError,
    );
    expect(refused({ uri: "https://x.org/a b" })).toThrow(RangeError);
    expect(refused({ uri: "https://x.org/n\r\nX-EVIL:1" })).toThrow(RangeError);
    expect(object.master!.attachments).toHaveLength(2);
    // A provider's own, cleaned of its control characters.
    expect(added({ uri: "https://x.org/n", parameters: { "X-NC-FILE-ID": "7\n" } })).toBe(
      "ATTACH;X-NC-FILE-ID=7:https://x.org/n",
    );
  });
});
