// A colour's generated name (design D170): its hue's family and, by its
// lightness and saturation, one modifier: "Dusty rose", "Deep teal",
// "Пыльно-розовый", "Глубокий бирюзовый". Deterministic for a colour and
// small: no list of thousands of names, no network.
import type { Language } from "../i18n/index.ts";

interface Family {
  /** The family's start, in degrees of hue; it runs to the next one's. */
  readonly from: number;
  readonly en: string;
  /** The masculine adjective, as Russian names a colour: "красный". */
  readonly ru: string;
}

const FAMILIES: readonly Family[] = [
  { from: 0, en: "red", ru: "красный" },
  { from: 8, en: "coral", ru: "коралловый" },
  { from: 20, en: "orange", ru: "оранжевый" },
  { from: 40, en: "amber", ru: "янтарный" },
  { from: 50, en: "yellow", ru: "жёлтый" },
  { from: 66, en: "lime", ru: "лаймовый" },
  { from: 85, en: "green", ru: "зелёный" },
  { from: 140, en: "emerald", ru: "изумрудный" },
  { from: 160, en: "teal", ru: "бирюзовый" },
  { from: 185, en: "cyan", ru: "голубой" },
  { from: 195, en: "azure", ru: "лазурный" },
  { from: 212, en: "blue", ru: "синий" },
  { from: 245, en: "indigo", ru: "индиговый" },
  { from: 262, en: "violet", ru: "фиолетовый" },
  { from: 280, en: "purple", ru: "лиловый" },
  { from: 298, en: "magenta", ru: "пурпурный" },
  { from: 330, en: "rose", ru: "розовый" },
  { from: 352, en: "red", ru: "красный" },
];

/** Families a dark colour of a hue is called by instead: brown, olive. */
const DARK: readonly { readonly from: number; readonly to: number; readonly family: Family }[] = [
  { from: 10, to: 50, family: { from: 0, en: "brown", ru: "коричневый" } },
  { from: 50, to: 75, family: { from: 0, en: "olive", ru: "оливковый" } },
  { from: 298, to: 330, family: { from: 0, en: "purple", ru: "лиловый" } },
];
/** Families a light, soft colour of a hue is called by instead: beige. */
const SOFT: readonly { readonly from: number; readonly to: number; readonly family: Family }[] = [
  { from: 20, to: 50, family: { from: 0, en: "beige", ru: "бежевый" } },
];
const GREY: Family = { from: 0, en: "grey", ru: "серый" };
/** Light red is pink, as a person says it. */
const PINK: Family = { from: 0, en: "pink", ru: "розовый" };

type Modifier = "deep" | "dark" | "light" | "pale" | "dusty" | "bright" | null;

/** A modifier in English, and in Russian as a prefix ("Тёмно-") or an adjective ("Глубокий "). */
const MODIFIERS: Record<Exclude<Modifier, null>, { en: string; ru: string }> = {
  deep: { en: "deep", ru: "глубокий " },
  dark: { en: "dark", ru: "тёмно-" },
  light: { en: "light", ru: "светло-" },
  pale: { en: "pale", ru: "бледно-" },
  dusty: { en: "dusty", ru: "пыльно-" },
  bright: { en: "bright", ru: "ярко-" },
};

/** `#rgb` or `#rrggbb` as hue (degrees), saturation and lightness (0–1), HSL's. */
function hsl(hex: string): { h: number; s: number; l: number } | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const digits = match[1]!.length === 3 ? [...match[1]!].map((d) => d + d).join("") : match[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** The generated name of `hex` in `language`, capitalised; `null` for what is no colour. */
export function colorName(hex: string, language: Language): string | null {
  const color = hsl(hex);
  if (!color) return null;
  const { h, s, l } = color;
  let family: Family;
  let modifier: Modifier;
  if (l < 0.08) return capitalise(language === "ru" ? "чёрный" : "black", language);
  if (l > 0.96) return capitalise(language === "ru" ? "белый" : "white", language);
  if (s < 0.1) {
    family = GREY;
    modifier = l < 0.3 ? "dark" : l > 0.7 ? "light" : null;
  } else {
    family = FAMILIES.findLast((f) => f.from <= h)!;
    modifier =
      l < 0.22
        ? "deep"
        : l < 0.36
          ? "dark"
          : l > 0.84
            ? "pale"
            : l > 0.66
              ? "light"
              : s < 0.38
                ? "dusty"
                : s > 0.85 && l > 0.42 && l < 0.58
                  ? "bright"
                  : null;
    const dark = DARK.find((d) => d.from <= h && h < d.to);
    if (dark && l < 0.36 && s >= 0.2) {
      family = dark.family;
      modifier = l < 0.2 ? "dark" : null;
    }
    const soft = SOFT.find((d) => d.from <= h && h < d.to);
    if (soft && l > 0.6 && s < 0.6) {
      family = soft.family;
      if (modifier !== "pale") modifier = null;
    }
    if (family.en === "red" && (modifier === "light" || modifier === "pale")) {
      family = PINK;
      if (modifier === "light") modifier = null;
    }
  }
  if (!modifier) return capitalise(family[language], language);
  const word = MODIFIERS[modifier][language];
  return capitalise(language === "ru" ? `${word}${family.ru}` : `${word} ${family.en}`, language);
}

const capitalise = (name: string, language: Language) =>
  name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
