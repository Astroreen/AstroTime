// The illustrations' themes (design D215): a title's words, in English and
// Russian with their forms, give an item its picture; a month its season's
// banner, south of the equator too (D218); and the pictures are only shapes.
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import { bannerOf, isSouthern } from "../src/pictures/months.ts";
import { THEMES, themeOf } from "../src/pictures/themes.ts";

describe("an item's theme from its title", () => {
  test.each([
    ["Lunch with Anna", "meal"],
    ["К бабушке на обед", "meal"],
    ["Пообедать с командой", "meal"],
    ["после обеда", "meal"],
    ["Завтрак", "meal"],
    ["Ужинаем в ресторане", "meal"],
    ["Coffee with Max", "coffee"],
    ["Кофе с Олей", "coffee"],
    ["В кафе", "coffee"],
    ["Mom's birthday", "birthday"],
    ["Бабушка Света – день рождения", "birthday"],
    ["ДР Пети", "birthday"],
    ["Днюха", "birthday"],
    ["Gym", "sport"],
    ["Утренняя пробежка", "sport"],
    ["Йога", "sport"],
    ["Тренировка", "sport"],
    ["Прогулка с Катриной", "walk"],
    ["Walk in the park", "walk"],
    ["Dentist", "doctor"],
    ["К стоматологу", "doctor"],
    ["Приём у врача", "doctor"],
    ["Flight to Rome", "travel"],
    ["Рейс в Вильнюс", "travel"],
    ["Поезд в Ригу", "travel"],
    ["Перелёт", "travel"],
    ["Экзамен по математике", "study"],
    ["Lecture: algorithms", "study"],
    ["Купить продукты", "shopping"],
    ["Grocery run", "shopping"],
    ["Кино", "cinema"],
    ["Movie night", "cinema"],
    ["Концерт", "music"],
    ["Репетиция хора", "music"],
    ["Новый год", "winter"],
    ["Встречаем Новый год у Лены", "winter"],
    ["New Year's Eve", "winter"],
  ] as const)("%s → %s", (title, theme) => {
    expect(themeOf(title)).toBe(theme);
  });

  test.each([
    "Завтра позвонить", // "tomorrow", not "breakfast"
    "Победа", // "victory" ends in обед but does not begin with it
    "Йогурт купить?", // not yoga (and no shopping word)
    "Репетитор пришёл?", // a tutor is study, not a rehearsal
    "и др.", // "etc." written in lower case is not ДР
    "Team sync",
    "",
  ])("%s has none, or not the wrong one", (title) => {
    expect(themeOf(title)).not.toBe("meal");
    expect(themeOf(title)).not.toBe("sport");
    expect(themeOf(title)).not.toBe("music");
    expect(themeOf(title)).not.toBe("birthday");
  });

  test("words that only look alike give nothing", () => {
    expect(themeOf("Завтра позвонить")).toBeNull();
    expect(themeOf("Победа")).toBeNull();
    expect(themeOf("и др.")).toBeNull();
    expect(themeOf("Team sync")).toBeNull();
    expect(themeOf(null)).toBeNull();
  });

  test("a run that is no sport", () => {
    expect(themeOf("Run the release")).toBeNull();
  });

  test("a tutor is study, a rehearsal music", () => {
    expect(themeOf("Репетитор")).toBe("study");
    expect(themeOf("Репетиция")).toBe("music");
  });

  test("a title with two themes' words gets the more specific", () => {
    expect(themeOf("Birthday dinner")).toBe("birthday");
    expect(themeOf("Обед после концерта")).toBe("music");
    expect(themeOf("Coffee at the airport")).toBe("travel");
  });

  test("case and diacritics do not matter", () => {
    expect(themeOf("LUNCH")).toBe("meal");
    expect(themeOf("Café")).toBe("coffee");
    expect(themeOf("ПЕРЕЛЕТ")).toBe("travel");
  });
});

describe("a month's banner", () => {
  test("north of the equator, the month's own", () => {
    for (let month = 1; month <= 12; month++) expect(bannerOf(month, "Europe/Vilnius")).toBe(month);
    expect(bannerOf(11, "America/New_York")).toBe(11);
    expect(bannerOf(1, "UTC")).toBe(1);
  });

  test("south of it, the season's: six months on", () => {
    expect(bannerOf(7, "Australia/Sydney")).toBe(1);
    expect(bannerOf(1, "Pacific/Auckland")).toBe(7);
    expect(bannerOf(12, "America/Argentina/Buenos_Aires")).toBe(6);
    expect(bannerOf(6, "Africa/Johannesburg")).toBe(12);
    expect(isSouthern("America/Sao_Paulo")).toBe(true);
    // The old names a system may still report (the tz database's links).
    for (const zone of [
      "America/Cordoba",
      "America/Mendoza",
      "America/Buenos_Aires",
      "Brazil/East",
      "Australia/ACT",
      "Australia/NSW",
      "NZ",
      "NZ-CHAT",
      "Chile/Continental",
    ])
      expect(isSouthern(zone), zone).toBe(true);
    // The tropics north of the equator, and zones that only sound southern, are not.
    expect(isSouthern("America/Bogota")).toBe(false);
    expect(isSouthern("Asia/Singapore")).toBe(false);
  });
});

describe("the pictures' files", () => {
  const file = (name: string) =>
    readFileSync(new URL(`../src/pictures/art/${name}.svg`, import.meta.url), "utf8");
  const art = readFileSync(new URL("../src/pictures/art.ts", import.meta.url), "utf8");

  const groundOf = (svg: string) =>
    /^<svg[^>]*>\s*<rect[^>]*fill="(#[0-9a-f]{6})"/i.exec(svg)?.[1]?.toLowerCase();
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

  test.each(THEMES)("%s: a ground as its first shape, the one art.ts names", (theme) => {
    expect(art).toContain(`${theme}: { url: ${theme}, ground: "${groundOf(file(theme))}" }`);
  });

  test.each(months)("month %s: a ground as its first shape, the one art.ts names", (month) => {
    expect(art).toContain(`{ url: month${month}, ground: "${groundOf(file(`month-${month}`))}" }`);
  });

  test.each([
    ...THEMES.map((theme) => [theme, "0 0 360 120"] as const),
    ...months.map((month) => [`month-${month}`, "0 0 800 200"] as const),
  ])("%s: nothing but shapes (no script, text, image or link)", (name, viewBox) => {
    const svg = file(name);
    expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"`)).toBe(
      true,
    );
    expect(svg).not.toMatch(/<(script|text|image|foreignObject|a)\b|href=|on\w+=/i);
  });
});
