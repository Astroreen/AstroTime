import { describe, expect, test } from "vite-plus/test";

import {
  addDays,
  addMonths,
  daysBetween,
  isoWeek,
  nowIn,
  startOfWeek,
  weekdayOf,
} from "../src/calendar/dates.ts";
import { Formats } from "../src/calendar/format.ts";
import { localeSettings } from "../src/calendar/locale.ts";
import { periodOf, stepAnchor, titleRange } from "../src/calendar/views.ts";

describe("days", () => {
  test("arithmetic on calendar days ignores zones and DST", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-11-01")).toBe(7);
    expect(startOfWeek("2026-11-04", 1)).toBe("2026-11-02");
    expect(startOfWeek("2026-11-04", 7)).toBe("2026-11-01");
    expect(startOfWeek("2026-11-01", 1)).toBe("2026-10-26");
  });

  test("months and the days between two days", () => {
    expect(addMonths("2026-11-04", 1)).toBe("2026-12-01");
    expect(addMonths("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
    expect(daysBetween("2026-11-05", "2026-11-07")).toBe(2);
  });

  test("ISO week numbers, as the reference shows them", () => {
    expect(isoWeek("2026-10-19")).toBe(43);
    expect(isoWeek("2026-11-01")).toBe(44);
    expect(isoWeek("2027-01-01")).toBe(53);
    expect(isoWeek("2027-01-04")).toBe(1);
  });

  test("today and the minutes of now are the user's zone's", () => {
    expect(nowIn(Date.parse("2026-11-03T22:30:00Z"), "Europe/Vilnius")).toEqual({
      today: "2026-11-04",
      minutes: 30,
    });
  });
});

describe("views", () => {
  test("a week starts on the locale's first day; Day and 3 days start at the anchor", () => {
    expect(periodOf("week", "2026-11-04", 1)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(periodOf("3days", "2026-11-04", 1)).toEqual(["2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(periodOf("day", "2026-11-04", 7)).toEqual(["2026-11-04"]);
  });

  test("previous and next move by the view's length; Month and Agenda to a month's first day", () => {
    expect(stepAnchor("week", "2026-11-04", 1)).toBe("2026-11-11");
    expect(stepAnchor("3days", "2026-11-04", -1)).toBe("2026-11-01");
    expect(stepAnchor("day", "2026-11-04", 1)).toBe("2026-11-05");
    expect(stepAnchor("month", "2026-11-04", 1)).toBe("2026-12-01");
    expect(stepAnchor("agenda", "2026-11-04", -1)).toBe("2026-10-01");
  });

  test("a month is its six weeks; the top bar names the month, not the weeks around it", () => {
    const days = periodOf("month", "2026-11-04", 7);
    expect([days.length, days[0], days.at(-1)]).toEqual([42, "2026-11-01", "2026-12-12"]);
    expect(titleRange("month", days, "2026-11-04")).toEqual(["2026-11-01", "2026-11-30"]);
    expect(titleRange("agenda", ["2027-02-10"], "2027-02-10")).toEqual([
      "2027-02-01",
      "2027-02-28",
    ]);
    expect(titleRange("week", periodOf("week", "2026-11-04", 1), "2026-11-04")).toEqual([
      "2026-11-02",
      "2026-11-08",
    ]);
  });
});

describe("the locale decides the language, the week and the clock (D45)", () => {
  test("Russian: Monday and 24 hours", () => {
    expect(localeSettings(["ru-RU", "en"])).toEqual({
      language: "ru",
      locale: "ru-RU",
      weekStart: 1,
      hour12: false,
    });
  });

  test("American English: Sunday and 12 hours; British: Monday and 24", () => {
    expect(localeSettings(["en-US"])).toMatchObject({ language: "en", weekStart: 7, hour12: true });
    expect(localeSettings(["en-GB"])).toMatchObject({
      language: "en",
      weekStart: 1,
      hour12: false,
    });
  });

  test("a language AstroTime does not speak still gives its region's week and clock", () => {
    expect(localeSettings(["lt-LT", "en-US"])).toEqual({
      language: "en",
      locale: "en-LT",
      weekStart: 1,
      hour12: false,
    });
    expect(localeSettings(["lt", "ru"])).toMatchObject({ language: "ru", weekStart: 1 });
    expect(localeSettings([])).toMatchObject({ language: "en", locale: "en" });
    expect(localeSettings(["not a tag"])).toMatchObject({ language: "en" });
  });
});

describe("formats", () => {
  const en = new Formats(localeSettings(["en-US"]));
  const ru = new Formats(localeSettings(["ru-RU"]));

  test("the top bar's period: the month, both months across them, the year when it is not this one", () => {
    expect(en.period("2026-11-01", "2026-11-07", "2026")).toBe("November");
    expect(ru.period("2026-10-26", "2026-11-01", "2026")).toBe("Октябрь – ноябрь");
    expect(ru.period("2026-11-02", "2026-11-08", "2026")).toBe("Ноябрь");
    expect(en.period("2027-01-04", "2027-01-10", "2026")).toBe("January 2027");
  });

  test("a time range across days says the dates", () => {
    const at = (local: string) => ({ type: "floating", local }) as const;
    // Intl spaces with thin and narrow no-break spaces; compared as plain ones.
    const plain = (text: string) => text.replaceAll(/\s/g, " ");
    expect(plain(en.timeRange(at("2026-11-08T09:00:00"), at("2026-11-08T09:30:00"), "UTC"))).toBe(
      "9:00 – 9:30 AM",
    );
    expect(plain(ru.timeRange(at("2026-11-08T22:00:00"), at("2026-11-09T01:00:00"), "UTC"))).toBe(
      "8 нояб., 22:00 – 9 нояб., 01:00",
    );
  });

  test("hour labels on the 24-hour clock as the reference, or 12 hours", () => {
    expect(ru.hour(9)).toBe("09:00");
    expect(en.hour(9)).toBe("9 AM");
    expect(en.hour(13)).toBe("1 PM");
  });

  test("weekday names from Intl, in the locale's week order", () => {
    expect(ru.weekday("2026-11-02")).toBe("пн");
    expect(ru.fullDate("2026-11-04")).toBe("среда, 4 ноября");
    expect(en.weekdayInitials()).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
    expect(ru.weekdayInitials()[0]).toBe("П");
  });

  test("the week number is the first day's week, in the locale's weeks", () => {
    // A Sunday ends a Russian week (the reference's 3 days from Sunday, November 1, say 44)…
    expect(ru.weekNumber(["2026-11-01", "2026-11-02", "2026-11-03"])).toBe(44);
    expect(ru.weekNumber(["2026-11-02"])).toBe(45);
    // …and starts an American one.
    expect(en.weekNumber(["2026-11-01", "2026-11-02"])).toBe(45);
  });
});
