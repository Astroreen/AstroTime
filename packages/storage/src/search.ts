// Finding items by title (design D53): the store keeps each object's titles
// folded, and folds what is searched for the same way, so a search ignores
// case and diacritics in every script (`É` finds `e`, `Ё` finds `е`).
import type { CalendarObject } from "@astrotime/core";

/** Text as search compares it: lower case, without diacritics, compatibility forms unified. */
export function foldForSearch(text: string): string {
  return text.toLowerCase().normalize("NFKD").replaceAll(/\p{M}/gu, "");
}

/** The folded titles of an object's master and exceptions, one per line. */
export function titlesOf(object: CalendarObject): string {
  const items = object.master ? [object.master, ...object.exceptions] : object.exceptions;
  const titles = items.map((item) => foldForSearch(item.summary ?? "")).filter(Boolean);
  return [...new Set(titles)].join("\n");
}

/** A `LIKE … ESCAPE '\'` pattern that finds `folded` anywhere in a column. */
export function containsPattern(folded: string): string {
  return `%${folded.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
