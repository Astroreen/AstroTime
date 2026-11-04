// The strings of the edit dialog's attachments that load with them (design
// D237), in a catalog of their own (`later.ts`): why an item's calendar
// has no files to attach from.
import { laterStrings } from "./later.ts";

export const fileStrings = {
  en: {
    "attachments.cancelLink": "Cancel",
    "attachments.noFiles.device":
      "Files need a Nextcloud account: this calendar is on this device.",
    "attachments.noFiles.deviceList":
      "Files need a Nextcloud account: this list is on this device.",
    "attachments.noFiles.server":
      "Files need a Nextcloud account: this calendar's server keeps none.",
    "attachments.noFiles.serverList":
      "Files need a Nextcloud account: this list's server keeps none.",
    "attachments.noFiles.syncOff": "Files need this account's sync on, in Settings.",
  },
  ru: {
    "attachments.cancelLink": "Отмена",
    "attachments.noFiles.device":
      "Файлы есть только у аккаунта Nextcloud: этот календарь — на этом устройстве.",
    "attachments.noFiles.deviceList":
      "Файлы есть только у аккаунта Nextcloud: этот список — на этом устройстве.",
    "attachments.noFiles.server":
      "Файлы есть только у аккаунта Nextcloud: сервер этого календаря их не хранит.",
    "attachments.noFiles.serverList":
      "Файлы есть только у аккаунта Nextcloud: сервер этого списка их не хранит.",
    "attachments.noFiles.syncOff": "Для файлов включите синхронизацию этого аккаунта в настройках.",
  },
} as const satisfies Record<"en" | "ru", Record<string, string>>;

/** Adds the strings to an i18next instance in every language, once. */
export const addFileStrings = laterStrings(fileStrings);
