import { ALL_RIGHTS } from "@astrotime/core";
import { splitCalendars } from "@astrotime/core/split";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { describe, expect, test } from "vite-plus/test";

import { exportCalendar, fileNameOf } from "../src/components/export-dialog.tsx";
import { saveFile } from "../src/components/save-file.ts";
import type { Platform } from "../src/platform.ts";

describe("an exported calendar's file name (import D274)", () => {
  test("one every system takes", () => {
    expect(fileNameOf("Work")).toBe("Work.ics");
    expect(fileNameOf("Работа / дом")).toBe("Работа дом.ics");
    expect(fileNameOf("a\u0000b\u0007c")).toBe("a b c.ics");
    expect(fileNameOf("Work. ")).toBe("Work.ics");
    expect(fileNameOf("CON")).toBe("CON calendar.ics");
    expect(fileNameOf("com1")).toBe("com1 calendar.ics");
    // Windows reads the name before the first dot, in any case, its superscript digits too.
    expect(fileNameOf("NUL.backup")).toBe("NUL calendar.backup.ics");
    expect(fileNameOf("con.work")).toBe("con calendar.work.ics");
    expect(fileNameOf("Aux .x")).toBe("Aux calendar.x.ics");
    expect(fileNameOf("LPT¹")).toBe("LPT¹ calendar.ics");
    expect(fileNameOf("COM10")).toBe("COM10.ics");
    expect(fileNameOf("Console.work")).toBe("Console.work.ics");
    expect(fileNameOf("  ...  ")).toBe("calendar.ics");
    expect(fileNameOf("x".repeat(300))).toBe(`${"x".repeat(100)}.ics`);
  });
});

describe("what became of a saved file (import D274)", () => {
  const file = { name: "Work.ics", type: "text/calendar", bytes: new Uint8Array([1]) };
  const platform = (write?: Platform["saveFile"]) => ({ saveFile: write }) as unknown as Platform;

  test("written where the platform says so; turned away where it says it was not", async () => {
    expect(
      await saveFile(
        file,
        platform(async () => true),
        [],
      ),
    ).toBe("saved");
    // A platform that does not say (an older shell): written, as before.
    expect(
      await saveFile(
        file,
        platform(async () => {}),
        [],
      ),
    ).toBe("saved");
    expect(
      await saveFile(
        file,
        platform(async () => false),
        [],
      ),
    ).toBe("cancelled");
  });
});

describe("a calendar exported from the store (import D274)", () => {
  const object = (component: string, uid: string, lines: string[] = []) =>
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//x//EN",
      `BEGIN:${component}`,
      `UID:${uid}`,
      "DTSTAMP:20261101T080000Z",
      ...lines,
      `END:${component}`,
      "END:VCALENDAR",
      "",
    ].join("\r\n");

  async function setup() {
    const store = await Store.open(nodeDriver());
    const account = await store.addAccount({
      provider: "caldav",
      name: "Nextcloud",
      serverUrl: "https://cloud.example.com/",
      username: "astro",
    });
    const calendar = await store.saveCalendar({
      accountId: account.id,
      url: "https://cloud.example.com/dav/work/",
      name: "Work: 2026",
      color: "#4f8fd6",
      components: ["VEVENT", "VTODO"],
      rights: ALL_RIGHTS,
    });
    return { store, calendar };
  }
  const saving = () => {
    const written: { name: string; text: string }[] = [];
    const platform = {
      saveFile: async (file: { name: string; bytes: Uint8Array }) => {
        written.push({ name: file.name, text: new TextDecoder().decode(file.bytes) });
        return true;
      },
    } as unknown as Platform;
    return { written, platform };
  };

  test("dated and undated objects, changes not yet uploaded too; a deletion not yet uploaded not", async () => {
    const { store, calendar } = await setup();
    await store.saveFromServer(calendar.id, {
      href: "/dav/work/meeting.ics",
      etag: '"1"',
      ics: object("VEVENT", "meeting", ["DTSTART:20261105T090000Z", "SUMMARY:Meeting"]),
    });
    const gone = await store.saveFromServer(calendar.id, {
      href: "/dav/work/gone.ics",
      etag: '"1"',
      ics: object("VEVENT", "gone", ["DTSTART:20261106T090000Z", "SUMMARY:Gone"]),
    });
    await store.deleteLocal(gone.id);
    await store.saveLocal(calendar.id, object("VTODO", "someday", ["SUMMARY:Someday"]));
    const { written, platform } = saving();
    const result = await exportCalendar(store, platform, calendar, "#4f8fd6", []);
    expect(result).toEqual({ file: "Work 2026.ics", count: 2, left: 0, how: "saved" });
    expect(written.map((file) => file.name)).toEqual(["Work 2026.ics"]);
    const [read] = splitCalendars(written[0]!.text, { newUid: () => "x" });
    expect(read!.name).toBe("Work: 2026");
    expect(read!.color?.toLowerCase()).toBe("#4f8fd6");
    expect(read!.objects.map((one) => one.uid).toSorted()).toEqual(["meeting", "someday"]);
  });

  test("nothing readable: no file, said as empty", async () => {
    const { store, calendar } = await setup();
    const { written, platform } = saving();
    expect(await exportCalendar(store, platform, calendar, "#4f8fd6", [])).toMatchObject({
      count: 0,
      left: 0,
      how: "empty",
    });
    expect(written).toEqual([]);
  });
});
