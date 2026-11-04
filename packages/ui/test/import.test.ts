import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

import { ALL_RIGHTS, CalendarObject } from "@astrotime/core";
import { LOCAL_SERVER, Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { describe, expect, test } from "vite-plus/test";

import { decodeText } from "../src/import/decode.ts";
import {
  BATCH,
  CalendarNotMadeError,
  destinationOf,
  duplicatesOf,
  NEW,
  newOn,
  runImport,
  type Choice,
  type Destination,
  type Run,
} from "../src/import/plan.ts";
import { MAX_FILE_BYTES, NotImportableError, readImport, type Source } from "../src/import/read.ts";
import { unzip } from "../src/import/zip.ts";

const exportOf = (name: string) =>
  readFileSync(new URL(`../../core/test/fixtures/exports/${name}`, import.meta.url));

let uids = 0;
const options = {
  language: "en",
  timeZone: "Europe/Vilnius",
  newUid: () => `new-${++uids}`,
  pause: () => Promise.resolve(),
};
const read = (name: string, bytes: Uint8Array) => readImport({ name, bytes }, options);
const encode = (text: string) => new TextEncoder().encode(text);

const lines = (...content: string[]) => `${content.join("\r\n")}\r\n`;
const event = (uid: string, start = "20261105T090000Z", extra: string[] = []) => [
  "BEGIN:VEVENT",
  `UID:${uid}`,
  "DTSTAMP:20261101T080000Z",
  `DTSTART:${start}`,
  `SUMMARY:${uid}`,
  ...extra,
  "END:VEVENT",
];
const todo = (uid: string) => ["BEGIN:VTODO", `UID:${uid}`, `SUMMARY:${uid}`, "END:VTODO"];
const calendar = (name: string | null, ...components: string[][]) =>
  lines(
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    ...(name ? [`X-WR-CALNAME:${name}`] : []),
    ...components.flat(),
    "END:VCALENDAR",
  );

/** A ZIP archive of these files, deflated, as Google's export writes one. */
function zip(files: Record<string, string>, stated?: (size: number) => number): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encode(name);
    const data = deflateRawSync(encode(text));
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, 8, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, stated ? stated(encode(text).length) : encode(text).length, true);
    local.setUint16(26, nameBytes.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(10, 8, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, stated ? stated(encode(text).length) : encode(text).length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const bytes = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

describe("a file's text (import D267)", () => {
  test("UTF-8, with or without its byte order mark", () => {
    expect(decodeText(encode("Встреча"), "en")).toEqual({ text: "Встреча", guessed: null });
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...encode("a")]), "en").text).toBe("a");
  });

  test("UTF-16 by its byte order mark", () => {
    const le = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x14, 0x04]);
    expect(decodeText(le, "en")).toEqual({ text: "AД", guessed: null });
  });

  test("a charset the file names, else the user's language's, said as guessed", () => {
    // "Встреча" in Windows-1251.
    const cp1251 = new Uint8Array([0xc2, 0xf1, 0xf2, 0xf0, 0xe5, 0xf7, 0xe0]);
    expect(decodeText(cp1251, "ru")).toEqual({ text: "Встреча", guessed: "windows-1251" });
    expect(decodeText(cp1251, "en").guessed).toBe("windows-1252");
    const named = new Uint8Array([...encode("SUMMARY;CHARSET=windows-1251:"), ...cp1251]);
    expect(decodeText(named, "en")).toEqual({
      text: "SUMMARY;CHARSET=windows-1251:Встреча",
      guessed: null,
    });
  });
});

describe("a file read into sources (import D268)", () => {
  test("Google's export: its events with their days, named as the file names it", async () => {
    const file = await read("work.ics", exportOf("google-export.ics"));
    expect(file.sources).toHaveLength(1);
    const [source] = file.sources;
    expect(source).toMatchObject({ name: "Work", color: null, others: 0, problems: [] });
    expect(
      source!.items.map(({ uid, kind, first, last }) => [uid.slice(0, 4), kind, first, last]),
    ).toEqual([
      // A series and its exception: the days of both.
      ["1r6a", "event", "2026-11-03", "2026-11-10"],
      ["5h4g", "event", "2026-11-16", "2026-11-16"],
      ["9q8w", "event", "2026-11-05", "2026-11-05"],
    ]);
  });

  test("events and tasks of one file; a file with no name of its own is named by the file", async () => {
    const file = await read("Thunderbird export.ics", exportOf("thunderbird-export.ics"));
    expect(file.sources[0]!.name).toBe("Thunderbird export");
    expect(file.sources[0]!.items.map((item) => item.kind)).toEqual(["event", "task"]);
  });

  test("components AstroTime does not keep are counted, problems kept", async () => {
    const text = calendar(
      "Mixed",
      event("a"),
      ["BEGIN:VJOURNAL", "UID:j", "END:VJOURNAL"],
      event("b").slice(0, -1),
    );
    const [source] = (await read("x.ics", encode(text))).sources;
    expect(source!.others).toBe(1);
    expect(source!.problems.map((problem) => problem.reason)).toEqual(["unterminated"]);
  });

  test("jCal (RFC 7265), as the iCalendar it spells", async () => {
    const jcal = [
      "vcalendar",
      [
        ["version", {}, "text", "2.0"],
        ["x-wr-calname", {}, "unknown", "From JSON"],
      ],
      [
        [
          "vevent",
          [
            ["uid", {}, "text", "j1"],
            ["dtstamp", {}, "date-time", "2026-11-01T08:00:00Z"],
            ["dtstart", { tzid: "Europe/Vilnius" }, "date-time", "2026-11-05T09:00:00"],
            ["summary", {}, "text", "Planning"],
          ],
          [],
        ],
      ],
    ];
    const [source] = (await read("calendar.json", encode(JSON.stringify(jcal)))).sources;
    expect(source).toMatchObject({ name: "From JSON" });
    expect(source!.items.map(({ uid, first }) => [uid, first])).toEqual([["j1", "2026-11-05"]]);
    expect(CalendarObject.parse(source!.items[0]!.ics).master?.summary).toBe("Planning");
  });

  test("a ZIP of calendars, as Google's export: one source each; other files named", async () => {
    const archive = zip({
      "work@example.com.ics": calendar("Work", event("w")),
      "home.ics": calendar(null, event("h"), todo("t")),
      "readme.txt": "not a calendar",
    });
    const file = await read("calendars.zip", archive);
    expect(file.sources.map((source) => [source.name, source.items.length])).toEqual([
      ["Work", 1],
      ["home", 2],
    ]);
    expect(file.unread).toEqual(["readme.txt"]);
  });

  test("a ZIP bomb costs nothing: too many files, too many bytes, an entry past its stated size", async () => {
    const big = calendar("Big", ...Array.from({ length: 50 }, (_, i) => event(`b${i}`)));
    const files = {
      "a.ics": calendar("A", event("a")),
      "b.ics": big,
      "c.ics": calendar("C", event("c")),
    };
    // So many files at most.
    const few = await unzip(zip(files), { entries: 2, total: 1 << 20, ratio: 1000 });
    expect(few.entries.map((entry) => entry.name)).toEqual(["a.ics", "b.ics"]);
    expect(few.unread).toEqual(["c.ics"]);
    // So many bytes in all: the big one is left out, what fits is read.
    const small = await unzip(zip(files), { entries: 10, total: 1000, ratio: 1000 });
    expect(small.unread).toEqual(["b.ics"]);
    // Inflating past its own size so many times over.
    const squeezed = await unzip(zip(files), { entries: 10, total: 1 << 20, ratio: 5 });
    expect(squeezed.unread).toEqual(["b.ics"]);
    // An entry that says it is small and inflates past it is refused as it grows.
    const lying = await unzip(zip({ "x.ics": big }, () => 100));
    expect(lying).toEqual({ entries: [], unread: ["x.ics"] });
  });

  test("a ZIP entry whose own header is not where, or what, the directory says is not read", async () => {
    const archive = zip({ "a.ics": calendar("A", event("a")), "b.ics": calendar("B", event("b")) });
    // The first entry's local header signature broken.
    const broken = archive.slice();
    broken[0] = 0;
    expect(await unzip(broken)).toEqual({
      entries: [expect.objectContaining({ name: "b.ics" })],
      unread: ["a.ics"],
    });
    // Its name in the local header another than the directory's.
    const renamed = archive.slice();
    renamed[30] = "x".charCodeAt(0);
    expect((await unzip(renamed)).unread).toEqual(["a.ics"]);
  });

  test("a file past the size AstroTime reads at once is refused before it is read", async () => {
    const error = await read("huge.ics", new Uint8Array(MAX_FILE_BYTES + 1)).catch((e) => e);
    expect(error).toBeInstanceOf(NotImportableError);
    expect((error as NotImportableError).tooBig).toBe(true);
  });

  test("Google Takeout's ZIP: its Tasks.json read as task lists", async () => {
    const tasks = JSON.stringify({
      kind: "tasks#taskLists",
      items: [
        {
          kind: "tasks#taskList",
          title: "My Tasks",
          items: [{ kind: "tasks#task", id: "t1", title: "Milk" }],
        },
      ],
    });
    const file = await read(
      "takeout.zip",
      zip({ "Takeout/Tasks/Tasks.json": tasks, "Takeout/index.html": "<html>" }),
    );
    expect(
      file.sources.map((source) => [source.name, source.items.map((item) => item.uid)]),
    ).toEqual([["My Tasks", ["google-task-t1"]]]);
    expect(file.unread).toEqual(["Takeout/index.html"]);
  });

  test("several calendars in one file are several sources", async () => {
    const text = calendar("One", event("a")) + calendar("Two", event("b"));
    expect((await read("x.ics", encode(text))).sources.map((source) => source.name)).toEqual([
      "One",
      "Two",
    ]);
  });

  test("what is no calendar is said so", async () => {
    await expect(read("page.ics", encode("<html><body>Sign in</body></html>"))).rejects.toThrow(
      NotImportableError,
    );
    await expect(read("data.json", encode('{"items": []}'))).rejects.toThrow(NotImportableError);
    await expect(read("empty.ics", new Uint8Array())).rejects.toThrow(NotImportableError);
    await expect(read("x.zip", zip({ "a.txt": "x" }))).rejects.toThrow(NotImportableError);
  });
});

describe("an import written through the store (import D269–D271)", () => {
  async function setup() {
    const store = await Store.open(nodeDriver());
    const account = await store.addAccount({
      provider: "caldav",
      name: "Nextcloud",
      serverUrl: "https://cloud.example.com/",
      username: "astro",
    });
    const save = (name: string, components: ("VEVENT" | "VTODO")[], rights = ALL_RIGHTS) =>
      store.saveCalendar({
        accountId: account.id,
        url: `https://cloud.example.com/dav/${name}/`,
        name,
        color: null,
        components,
        rights,
      });
    return {
      store,
      personal: await save("Personal", ["VEVENT", "VTODO"]),
      work: await save("Work", ["VEVENT"]),
      shared: await save("Shared", ["VEVENT"], { create: false, edit: false, delete: false }),
    };
  }
  const sourceOf = async (text: string) => (await read("x.ics", encode(text))).sources[0]!;
  const run = (
    store: Store,
    sources: Source[],
    destinations: Map<string, Destination>,
    duplicates: Awaited<ReturnType<typeof duplicatesOf>>,
    choice: Choice = "skip",
    stopAfter = Infinity,
    make?: Run["make"],
  ) => {
    const progress: [number, number][] = [];
    return runImport({
      store,
      sources,
      destinations,
      duplicates,
      choice,
      accountName: "On this device",
      ...(make ? { make } : {}),
      newUid: () => `copy-${++uids}`,
      onProgress: (done, total) => progress.push([done, total]),
      stopped: () => progress.length > stopAfter,
      pause: () => Promise.resolve(),
    }).then((result) => ({ result, progress }));
  };

  test("first offered: a calendar of the source's name, else the one new items go to", async () => {
    const { store, personal, work } = await setup();
    const calendars = await store.calendars();
    const work1 = await sourceOf(calendar("work", event("a"), todo("t")));
    expect(destinationOf(work1, calendars, new Set())).toEqual({
      events: work.id,
      tasks: personal.id,
    });
    const other = await sourceOf(calendar("Holidays", event("a")));
    expect(destinationOf(other, calendars, new Set())).toEqual({
      events: personal.id,
      tasks: null,
    });
    // Nowhere that takes it: a new calendar on this device.
    expect(destinationOf(other, [], new Set())).toEqual({ events: NEW, tasks: null });
  });

  test("new items become local changes the sync uploads, in batches", async () => {
    const { store, personal } = await setup();
    const many = Array.from({ length: BATCH * 2 + 5 }, (_, i) => event(`e${i}`));
    const source = await sourceOf(calendar("Big", ...many, todo("t")));
    const destinations = new Map([[source.id, { events: personal.id, tasks: personal.id }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    const { result, progress } = await run(store, [source], destinations, duplicates);
    expect(result).toMatchObject({ events: BATCH * 2 + 5, tasks: 1, stopped: false });
    expect(progress).toEqual([
      [0, BATCH * 2 + 6],
      [BATCH, BATCH * 2 + 6],
      [BATCH * 2, BATCH * 2 + 6],
      [BATCH * 2 + 6, BATCH * 2 + 6],
    ]);
    const pending = await store.pending(personal.id);
    expect(pending).toHaveLength(BATCH * 2 + 6);
    expect(new Set(pending.map((object) => object.pending))).toEqual(new Set(["create"]));
    // Stored as the file wrote it (D272): the splitter's text, untouched.
    expect(pending.find((object) => object.uid === "t")!.ics).toBe(
      source.items.find((item) => item.uid === "t")!.ics,
    );
  });

  test("stopped between batches: what landed stays, and says so", async () => {
    const { store, personal } = await setup();
    const many = Array.from({ length: BATCH * 3 }, (_, i) => event(`e${i}`));
    const source = await sourceOf(calendar("Big", ...many));
    const destinations = new Map([[source.id, { events: personal.id, tasks: null }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    const { result } = await run(store, [source], destinations, duplicates, "skip", 1);
    expect(result).toMatchObject({ events: BATCH, stopped: true });
    expect(await store.pending(personal.id)).toHaveLength(BATCH);
  });

  test("a UID already there: the same item skipped; a changed one updated, copied or skipped", async () => {
    for (const choice of ["update", "copy", "skip"] as const) {
      const { store, personal } = await setup();
      await store.saveLocal(personal.id, calendar(null, event("same")));
      await store.saveLocal(personal.id, calendar(null, event("changed")));
      const source = await sourceOf(
        calendar("File", event("same"), event("changed", "20261106T090000Z"), event("fresh")),
      );
      const destinations = new Map([[source.id, { events: personal.id, tasks: null }]]);
      const duplicates = await duplicatesOf(store, [source], destinations);
      expect([duplicates.identical, duplicates.changed]).toEqual([1, 1]);
      const { result } = await run(store, [source], destinations, duplicates, choice);
      const objects = await store.pending(personal.id);
      const starts = (uid: string) =>
        objects
          .filter((object) => CalendarObject.parse(object.ics).master?.summary === uid)
          .map((object) => object.startMs);
      if (choice === "update") {
        expect(result).toMatchObject({ events: 2, updated: 1, copies: 0, identical: 1 });
        expect(starts("changed")).toEqual([Date.UTC(2026, 10, 6, 9)]);
      } else if (choice === "copy") {
        expect(result).toMatchObject({ events: 2, updated: 0, copies: 1, identical: 1 });
        expect(starts("changed").toSorted()).toEqual([
          Date.UTC(2026, 10, 5, 9),
          Date.UTC(2026, 10, 6, 9),
        ]);
      } else {
        expect(result).toMatchObject({ events: 1, skipped: 1, identical: 1 });
        expect(starts("changed")).toEqual([Date.UTC(2026, 10, 5, 9)]);
      }
      expect(starts("same")).toHaveLength(1);
      expect(starts("fresh")).toHaveLength(1);
    }
  });

  test("a UID this run already wrote to a calendar is written once (two sources, two files)", async () => {
    const { store, personal } = await setup();
    const one = await sourceOf(calendar("One", event("same"), event("a")));
    const two = { ...(await sourceOf(calendar("Two", event("same"), event("b")))), id: "two" };
    const destinations = new Map([
      [one.id, { events: personal.id, tasks: null }],
      [two.id, { events: personal.id, tasks: null }],
    ]);
    const duplicates = await duplicatesOf(store, [one, two], destinations);
    const { result } = await run(store, [one, two], destinations, duplicates);
    expect(result).toMatchObject({ events: 3, again: 1 });
    expect((await store.pending(personal.id)).map((object) => object.uid).toSorted()).toEqual([
      "a",
      "b",
      "same",
    ]);
  });

  test("a write that fails ends it: what landed stays and is counted, the error is said", async () => {
    const { store, personal } = await setup();
    const many = Array.from({ length: BATCH * 2 }, (_, i) => event(`e${i}`));
    const source = await sourceOf(calendar("Big", ...many));
    const destinations = new Map([[source.id, { events: personal.id, tasks: null }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    const real = store.changeLocal.bind(store);
    let calls = 0;
    store.changeLocal = ((change) => {
      if (++calls === 2) return Promise.reject(new Error("The disk is full."));
      return real(change);
    }) as typeof store.changeLocal;
    const { result } = await run(store, [source], destinations, duplicates);
    expect(result).toMatchObject({ events: BATCH, stopped: false, error: "The disk is full." });
    expect(await store.pending(personal.id)).toHaveLength(BATCH);
  });

  test("a calendar made for the import that got nothing, stopped first, goes again", async () => {
    const { store } = await setup();
    const source = await sourceOf(calendar("Holidays", event("x")));
    const destinations = new Map([[source.id, { events: NEW, tasks: null }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    const { result } = await run(store, [source], destinations, duplicates, "skip", 0);
    expect(result).toMatchObject({ events: 0, stopped: true });
    expect(result.made.size).toBe(0);
    expect((await store.calendars()).map((made) => made.name)).not.toContain("Holidays");
    // Nor the account on this device made for it: nothing is left on it.
    expect((await store.accounts()).map((account) => account.provider)).toEqual(["caldav"]);
  });

  test("Update them: the file's changes over what is stored; what only the stored one has stays (D7)", async () => {
    const { store, personal } = await setup();
    await store.saveLocal(
      personal.id,
      calendar(null, [
        ...event("kept").slice(0, -1),
        "X-OTHER-CLIENT:keep me",
        "ATTACH:https://example.com/agenda.pdf",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "TRIGGER:-PT10M",
        "DESCRIPTION:Soon",
        "END:VALARM",
        "END:VEVENT",
      ]),
    );
    const source = await sourceOf(
      calendar("File", event("kept", "20261106T090000Z", ["DESCRIPTION:Moved a day"])),
    );
    const destinations = new Map([[source.id, { events: personal.id, tasks: null }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    await run(store, [source], destinations, duplicates, "update");
    const [stored] = await store.pending(personal.id);
    const object = CalendarObject.parse(stored!.ics);
    expect(object.master).toMatchObject({
      description: "Moved a day",
      start: expect.objectContaining({ epochMs: Date.UTC(2026, 10, 6, 9) }),
    });
    expect(object.master!.alarms).toHaveLength(1);
    expect(object.master!.attachments).toHaveLength(1);
    expect(stored!.ics).toContain("X-OTHER-CLIENT:keep me");
  });

  test("Import as copies: a copied subtask names its copied parent, not the original", async () => {
    const { store, personal } = await setup();
    await store.saveLocal(personal.id, calendar(null, todo("parent")));
    await store.saveLocal(personal.id, calendar(null, todo("child")));
    const source = await sourceOf(
      calendar(
        "File",
        [...todo("parent").slice(0, -1), "DESCRIPTION:changed", "END:VTODO"],
        [...todo("child").slice(0, -1), "RELATED-TO:parent", "END:VTODO"],
      ),
    );
    const destinations = new Map([[source.id, { events: null, tasks: personal.id }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    const { result } = await run(store, [source], destinations, duplicates, "copy");
    expect(result.copies).toBe(2);
    const tasks = (await store.pending(personal.id)).map((o) => CalendarObject.parse(o.ics));
    const copy = (uid: string) =>
      tasks.find((task) => task.uid !== uid && task.master?.summary === uid)!;
    expect(copy("child").serialize()).toContain(`RELATED-TO:${copy("parent").uid}`);
  });

  test("a calendar that cannot be removed again is said beside what was imported, not instead", async () => {
    const { store } = await setup();
    const source = await sourceOf(calendar("Holidays", event("x")));
    const destinations = new Map([[source.id, { events: NEW, tasks: null }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    store.removeCalendar = () => Promise.reject(new Error("The store is closed."));
    const { result } = await run(store, [source], destinations, duplicates, "skip", 0);
    expect(result).toMatchObject({
      events: 0,
      stopped: true,
      error: null,
      cleanup: "The store is closed.",
    });
  });

  test("a new calendar that cannot be made: the ones made before it go again", async () => {
    const { store } = await setup();
    const one = await sourceOf(calendar("One", event("a")));
    const two = { ...(await sourceOf(calendar("Two", event("b")))), id: "two" };
    const destinations = new Map([
      [one.id, { events: NEW, tasks: null }],
      [two.id, { events: NEW, tasks: null }],
    ]);
    const duplicates = await duplicatesOf(store, [one, two], destinations);
    const real = store.saveCalendar.bind(store);
    let calls = 0;
    store.saveCalendar = ((input) => {
      if (++calls === 2) return Promise.reject(new Error("The disk is full."));
      return real(input);
    }) as typeof store.saveCalendar;
    await expect(run(store, [one, two], destinations, duplicates)).rejects.toThrow("disk");
    expect((await store.calendars()).map((made) => made.name)).not.toContain("One");
    expect((await store.accounts()).map((account) => account.provider)).toEqual(["caldav"]);
  });

  test("an item deleted here, its deletion not yet on the server, is brought back by the file", async () => {
    const { store, personal } = await setup();
    const saved = await store.saveFromServer(personal.id, {
      href: "https://cloud.example.com/dav/Personal/gone.ics",
      etag: '"1"',
      ics: calendar(null, event("gone")),
    });
    await store.deleteLocal(saved.id);
    expect((await store.object(saved.id))?.pending).toBe("delete");
    const source = await sourceOf(calendar("File", event("gone", "20261106T090000Z")));
    const destinations = new Map([[source.id, { events: personal.id, tasks: null }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    // Not asked about: it is not there any more, as the user sees it.
    expect([duplicates.identical, duplicates.changed]).toEqual([0, 0]);
    const { result } = await run(store, [source], destinations, duplicates);
    expect(result.events).toBe(1);
    const back = await store.object(saved.id);
    expect(back?.pending).toBe("update");
    expect(back?.startMs).toBe(Date.UTC(2026, 10, 6, 9));
  });

  test("a UID a sync brought in after the check is already there: the answer decides, nothing overwritten unasked", async () => {
    for (const choice of ["skip", "update", "copy"] as const) {
      const { store, personal } = await setup();
      const source = await sourceOf(
        calendar("File", event("late", "20261106T090000Z"), event("twin"), event("fresh")),
      );
      const destinations = new Map([[source.id, { events: personal.id, tasks: null }]]);
      const duplicates = await duplicatesOf(store, [source], destinations);
      expect(duplicates.existing.size).toBe(0);
      // Meanwhile a sync brings "late" (another version) and "twin" (the same item).
      await store.saveManyFromServer(personal.id, [
        {
          href: "https://cloud.example.com/dav/Personal/late.ics",
          etag: '"1"',
          ics: calendar(null, event("late", "20261105T090000Z", ["X-SERVER:kept"])),
        },
        {
          href: "https://cloud.example.com/dav/Personal/twin.ics",
          etag: '"1"',
          ics: source.items.find((item) => item.uid === "twin")!.ics,
        },
      ]);
      const { result } = await run(store, [source], destinations, duplicates, choice);
      const late = (await store.withUids(personal.id, ["late"]))[0]!;
      if (choice === "skip") {
        expect(result).toMatchObject({ events: 1, skipped: 1, identical: 1 });
        expect(late.pending).toBe("none");
      } else if (choice === "update") {
        expect(result).toMatchObject({ events: 2, updated: 1, identical: 1 });
        expect(late.startMs).toBe(Date.UTC(2026, 10, 6, 9));
        expect(late.ics).toContain("X-SERVER:kept");
      } else {
        // The synced one as it came, the file's beside it under a UID of its own.
        expect(result).toMatchObject({ events: 2, copies: 1, identical: 1 });
        expect(late.pending).toBe("none");
        const starts = (await store.pending(personal.id)).map((object) => object.startMs);
        expect(starts).toContain(Date.UTC(2026, 10, 6, 9));
      }
    }
  });

  test("a parent a sync brought, copied in the batch: its subtask names the copy", async () => {
    const { store, personal } = await setup();
    const source = await sourceOf(
      calendar(
        "File",
        [...todo("parent").slice(0, -1), "DESCRIPTION:the file's", "END:VTODO"],
        [...todo("child").slice(0, -1), "RELATED-TO:parent", "END:VTODO"],
      ),
    );
    const destinations = new Map([[source.id, { events: null, tasks: personal.id }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    await store.saveManyFromServer(personal.id, [
      {
        href: "https://cloud.example.com/dav/Personal/parent.ics",
        etag: '"1"',
        ics: calendar(null, [
          ...todo("parent").slice(0, -1),
          "DESCRIPTION:the server's",
          "END:VTODO",
        ]),
      },
    ]);
    const { result } = await run(store, [source], destinations, duplicates, "copy");
    expect(result).toMatchObject({ tasks: 2, copies: 1 });
    const tasks = (await store.pending(personal.id)).map((object) =>
      CalendarObject.parse(object.ics),
    );
    const copy = tasks.find((task) => task.master?.description === "the file's")!;
    expect(copy.uid).not.toBe("parent");
    expect(tasks.find((task) => task.master?.summary === "child")!.serialize()).toContain(
      `RELATED-TO:${copy.uid}`,
    );
  });

  test("a batch that fails counts nothing of itself, what it found already there neither", async () => {
    const { store, personal } = await setup();
    const source = await sourceOf(calendar("File", event("twin"), event("fresh")));
    const destinations = new Map([[source.id, { events: personal.id, tasks: null }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    // Meanwhile a sync brings "twin" as it is in the file.
    await store.saveManyFromServer(personal.id, [
      {
        href: "https://cloud.example.com/dav/Personal/twin.ics",
        etag: '"1"',
        ics: source.items.find((item) => item.uid === "twin")!.ics,
      },
    ]);
    store.changeLocal = () => Promise.reject(new Error("The disk is full."));
    const { result } = await run(store, [source], destinations, duplicates);
    expect(result).toMatchObject({
      events: 0,
      identical: 0,
      skipped: 0,
      error: "The disk is full.",
    });
  });

  test("an account made for a calendar that then could not be made goes with it", async () => {
    const { store } = await setup();
    const source = await sourceOf(calendar("Holidays", event("x")));
    const destinations = new Map([[source.id, { events: NEW, tasks: null }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    store.saveCalendar = () => Promise.reject(new Error("The disk is full."));
    await expect(run(store, [source], destinations, duplicates)).rejects.toThrow("disk");
    expect((await store.accounts()).map((account) => account.provider)).toEqual(["caldav"]);
  });

  test("a device account the user had stays when the calendar the import made on it goes", async () => {
    const { store } = await setup();
    const mine = await store.addAccount({
      provider: "local",
      name: "On this device",
      serverUrl: LOCAL_SERVER,
      username: null,
    });
    const source = await sourceOf(calendar("Holidays", event("x")));
    const destinations = new Map([[source.id, { events: NEW, tasks: null }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    const { result } = await run(store, [source], destinations, duplicates, "skip", 0);
    expect(result).toMatchObject({ stopped: true, cleanup: null });
    expect((await store.calendars()).map((made) => made.name)).not.toContain("Holidays");
    expect((await store.accounts()).map((account) => account.id)).toContain(mine.id);
  });

  test("a new calendar on this device, named and coloured as the source", async () => {
    const { store } = await setup();
    const source = await sourceOf(
      lines(
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "X-WR-CALNAME:Holidays",
        "X-APPLE-CALENDAR-COLOR:#D50000FF",
        ...event("new-year", "20270101T000000Z"),
        ...todo("cards"),
        "END:VCALENDAR",
      ),
    );
    const destinations = new Map([[source.id, { events: NEW, tasks: NEW }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    const { result } = await run(store, [source], destinations, duplicates);
    const made = result.made.get(source.id)!;
    expect(made).toMatchObject({
      name: "Holidays",
      color: "#d50000",
      components: ["VEVENT", "VTODO"],
    });
    const local = (await store.accounts()).find((account) => account.provider === "local");
    expect(made.accountId).toBe(local?.id);
    // On this device a change is final: nothing waits for a sync (D122).
    expect(await store.pending(made.id)).toEqual([]);
    expect(await store.tasks([made.id])).toHaveLength(1);
  });

  test("a new calendar on an account's server per kind, made first; its items go to it (D277)", async () => {
    const { store } = await setup();
    const account = (await store.accounts())[0]!;
    const asked: unknown[] = [];
    const make: Run["make"] = async (accountId, wanted) => {
      asked.push([accountId, wanted]);
      return store.saveCalendar({
        accountId,
        url: `https://cloud.example.com/dav/made-${asked.length}/`,
        name: wanted.name,
        color: wanted.color,
        components: [wanted.component],
        rights: ALL_RIGHTS,
      });
    };
    const source = await sourceOf(calendar("Holidays", event("new-year"), todo("cards")));
    const destinations = new Map([
      [source.id, { events: newOn(account.id), tasks: newOn(account.id) }],
    ]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    const { result } = await run(store, [source], destinations, duplicates, "skip", Infinity, make);
    // One calendar a kind: a CalDAV calendar holds one component (providers D275).
    expect(asked).toEqual([
      [account.id, { name: "Holidays", color: null, component: "VEVENT" }],
      [account.id, { name: "Holidays", color: null, component: "VTODO" }],
    ]);
    const [events, tasks] = result.onServer;
    expect(result).toMatchObject({ events: 1, tasks: 1 });
    // Changes made here, which the sync uploads (D5).
    expect((await store.pending(events!.id)).map((object) => object.uid)).toEqual(["new-year"]);
    expect((await store.pending(tasks!.id)).map((object) => object.uid)).toEqual(["cards"]);
    // Nothing made on this device.
    expect(result.made.size).toBe(0);
  });

  test("a new calendar on a server that cannot be made: nothing is written, nothing made here", async () => {
    const { store, personal } = await setup();
    const account = (await store.accounts())[0]!;
    const source = await sourceOf(calendar("Holidays", event("new-year"), todo("cards")));
    const destinations = new Map([[source.id, { events: newOn(account.id), tasks: NEW }]]);
    const duplicates = await duplicatesOf(store, [source], destinations);
    const offline = Object.assign(new Error("offline"), { name: "OfflineError" });
    await expect(
      run(store, [source], destinations, duplicates, "skip", Infinity, async () => {
        throw offline;
      }),
    ).rejects.toEqual(expect.objectContaining({ accountId: account.id, cause: offline }));
    expect(await store.pending(personal.id)).toEqual([]);
    expect((await store.accounts()).map((one) => one.provider)).toEqual(["caldav"]);
  });

  test("tried again elsewhere, a failure that is no calendar's making is not blamed on the account", async () => {
    const { store } = await setup();
    const account = (await store.accounts())[0]!;
    const source = await sourceOf(calendar("Holidays", event("new-year")));
    const onServer = new Map([[source.id, { events: newOn(account.id), tasks: null }]]);
    const refused = await run(
      store,
      [source],
      onServer,
      await duplicatesOf(store, [source], onServer),
      "skip",
      Infinity,
      async () => {
        throw new Error("refused");
      },
    ).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(CalendarNotMadeError);
    // Again, to a new calendar on this device, which cannot be kept: its own error.
    const here = new Map([[source.id, { events: NEW, tasks: null }]]);
    const full = new Error("The disk is full.");
    store.saveCalendar = async () => {
      throw full;
    };
    const again = await run(store, [source], here, await duplicatesOf(store, [source], here)).catch(
      (error: unknown) => error,
    );
    expect(again).toBe(full);
    expect(again).not.toBeInstanceOf(CalendarNotMadeError);
  });
});
