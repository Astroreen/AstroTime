// i18n through i18next (docs/plans/foundation.md#D17): no build step, CLDR
// plurals from `Intl.PluralRules`, one instance per app.
import i18next, { type i18n } from "i18next";

import { en, type Catalog as Strings } from "./en.ts";
import type { fileStrings } from "./files.ts";
import type { pictureStrings } from "./pictures.ts";
import type { signInStrings } from "./sign-in.ts";
import type { taskStrings } from "./tasks.ts";
import { ru } from "./ru.ts";

export const LANGUAGES = ["en", "ru"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Every string `t` knows: the app's, and those that load later with their part (`later.ts`). */
type Catalog = Strings &
  (typeof pictureStrings)["en"] &
  (typeof fileStrings)["en"] &
  (typeof taskStrings)["en"] &
  (typeof signInStrings)["en"];

export const catalogs = { en, ru } satisfies Record<Language, Record<string, string>>;

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    keySeparator: false;
    nsSeparator: false;
    resources: { translation: Catalog };
  }
}

// Every catalog has the English keys, plural categories aside.
type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";
type Base<T> = { [K in keyof T]: K extends `${infer B}_${PluralSuffix}` ? B : K }[keyof T];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameKeys: Same<Base<typeof ru>, Base<Strings>> = true;
void sameKeys;

export function createI18n(language: Language): i18n {
  const instance = i18next.createInstance();
  void instance.init({
    lng: language,
    fallbackLng: "en",
    supportedLngs: LANGUAGES,
    resources: Object.fromEntries(LANGUAGES.map((lng) => [lng, { translation: catalogs[lng] }])),
    keySeparator: false,
    nsSeparator: false,
    // React escapes what it renders.
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}
