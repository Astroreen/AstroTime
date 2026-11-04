// What a stopped import says (import D277): why, and the calendars it made
// on servers and kept, in the catalog's words, a list as each language
// joins one.
import type { Calendar } from "@astrotime/storage";
import { describe, expect, test } from "vite-plus/test";

import { createI18n } from "../src/i18n/index.ts";
import { addImportStrings } from "../src/i18n/import.ts";
import { failureWords } from "../src/import/failure.ts";
import { CalendarNotMadeError, ImportStoppedError } from "../src/import/plan.ts";

const calendar = (name: string) => ({ name, accountId: "nc" }) as Calendar;
const nameOf = (id: string) => (id === "nc" ? "Nextcloud" : id);

function words(language: "en" | "ru", error: unknown) {
  const i18n = createI18n(language);
  addImportStrings(i18n);
  return failureWords(i18n.t, language, error, nameOf);
}

describe("a stopped import, in words (import D277)", () => {
  test("a write failed after calendars were made on the server: both named, joined as a list", () => {
    const error = new ImportStoppedError("The import stopped.", new Error("The disk is full."), [
      calendar("Holidays"),
      calendar("Team"),
    ]);
    expect(words("en", error)).toBe(
      "The import stopped: Error: The disk is full. Made for this import, and kept: “Holidays” on Nextcloud and “Team” on Nextcloud.",
    );
    expect(words("ru", error)).toContain(
      "Созданы для этого импорта и остались: «Holidays» в Nextcloud и «Team» в Nextcloud.",
    );
  });

  test("a calendar not made after one was: the reason in the UI's words, and the one kept", () => {
    const busy = Object.assign(new Error("429"), { name: "ServerBusyError" });
    const error = new CalendarNotMadeError("nc", busy, [calendar("Holidays")]);
    expect(words("en", error)).toBe(
      "Nextcloud is busy, so nothing was imported. Try again later. Made before that, and kept: “Holidays” on Nextcloud.",
    );
    // Nothing made before it: the reason alone.
    expect(words("en", new CalendarNotMadeError("nc", busy, []))).toBe(
      "Nextcloud is busy, so nothing was imported. Try again later.",
    );
  });
});
