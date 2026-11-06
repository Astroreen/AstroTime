// The illustrations' subjects (design D215): a title's words, in English and
// Russian with their forms, give an item its picture; a month its season's
// banner, south of the equator too (D218); and the pictures are only shapes.
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import { bannerOf, isSouthern } from "../src/pictures/months.ts";
import { ownWordOf, SUBJECTS, subjectOf } from "../src/pictures/subjects.ts";

describe("an item's subject from its title", () => {
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
    ["Team meeting", "meeting"],
    ["Video call with Max", "meeting"],
    ["Созвон с командой", "meeting"],
    ["Встреча с заказчиком", "meeting"],
    ["Совещание", "meeting"],
    ["Собеседование", "meeting"],
    ["Haircut", "haircut"],
    ["Barber", "haircut"],
    ["Стрижка", "haircut"],
    ["Подстричься", "haircut"],
    ["К парикмахеру", "haircut"],
    ["Code review", "code"],
    ["Coding session", "code"],
    ["Хакатон", "code"],
    ["Код-ревью", "code"],
    ["Отладка сервера", "code"],
    ["Cleaning the flat", "cleaning"],
    ["Vacuum the stairs", "cleaning"],
    ["Генеральная уборка", "cleaning"],
    ["Прибраться дома", "cleaning"],
    ["Стирка", "cleaning"],
    ["Car wash", "car"],
    ["Oil change", "car"],
    ["Автосервис", "car"],
    ["Шиномонтаж", "car"],
    ["Переобуть машину", "car"],
    ["Wedding", "wedding"],
    ["Свадьба Ани и Пети", "wedding"],
    ["В ЗАГС", "wedding"],
    ["Beach day", "beach"],
    ["На море!", "beach"],
    ["Пляж", "beach"],
    ["Halloween", "halloween"],
    ["Хэллоуин у Оли", "halloween"],
  ] as const)("%s → %s", (title, subject) => {
    expect(subjectOf(title)).toBe(subject);
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
    expect(subjectOf(title)).not.toBe("meal");
    expect(subjectOf(title)).not.toBe("sport");
    expect(subjectOf(title)).not.toBe("music");
    expect(subjectOf(title)).not.toBe("birthday");
  });

  test("words that only look alike give nothing", () => {
    expect(subjectOf("Завтра позвонить")).toBeNull();
    expect(subjectOf("Победа")).toBeNull();
    expect(subjectOf("и др.")).toBeNull();
    expect(subjectOf("Team sync")).toBeNull();
    expect(subjectOf(null)).toBeNull();
  });

  test("a word with another sense gives nothing alone, its subject with a word that says it", () => {
    for (const title of [
      "Park the car",
      "Train the new hire",
      "First class",
      "Case study review",
      "Film the talk",
      "Gig economy panel",
      "Shop talk",
      "Fly the drone",
    ])
      expect(subjectOf(title), title).toBeNull();
    expect(subjectOf("Night train to Riga")).toBe("travel");
    expect(subjectOf("Train to Riga")).toBe("travel");
    expect(subjectOf("Walk in the park")).toBe("walk");
    expect(subjectOf("Kids to the park")).toBe("walk");
    expect(subjectOf("Study group")).toBe("study");
    expect(subjectOf("Class with Ms. Lee")).toBe("study");
  });

  test("a title is read once: asked again, the same answer", () => {
    expect(subjectOf("Lunch with Anna")).toBe("meal");
    expect(subjectOf("Lunch with Anna")).toBe("meal");
  });

  test("the new subjects' words with another sense give nothing alone (design D298)", () => {
    for (const title of [
      "Park the car", // a car only as what is done to one
      "Dress code",
      "Code of conduct",
      "Team sync", // a meeting only as one
      "Call mom",
      "Clean code", // neither cleaning nor coding
      "Sea of tasks",
      "Море дел",
      "Встречаем гостей", // to meet, not a meeting
    ])
      expect(subjectOf(title), title).toBeNull();
  });

  test("a new subject keeps to its place among the others", () => {
    expect(subjectOf("Halloween party")).toBe("halloween");
    expect(subjectOf("Wedding dinner")).toBe("wedding");
    expect(subjectOf("Vacation at the beach")).toBe("beach");
    expect(subjectOf("Flight to the beach")).toBe("beach");
    expect(subjectOf("Lunch meeting")).toBe("meal");
    expect(subjectOf("Coffee call with Anna")).toBe("coffee");
    expect(subjectOf("Code review meeting")).toBe("code");
    expect(subjectOf("Meeting at the airport")).toBe("travel");
    expect(subjectOf("Driving lesson")).toBe("car");
  });

  test("a run that is no sport", () => {
    expect(subjectOf("Run the release")).toBeNull();
  });

  test("a tutor is study, a rehearsal music", () => {
    expect(subjectOf("Репетитор")).toBe("study");
    expect(subjectOf("Репетиция")).toBe("music");
  });

  test("a party of no kind named is a birthday's picture, but never beats a subject", () => {
    expect(subjectOf("Christmas party")).toBe("winter");
    expect(subjectOf("New Year party")).toBe("winter");
    expect(subjectOf("Новогодний корпоратив")).toBe("winter");
    expect(subjectOf("Корпоратив в ресторане")).toBe("meal");
    expect(subjectOf("Dinner party")).toBe("meal");
    expect(subjectOf("Birthday party")).toBe("birthday");
    expect(subjectOf("Doctor's birthday")).toBe("birthday");
    expect(subjectOf("Вечеринка у Пети")).toBe("birthday");
    expect(subjectOf("Party")).toBe("birthday");
  });

  test("a title with two subjects' words gets the more specific", () => {
    expect(subjectOf("Birthday dinner")).toBe("birthday");
    expect(subjectOf("Обед после концерта")).toBe("music");
    expect(subjectOf("Coffee at the airport")).toBe("travel");
  });

  test("a title written decomposed (NFD) reads as the same words", () => {
    expect(subjectOf("Йога".normalize("NFD"))).toBe("sport");
    expect(subjectOf("Перелёт в Ригу".normalize("NFD"))).toBe("travel");
    expect(subjectOf("Новогодний корпоратив".normalize("NFD"))).toBe("winter");
  });

  test("case and diacritics do not matter", () => {
    expect(subjectOf("LUNCH")).toBe("meal");
    expect(subjectOf("Café")).toBe("coffee");
    expect(subjectOf("ПЕРЕЛЕТ")).toBe("travel");
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
    // The tropics keep the northern months, either side of the equator.
    for (const zone of [
      // Links to Nairobi in `backward`, placed north of the equator in zone.tab.
      "Africa/Addis_Ababa",
      "Africa/Asmara",
      "Africa/Djibouti",
      "Africa/Kampala",
      "Africa/Mogadishu",
      "Africa/Nairobi",
      "Asia/Jakarta",
      "America/Lima",
      "Africa/Luanda",
      "America/La_Paz",
      "Pacific/Tahiti",
      "America/Bogota",
      "Asia/Singapore",
    ])
      expect(isSouthern(zone), zone).toBe(false);
    expect(isSouthern("UTC")).toBe(false);
  });
});

describe("the pictures' files", () => {
  const file = (name: string) =>
    readFileSync(new URL(`../src/pictures/art/${name}.svg`, import.meta.url), "utf8");
  const art = readFileSync(new URL("../src/pictures/art.ts", import.meta.url), "utf8");

  const groundOf = (svg: string) =>
    /^<svg[^>]*>\s*<rect[^>]*fill="(#[0-9a-f]{6})"/i.exec(svg)?.[1]?.toLowerCase();
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

  test.each(SUBJECTS)("%s: a ground as its first shape, the one art.ts names", (subject) => {
    expect(art).toContain(`${subject}: { url: ${subject}, ground: "${groundOf(file(subject))}" }`);
  });

  test.each(months)("month %s: a ground as its first shape, the one art.ts names", (month) => {
    expect(art).toContain(`{ url: month${month}, ground: "${groundOf(file(`month-${month}`))}" }`);
  });

  test.each([
    ...SUBJECTS.map((subject) => [subject, "0 0 360 120"] as const),
    ...months.map((month) => [`month-${month}`, "0 0 800 200"] as const),
  ])("%s: nothing but shapes (no script, text, image or link)", (name, viewBox) => {
    const svg = file(name);
    expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"`)).toBe(
      true,
    );
    // A link only to a shape of its own (`<use href="#tree">`), never out.
    expect(svg).not.toMatch(/<(script|text|image|foreignObject|a)\b|href="(?!#)|on\w+=/i);
  });
});

describe("the user's own words (design D223)", () => {
  const own = [
    { id: "a", word: "Теннис", picture: "1" },
    { id: "b", word: "book club", picture: "2" },
    { id: "c", word: "Ox", picture: "3" },
  ];

  test("a word of theirs begins a title's word, case and diacritics aside, the first of theirs a title has", () => {
    expect(ownWordOf("Теннис с Петей", own)?.id).toBe("a");
    expect(ownWordOf("На теннисе", own)?.id).toBe("a");
    expect(ownWordOf("Book Club: Dune", own)?.id).toBe("b");
    // Several words: in a row.
    expect(ownWordOf("Club for books", own)).toBeNull();
    // A short word only whole.
    expect(ownWordOf("Oxford trip", own)).toBeNull();
    expect(ownWordOf("Ox Bar", own)?.id).toBe("c");
    expect(ownWordOf("Lunch", own)).toBeNull();
    expect(ownWordOf("Теннис", [])).toBeNull();
  });
});
