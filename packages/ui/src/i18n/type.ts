// The strings of Settings' font, text size and their preview (design D294,
// D295), in a catalog of their own (`later.ts`) that loads with Settings.
import { laterStrings } from "./later.ts";

export const typeStrings = {
  en: {
    "settings.font": "Font",
    "settings.font.system": "System default",
    "settings.font.loading": "Downloading {{font}}…",
    "settings.font.failed":
      "{{font}} could not be downloaded. Connect to the network once to keep it on this device; until then the text stays as it was.",
    "settings.textSize": "Text size",
    "settings.preview": "Preview of the font and text size",
    "settings.preview.event": "Coffee with Anna",
    "settings.preview.task": "Send the report",
  },
  ru: {
    "settings.font": "Шрифт",
    "settings.font.system": "Системный",
    "settings.font.loading": "Загрузка {{font}}…",
    "settings.font.failed":
      "Не удалось загрузить {{font}}. Подключитесь к сети один раз, чтобы он сохранился на этом устройстве; до тех пор текст остаётся прежним.",
    "settings.textSize": "Размер текста",
    "settings.preview": "Как выглядят шрифт и размер текста",
    "settings.preview.event": "Кофе с Анной",
    "settings.preview.task": "Отправить отчёт",
  },
} as const satisfies Record<"en" | "ru", Record<string, string>>;

export const addTypeStrings = laterStrings(typeStrings);
