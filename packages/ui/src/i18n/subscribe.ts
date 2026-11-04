// The sign-in dialog's subscription form's strings (providers D251), loading
// with the dialog in a catalog of their own (`later.ts`); and what a
// provider tells of a sync (a held removal, D263; what a service could not
// keep, D252), loading with the words that say it.
import { laterStrings } from "./later.ts";

export const subscribeStrings = {
  en: {
    "signIn.kind.ics": "Subscribe",
    "subscribe.help":
      "A calendar published at an address (.ics or webcal://): holidays, a team's, another calendar's secret address. Read-only, refreshed every hour.",
    "subscribe.address": "Calendar address",
    "subscribe.placeholder": "webcal://example.com/calendar.ics",
    "subscribe.submit": "Subscribe",
    "subscribe.checking": "Reading the calendar…",
    "subscribe.problem.address": "This is not a web address.",
    "subscribe.problem.not-calendar":
      "This address answers, but not with a calendar: a web page, or nothing at all.",
    "subscribe.problem.refused":
      "The server refused: the calendar is not public, or its address has changed.",
    "subscribe.problem.failed": "The calendar could not be read.",
    "subscribe.held_one": "The calendar's file would remove {{count}} item.",
    "subscribe.held_other": "The calendar's file would remove {{count}} items.",
    "subscribe.applyHeld": "Remove them",
    "subscribe.notKept_one":
      "{{count}} item: the service did not keep {{properties}}; it stays on this device until the item changes there.",
    "subscribe.notKept_other":
      "{{count}} items: the service did not keep {{properties}}; it stays on this device until the items change there.",
  },
  ru: {
    "signIn.kind.ics": "Подписка",
    "subscribe.help":
      "Календарь, опубликованный по адресу (.ics или webcal://): праздники, календарь команды, секретный адрес другого календаря. Только чтение, обновляется раз в час.",
    "subscribe.address": "Адрес календаря",
    "subscribe.placeholder": "webcal://example.com/calendar.ics",
    "subscribe.submit": "Подписаться",
    "subscribe.checking": "Читаем календарь…",
    "subscribe.problem.address": "Это не веб-адрес.",
    "subscribe.problem.not-calendar":
      "Адрес отвечает, но не календарём: это веб-страница или пустой ответ.",
    "subscribe.problem.refused": "Сервер отказал: календарь не публичный или его адрес изменился.",
    "subscribe.problem.failed": "Не удалось прочитать календарь.",
    "subscribe.held_one": "Файл календаря удалил бы {{count}} запись.",
    "subscribe.held_few": "Файл календаря удалил бы {{count}} записи.",
    "subscribe.held_many": "Файл календаря удалил бы {{count}} записей.",
    "subscribe.held_other": "Файл календаря удалил бы {{count}} записи.",
    "subscribe.applyHeld": "Удалить их",
    "subscribe.notKept_one":
      "{{count}} запись: сервис не сохранил {{properties}}; это остаётся на этом устройстве, пока запись не изменится там.",
    "subscribe.notKept_few":
      "{{count}} записи: сервис не сохранил {{properties}}; это остаётся на этом устройстве, пока записи не изменятся там.",
    "subscribe.notKept_many":
      "{{count}} записей: сервис не сохранил {{properties}}; это остаётся на этом устройстве, пока записи не изменятся там.",
    "subscribe.notKept_other":
      "{{count}} записи: сервис не сохранил {{properties}}; это остаётся на этом устройстве, пока записи не изменятся там.",
  },
} as const satisfies Record<"en" | "ru", Record<string, string>>;

/** Adds the strings to an i18next instance in every language, once. */
export const addSubscribeStrings = laterStrings(subscribeStrings);
