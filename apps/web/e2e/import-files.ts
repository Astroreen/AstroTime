// The files import's tests pick (docs/plans/import.md): one as Google
// Calendar exports one, one as broken as exporters get, and the picking.
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
export async function importFile(page: Page, entry: RegExp, name: string, text: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: entry }).click();
  await (await chooser).setFiles({ name, mimeType: "text/calendar", buffer: Buffer.from(text) });
}
