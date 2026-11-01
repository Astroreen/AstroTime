// Every catalog says everything the English one does (AGENTS.md rule 5), with
// the plural forms its language needs (docs/plans/foundation.md#D17).
import { expect, test } from "vite-plus/test";

import { catalogs, createI18n, LANGUAGES } from "../src/i18n/index.ts";

const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(PLURAL, "");
const variables = (text: string) =>
  [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).toSorted();

test("the catalogs have the same keys, plural categories aside", () => {
  const english = new Set(Object.keys(catalogs.en).map(base));
  for (const language of LANGUAGES) {
    expect(new Set(Object.keys(catalogs[language]).map(base)), language).toEqual(english);
  }
});

test("each plural has exactly the categories its language's rules name", () => {
  for (const language of LANGUAGES) {
    const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories.toSorted();
    const plurals = new Map<string, string[]>();
    for (const key of Object.keys(catalogs[language])) {
      const match = PLURAL.exec(key);
      if (match) plurals.set(base(key), [...(plurals.get(base(key)) ?? []), match[1]!]);
    }
    expect(plurals.size, language).toBeGreaterThan(0);
    for (const [key, found] of plurals)
      expect(found.toSorted(), `${language} ${key}`).toEqual(categories);
  }
});

test("a message has the same placeholders in every language", () => {
  const placeholders = (language: (typeof LANGUAGES)[number]) => {
    const byBase = new Map<string, string>();
    for (const [key, text] of Object.entries(catalogs[language]))
      byBase.set(base(key), variables(text).join(","));
    return byBase;
  };
  const english = placeholders("en");
  for (const language of LANGUAGES) expect(placeholders(language), language).toEqual(english);
});

test("plurals follow each language's rules", () => {
  const en = createI18n("en");
  const ru = createI18n("ru");
  expect([1, 2, 5].map((count) => en.t("undone", { count }))).toEqual([
    "1 undone task",
    "2 undone tasks",
    "5 undone tasks",
  ]);
  expect([1, 3, 5, 21].map((count) => ru.t("undone", { count }))).toEqual([
    "1 невыполненная задача",
    "3 невыполненные задачи",
    "5 невыполненных задач",
    "21 невыполненная задача",
  ]);
  expect(ru.t("grid.more", { count: 3 })).toBe("+3");
  expect([1, 3, 5].map((count) => ru.t("month.more", { count, day: "среда" }))).toEqual([
    "+1 запись, среда",
    "+3 записи, среда",
    "+5 записей, среда",
  ]);
  expect([1, 3, 5].map((count) => ru.t("month.day", { count, day: "среда, 4 ноября" }))).toEqual([
    "среда, 4 ноября, 1 запись",
    "среда, 4 ноября, 3 записи",
    "среда, 4 ноября, 5 записей",
  ]);
});
