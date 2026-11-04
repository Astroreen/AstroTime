// The strings of Settings' "Data" group (docs/plans/import.md#D265), in a
// catalog of their own (`later.ts`) that loads with Settings.
import { laterStrings } from "./later.ts";

export const dataStrings = {
  en: {
    "settings.data": "Data",
    "settings.import": "Import from a file",
    "settings.import.hint":
      "Events and tasks from Google Calendar, Outlook, Apple Calendar, Thunderbird or Nextcloud: an iCalendar (.ics) or vCalendar (.vcs) file, jCal (.json), or a ZIP of them. Read on this device.",
  },
  ru: {
    "settings.data": "Данные",
    "settings.import": "Импорт из файла",
    "settings.import.hint":
      "События и задачи из Google Календаря, Outlook, Календаря Apple, Thunderbird или Nextcloud: файл iCalendar (.ics) или vCalendar (.vcs), jCal (.json) или их ZIP-архив. Файл читается на этом устройстве.",
  },
} as const satisfies Record<"en" | "ru", Record<string, string>>;

export const addDataStrings = laterStrings(dataStrings);
