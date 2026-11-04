// The files import's tests pick (docs/plans/import.md): one as Google
// Calendar exports one, one as broken as exporters get, and the picking.
import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

const lines = (...content: string[]) => `${content.join("\r\n")}\r\n`;

/** A file as Google Calendar exports one: a new event, one the demo has but changed, a task. */
export const TEAM = lines(
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Team",
  "BEGIN:VEVENT",
  "UID:import-planning",
  "DTSTAMP:20261101T080000Z",
  "DTSTART;TZID=Europe/Vilnius:20261105T140000",
  "DTEND;TZID=Europe/Vilnius:20261105T150000",
  "SUMMARY:Planning poker",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:demo-review",
  "DTSTAMP:20261101T080000Z",
  "DTSTART;TZID=Europe/Vilnius:20261104T160000",
  "DTEND;TZID=Europe/Vilnius:20261104T170000",
  "SUMMARY:Design review (moved)",
  "END:VEVENT",
  "BEGIN:VTODO",
  "UID:import-slides",
  "DTSTAMP:20261101T080000Z",
  "DUE;VALUE=DATE:20261106",
  "SUMMARY:Prepare the slides",
  "END:VTODO",
  "END:VCALENDAR",
);

/** A Russian holiday calendar with what exporters get wrong: a broken line, a rule nobody reads. */
export const HOLIDAYS = lines(
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//RU",
  "X-WR-CALNAME:Отпуск",
  "BEGIN:VEVENT",
  "UID:trip-1",
  "DTSTAMP:20261101T080000Z",
  "DTSTART;VALUE=DATE:20261109",
  "DTEND;VALUE=DATE:20261111",
  "SUMMARY:Поездка в Ригу",
  "DESCRIPTION:Поезд в 8:10",
  "Билеты: в почте",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:trip-2",
  "DTSTAMP:20261101T080000Z",
  "DTSTART;VALUE=DATE:20261112",
  "RRULE:FREQ=ИНОГДА",
  "SUMMARY:Музей",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:trip-3",
  "DTSTAMP:20261101T080000Z",
  "DTSTART;VALUE=DATE:20261113",
  "SUMMARY:Обратно домой",
  "END:VEVENT",
  "END:VCALENDAR",
);

/** Picks `text` as `name` in Settings' "Import from a file". */
export async function importFile(page: Page, entry: RegExp, name: string, text: string | Buffer) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: entry }).click();
  await (await chooser).setFiles({ name, mimeType: "text/calendar", buffer: Buffer.from(text) });
}

/** A big file: a daily series first, then 449 single events, three batches' worth (import D271). */
export const BIG = lines(
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//EN",
  "X-WR-CALNAME:Archive",
  "BEGIN:VEVENT",
  "UID:archive-series",
  "DTSTAMP:20261101T080000Z",
  "DTSTART;TZID=Europe/Vilnius:20261102T080000",
  "DTEND;TZID=Europe/Vilnius:20261102T083000",
  "RRULE:FREQ=DAILY;COUNT=7",
  "SUMMARY:Morning run",
  "END:VEVENT",
  ...Array.from({ length: 449 }, (_, i) => [
    "BEGIN:VEVENT",
    `UID:archive-${i}`,
    "DTSTAMP:20261101T080000Z",
    `DTSTART;VALUE=DATE:${20200101 + (i % 28)}`,
    `SUMMARY:Old entry ${i}`,
    "END:VEVENT",
  ]).flat(),
  "END:VCALENDAR",
);

/** An old phone's vCalendar 1.0 export, the converter's own fixture (packages/ui/test/fixtures/import). */
export const NOKIA = readFileSync(
  new URL("../../../packages/ui/test/fixtures/import/nokia.vcs", import.meta.url),
);

/** Russian Outlook's CSV of a calendar, the converter's own fixture: Windows-1251, ';' between columns. */
export const OUTLOOK_RU = readFileSync(
  new URL("../../../packages/ui/test/fixtures/import/outlook-calendar-ru.csv", import.meta.url),
);

/** Google Takeout's Tasks.json, the converter's own fixture. */
export const TAKEOUT = readFileSync(
  new URL("../../../packages/ui/test/fixtures/import/takeout-tasks.json", import.meta.url),
);
