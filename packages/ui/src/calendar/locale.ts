// The language, week start and clock come from the device's locale
// (design D45: Russian means Monday and 24 hours); the drawer's settings
// override them (`settings.ts`, design D53).
import { LANGUAGES, type Language } from "../i18n/index.ts";

export interface LocaleSettings {
  /** The UI's language: the first of the user's languages AstroTime speaks. */
  readonly language: Language;
  /** The locale dates are formatted in: the language, in the user's region. */
  readonly locale: string;
  /** 1 (Monday) to 7 (Sunday). */
  readonly weekStart: number;
  readonly hour12: boolean;
}

const baseOf = (tag: string) => tag.split("-")[0]!.toLowerCase();

// Regions whose week starts on Sunday, for engines without `Intl.Locale` week info.
const SUNDAY_REGIONS = new Set(
  "AG AS BD BR BS BT BW BZ CA CN CO DM DO ET GT GU HK HN ID IL IN JM JP KE KH KR LA MH MM MO MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW".split(
    " ",
  ),
);

function weekStartOf(locale: string): number {
  const intl = new Intl.Locale(locale) as Intl.Locale & {
    getWeekInfo?: () => { firstDay: number };
    weekInfo?: { firstDay: number };
  };
  const info = intl.getWeekInfo?.() ?? intl.weekInfo;
  if (info) return info.firstDay;
  return SUNDAY_REGIONS.has(intl.maximize().region ?? "") ? 7 : 1;
}

/**
 * Whether the region of `locale` reads a 12-hour clock. `Intl.DateTimeFormat`
 * falls back to the language's own clock for a pair it has no data for
 * (`en-RU` would get 12 hours), so the locale's hour cycles come first.
 */
function hour12Of(locale: string): boolean {
  const intl = new Intl.Locale(locale) as Intl.Locale & {
    getHourCycles?: () => string[];
    hourCycles?: string[];
  };
  const cycle =
    intl.getHourCycles?.()[0] ??
    intl.hourCycles?.[0] ??
    new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle === "h11" || cycle === "h12";
}

/**
 * The settings of the user's languages, most preferred first. `chosen` is
 * the language picked in settings: it speaks that, with the dates of the
 * same region (ru-RU choosing English gets English, Monday and 24 hours).
 */
export function localeSettings(languages: readonly string[], chosen?: Language): LocaleSettings {
  const tags = languages.filter((tag) => {
    try {
      return Intl.getCanonicalLocales(tag).length > 0;
    } catch {
      return false;
    }
  });
  const spoken = tags.find((tag) =>
    chosen ? baseOf(tag) === chosen : (LANGUAGES as readonly string[]).includes(baseOf(tag)),
  );
  const language = chosen ?? ((spoken ? baseOf(spoken) : "en") as Language);
  // The region of the user's first language decides the week and the clock,
  // even when AstroTime does not speak that language (lt-LT: English, Monday, 24 h).
  const primary = tags[0];
  const region = primary ? new Intl.Locale(primary).maximize().region : undefined;
  const locale =
    primary && baseOf(primary) === language
      ? primary
      : spoken && !region
        ? spoken
        : region
          ? `${language}-${region}`
          : language;
  return { language, locale, weekStart: weekStartOf(locale), hour12: hour12Of(locale) };
}
