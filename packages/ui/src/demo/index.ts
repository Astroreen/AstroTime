// Demo data for development, tests and screenshots: three calendars of
// events and tasks around today, titled in English or Russian. No real
// person's data. The web app loads it in its dev server only
// (`?demo`, apps/web/src/main.tsx); it is not part of the production bundle.
import type { Store } from "@astrotime/storage";

import { addDays, nowIn } from "../calendar/dates.ts";
import { localeSettings } from "../calendar/locale.ts";
import type { Language } from "../i18n/index.ts";

/** The server the demo account names; nothing is ever sent there. */
export const DEMO_SERVER = "https://demo.astrotime.invalid/";

type Title = Record<Language, string>;

interface DemoItem {
  readonly uid: string;
  readonly ics: string;
  /** A change of ours the server refused, waiting in the Conflicts list (D6). */
  readonly conflict?: string;
}

interface DemoCalendar {
  readonly slug: string;
  readonly name: Title;
  readonly color: string;
  readonly components: ("VEVENT" | "VTODO")[];
  /** A calendar the account may not write (a subscription, a share). */
  readonly readOnly?: boolean;
  readonly items: (day: (offset: number) => string, language: Language, zone: string) => DemoItem[];
}

const compact = (day: string) => day.replaceAll("-", "");

function vcalendar(component: string): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AstroTime//Demo//EN\r\n${component}END:VCALENDAR\r\n`;
}

function lines(fields: Record<string, string | undefined>): string {
  return Object.entries(fields)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(
      ([name, value]) =>
        `${name}${name.includes(";") || value.startsWith(";") ? "" : ":"}${value}\r\n`,
    )
    .join("");
}

const at = (zone: string, day: string, time: string) =>
  `;TZID=${zone}:${compact(day)}T${time.replace(":", "")}00`;
const date = (day: string) => `;VALUE=DATE:${compact(day)}`;

/** A reminder (`VALARM`) as Nextcloud writes one: `-PT15M`, `;RELATED=END:-PT30M`. */
const alarm = (trigger: string) =>
  `BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER${trigger.startsWith(";") ? "" : ":"}${trigger}\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\n`;

function event(
  uid: string,
  summary: string,
  start: string,
  end: string,
  extra: Record<string, string | undefined> = {},
  alarms: readonly string[] = [],
  /** Lines written as they are: repeated properties such as guests. */
  raw = "",
): DemoItem {
  return {
    uid,
    ics: vcalendar(
      `BEGIN:VEVENT\r\n${lines({ UID: uid, DTSTAMP: "20260101T000000Z", SUMMARY: summary, DTSTART: start, DTEND: end, ...extra })}${raw}${alarms.map(alarm).join("")}END:VEVENT\r\n`,
    ),
  };
}

function task(
  uid: string,
  summary: string,
  fields: Record<string, string | undefined>,
  alarms: readonly string[] = [],
): DemoItem {
  return {
    uid,
    ics: vcalendar(
      `BEGIN:VTODO\r\n${lines({ UID: uid, DTSTAMP: "20260101T000000Z", SUMMARY: summary, ...fields })}${alarms.map(alarm).join("")}END:VTODO\r\n`,
    ),
  };
}

const done = { STATUS: "COMPLETED", COMPLETED: "20260101T000000Z", "PERCENT-COMPLETE": "100" };

const CALENDARS: readonly DemoCalendar[] = [
  {
    slug: "personal",
    name: { en: "Personal", ru: "Личное" },
    color: "#4f8fd6",
    components: ["VEVENT", "VTODO"],
    items: (day, l, zone) => {
      const t = (en: string, ru: string) => (l === "en" ? en : ru);
      return [
        event(
          "demo-birthday",
          t("Mom's birthday", "День рождения мамы"),
          date(day(0)),
          date(day(1)),
          {
            // An item with its own colour (RFC 7986), over its calendar's (design D47).
            COLOR: "palevioletred",
          },
        ),
        // Reminders (foundation D100): 15 minutes before, an hour before.
        event(
          "demo-call",
          t("Call with Anna", "Созвон с Анной"),
          at(zone, day(0), "11:15"),
          at(zone, day(0), "11:45"),
          {},
          ["-PT15M"],
        ),
        event(
          "demo-lunch",
          t("Lunch with Marta", "Обед с Мартой"),
          at(zone, day(0), "13:00"),
          at(zone, day(0), "14:00"),
        ),
        event(
          "demo-cinema",
          t("Cinema", "Кино"),
          at(zone, day(-1), "18:00"),
          at(zone, day(-1), "20:30"),
        ),
        {
          ...event(
            "demo-dentist",
            t("Dentist", "Стоматолог"),
            at(zone, day(1), "15:00"),
            at(zone, day(1), "16:00"),
            {},
            ["-PT1H"],
          ),
          // Moved here an hour later while the server had it changed too.
          conflict: event(
            "demo-dentist",
            t("Dentist, check-up", "Стоматолог, осмотр"),
            at(zone, day(1), "16:00"),
            at(zone, day(1), "17:00"),
            {},
            ["-PT1H"],
          ).ics,
        },
        event(
          "demo-concert",
          t("Concert at the philharmonic", "Концерт в филармонии"),
          at(zone, day(3), "19:00"),
          at(zone, day(3), "21:00"),
        ),
        // An all-day reminder as Google and Nextcloud write it: 09:00 the day before.
        event(
          "demo-trip",
          t("Trip to Tallinn", "Поездка в Таллин"),
          date(day(4)),
          date(day(6)),
          {},
          ["-PT15H"],
        ),
        // Weeks before the rest: the Agenda reads it only when scrolled back to.
        event(
          "demo-exhibition",
          t("Photo exhibition", "Фотовыставка"),
          at(zone, day(-45), "17:00"),
          at(zone, day(-45), "19:00"),
        ),
        event(
          "demo-train",
          t("Night train", "Ночной поезд"),
          at(zone, day(4), "22:00"),
          at(zone, day(5), "01:00"),
        ),
        task("demo-gift", t("Buy a gift", "Купить подарок"), { DUE: date(day(0)) }),
        task("demo-rent", t("Pay the rent", "Оплатить аренду"), { DUE: date(day(0)), ...done }),
        task("demo-passport", t("Renew the passport", "Продлить паспорт"), { DUE: date(day(-3)) }),
      ];
    },
  },
  {
    slug: "work",
    name: { en: "Work", ru: "Работа" },
    color: "#3d9f78",
    components: ["VEVENT"],
    items: (day, l, zone) => {
      const t = (en: string, ru: string) => (l === "en" ? en : ru);
      return [
        // A recurring event: every weekday since two weeks ago.
        event(
          "demo-standup",
          t("Stand-up", "Планёрка"),
          at(zone, day(-14), "09:00"),
          at(zone, day(-14), "09:30"),
          {
            RRULE: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
          },
        ),
        // With Personal's call at 11:15, three that overlap and cascade (D15).
        // With a place, a description with a link, guests and a reminder: the details show them all.
        event(
          "demo-review",
          t("Design review", "Обзор дизайна"),
          at(zone, day(0), "10:00"),
          at(zone, day(0), "11:30"),
          {
            LOCATION: t("Room 4\\, second floor", "Переговорная 4\\, второй этаж"),
            DESCRIPTION: t(
              "The new month view. Notes: https://example.com/review",
              "Новый вид месяца. Заметки: https://example.com/review",
            ),
          },
          ["-PT10M"],
          [
            `ORGANIZER;CN=${t("Anna Berg", "Анна Берг")}:mailto:anna@example.com`,
            `ATTENDEE;CN=${t("Anna Berg", "Анна Берг")};PARTSTAT=ACCEPTED:mailto:anna@example.com`,
            `ATTENDEE;CN=${t("Marta Lind", "Марта Линд")};PARTSTAT=TENTATIVE:mailto:marta@example.com`,
            "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:team@example.com",
            "",
          ].join("\r\n"),
        ),
        event(
          "demo-budget",
          t("Budget planning", "Планирование бюджета"),
          at(zone, day(0), "11:00"),
          at(zone, day(0), "12:30"),
        ),
        event(
          "demo-conference",
          t("Developer conference", "Конференция разработчиков"),
          date(day(1)),
          date(day(4)),
        ),
        event(
          "demo-one-on-one",
          t("One-on-one", "Встреча один на один"),
          at(zone, day(-2), "11:00"),
          at(zone, day(-2), "12:00"),
        ),
        event(
          "demo-team-lunch",
          t("Team lunch", "Командный обед"),
          at(zone, day(2), "12:00"),
          at(zone, day(2), "13:00"),
        ),
        event(
          "demo-workshop",
          t("CalDAV workshop", "Воркшоп по CalDAV"),
          at(zone, day(2), "15:00"),
          at(zone, day(2), "17:30"),
        ),
      ];
    },
  },
  {
    slug: "tasks",
    name: { en: "Tasks", ru: "Задачи" },
    color: "#7a6cc9",
    components: ["VTODO"],
    items: (day, l, zone) => {
      const t = (en: string, ru: string) => (l === "en" ? en : ru);
      return [
        // A timed task: a 30-minute chip at its due (D16).
        task("demo-report", t("Send the report", "Отправить отчёт"), {
          DUE: at(zone, day(0), "15:00"),
        }),
        task("demo-tickets", t("Book the tickets", "Забронировать билеты"), {
          DUE: at(zone, day(-1), "14:00"),
          ...done,
        }),
        // A start–due task: a block, like an event.
        // Reminding an hour before its due (foundation D100).
        task(
          "demo-proposal",
          t("Write the proposal", "Написать предложение"),
          { DTSTART: at(zone, day(1), "10:00"), DUE: at(zone, day(1), "12:00") },
          [";RELATED=END:-PT1H"],
        ),
        task("demo-bank", t("Call the bank", "Позвонить в банк"), { DUE: date(day(0)), ...done }),
        task("demo-plants", t("Water the plants", "Полить цветы"), { DUE: date(day(2)) }),
        task("demo-desk", t("Tidy the desk", "Разобрать стол"), { DUE: date(day(-2)), ...done }),
        // Undone and due before today: they roll over to today's chip (D51).
        task("demo-reply", t("Reply to Olga", "Ответить Ольге"), {
          DUE: at(zone, day(-2), "09:00"),
        }),
        // A recurring task, weekly; its last undone occurrence before today rolls over.
        task("demo-recycling", t("Take out the recycling", "Вынести вторсырьё"), {
          DUE: date(day(-10)),
          RRULE: "FREQ=WEEKLY",
        }),
        // Undated tasks live on the tasks screen only (D16): one starred, one a subtask.
        task("demo-books", t("Return the library books", "Вернуть книги в библиотеку"), {
          "X-ASTROTIME-STARRED": "TRUE",
        }),
        task("demo-figures", t("Collect the figures", "Собрать цифры"), {
          "RELATED-TO": "demo-proposal",
        }),
      ];
    },
  },
  {
    slug: "holidays",
    name: { en: "Holidays", ru: "Праздники" },
    color: "#c98a3d",
    components: ["VEVENT"],
    // A calendar shared read-only: its items open, but nothing in it can change.
    readOnly: true,
    items: (day, l) => [
      event(
        "demo-festival",
        l === "en" ? "Town festival" : "Городской праздник",
        date(day(5)),
        date(day(6)),
      ),
    ],
  },
];

export interface DemoData {
  readonly account: string;
  readonly calendars: readonly {
    readonly slug: string;
    readonly name: string;
    readonly color: string;
    readonly components: ("VEVENT" | "VTODO")[];
    readonly readOnly: boolean;
    readonly items: readonly DemoItem[];
  }[];
}

/** The demo calendars around `today`, with times in `timeZone`. */
export function demoData(language: Language, today: string, timeZone: string): DemoData {
  const day = (offset: number) => addDays(today, offset);
  return {
    account: language === "en" ? "Demo" : "Демо",
    calendars: CALENDARS.map((calendar) => ({
      slug: calendar.slug,
      name: calendar.name[language],
      color: calendar.color,
      components: calendar.components,
      readOnly: calendar.readOnly ?? false,
      items: calendar.items(day, language, timeZone),
    })),
  };
}

/**
 * Replaces the demo account in the store with a fresh one around today, in
 * the language the UI will speak. Other accounts are not touched.
 */
export async function loadDemo(
  store: Store,
  options: { languages: readonly string[]; timeZone: string; now?: number },
): Promise<void> {
  const { languages, timeZone, now = Date.now() } = options;
  for (const account of await store.accounts()) {
    if (account.serverUrl === DEMO_SERVER) await store.removeAccount(account.id);
  }
  const data = demoData(localeSettings(languages).language, nowIn(now, timeZone).today, timeZone);
  const account = await store.addAccount({
    provider: "demo",
    name: data.account,
    serverUrl: DEMO_SERVER,
    username: null,
  });
  for (const calendar of data.calendars) {
    const saved = await store.saveCalendar({
      accountId: account.id,
      url: `${DEMO_SERVER}${calendar.slug}/`,
      name: calendar.name,
      color: calendar.color,
      components: calendar.components,
      readOnly: calendar.readOnly,
    });
    for (const item of calendar.items) {
      const object = await store.saveFromServer(saved.id, {
        href: `${item.uid}.ics`,
        etag: '"demo"',
        ics: item.ics,
      });
      if (item.conflict) await store.addConflict(object.id, item.conflict);
    }
  }
}
