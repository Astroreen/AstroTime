import { describe, expect, test } from "vite-plus/test";

import { fileNameOf } from "../src/components/export-dialog.tsx";
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
