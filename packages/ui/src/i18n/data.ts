// The strings of Settings' "Data" group (docs/plans/import.md#D265), in a
// catalog of their own (`later.ts`) that loads with Settings.
import { laterStrings } from "./later.ts";

export const dataStrings = {
  en: {
    "settings.data": "Data",
    "settings.import": "Import from a file",
    "settings.export": "Export to a file",
    "settings.export.hint": "A calendar or list as one .ics file, for another app or a backup.",
    "settings.import.hint":
      "Events and tasks from Google Calendar, Outlook, Apple Calendar, Thunderbird or Nextcloud: an iCalendar (.ics) or vCalendar (.vcs) file, jCal (.json), CSV, Google Takeout (Tasks.json, or its ZIP). Read on this device.",
  },
  ru: {
    "settings.data": "Данные",
    "settings.import": "Импорт из файла",
    "settings.export": "Экспорт в файл",
    "settings.export.hint":
      "Календарь или список одним файлом .ics — для другого приложения или резервной копии.",
    "settings.import.hint":
      "События и задачи из Google Календаря, Outlook, Календаря Apple, Thunderbird или Nextcloud: файл iCalendar (.ics) или vCalendar (.vcs), jCal (.json), CSV, Google Takeout (Tasks.json или его ZIP). Файл читается на этом устройстве.",
  },
} as const satisfies Record<"en" | "ru", Record<string, string>>;

export const addDataStrings = laterStrings(dataStrings);
