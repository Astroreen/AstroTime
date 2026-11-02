// The illustrations' subjects (design D215): which picture an item gets from
// the words of its title, in English and Russian with their forms. A pure
// function over the title; the pictures themselves are files fetched when a
// card shows one (`art.ts`).
import { foldForSearch } from "@astrotime/storage";

/** The subjects, each a picture of its own. */
export const SUBJECTS = [
  "winter",
  "birthday",
  "travel",
  "doctor",
  "study",
  "cinema",
  "music",
  "sport",
  "walk",
  "shopping",
  "meal",
  "coffee",
] as const;
export type Subject = (typeof SUBJECTS)[number];

/**
 * Each subject's words, the most specific first: a title with words of
 * two groups gets the first's (the winter holidays before a birthday, a
 * birthday before a meal, any party last). A word is matched against the title's words, folded
 * as search folds them (case and diacritics aside, `ё` as `е`): `обед`
 * only the word itself, `обед*` any word it begins (обеда, обеденный),
 * several in a row (`день рождени*`), `=ДР` the word exactly as written,
 * where folding it would make it another (`др.`, "etc.").
 */
const WORDS: readonly (readonly [Subject, readonly string[]])[] = [
  [
    "winter",
    [
      "new year*",
      "christmas*",
      "xmas",
      "новый год",
      "нового года",
      "новым годом",
      "новом году",
      "новогодн*",
      "рождеств*",
      "елк*",
    ],
  ],
  [
    "birthday",
    ["birthday*", "bday*", "рождени*", "=ДР", "днюх*", "днюшк*", "юбиле*", "anniversary"],
  ],
  [
    "travel",
    [
      "flight*",
      "fly",
      "flying",
      "airport*",
      "train",
      "trains",
      "trip",
      "trips",
      "travel*",
      "vacation*",
      "рейс",
      "рейса",
      "рейсом",
      "перелет*",
      "вылет*",
      "прилет*",
      "аэропорт*",
      "самолет*",
      "поезд*",
      "вокзал*",
      "электричк*",
      "путешеств*",
      "отпуск*",
      "командировк*",
    ],
  ],
  [
    "doctor",
    [
      "doctor*",
      "dentist*",
      "clinic*",
      "hospital*",
      "checkup",
      "check up",
      "physio*",
      "врач*",
      "доктор*",
      "стоматолог*",
      "дантист*",
      "зубн*",
      "клиник*",
      "поликлиник*",
      "больниц*",
      "терапевт*",
      "медосмотр*",
    ],
  ],
  [
    "study",
    [
      "exam*",
      "lecture*",
      "lesson*",
      "class",
      "classes",
      "study",
      "studying",
      "homework",
      "seminar*",
      "tutor*",
      "school",
      "экзамен*",
      "зачет*",
      "лекци*",
      "урок*",
      "учеб*",
      "семинар*",
      "домашк*",
      "репетитор*",
      "школ*",
      "контрольн*",
    ],
  ],
  ["cinema", ["cinema*", "movie*", "film", "films", "imax", "кино*", "фильм*"]],
  [
    "music",
    [
      "concert*",
      "gig",
      "music*",
      "rehearsal*",
      "choir",
      "guitar*",
      "piano*",
      "opera",
      "концерт*",
      "музык*",
      "репетиц*",
      "гитар*",
      "фортепиан*",
      "пианино",
      "хор",
      "хора",
      "хоре",
      "оркестр*",
      "опера",
      "оперу",
      "оперы",
      "опере",
      "филармони*",
    ],
  ],
  [
    "sport",
    [
      "gym",
      "workout*",
      "training",
      "running",
      "jog*",
      "marathon*",
      "yoga",
      "pilates",
      "swim*",
      "fitness",
      "football",
      "soccer",
      "tennis",
      "basketball",
      "volleyball",
      "hockey",
      "cycling",
      "crossfit",
      "boxing",
      "climbing",
      "спорт*",
      "тренировк*",
      "тренир*",
      "тренер*",
      "фитнес*",
      "качалк*",
      "пробежк*",
      "бег",
      "бегать",
      "побегать",
      "забег*",
      "марафон*",
      "йога",
      "йогой",
      "йоги",
      "йогу",
      "йоге",
      "пилатес*",
      "бассейн*",
      "плавани*",
      "футбол*",
      "теннис*",
      "баскетбол*",
      "волейбол*",
      "хокке*",
      "бокс",
      "боксом",
      "кроссфит*",
      "скалодром*",
    ],
  ],
  [
    "walk",
    [
      "walk",
      "walks",
      "walking",
      "hike",
      "hikes",
      "hiking",
      "stroll*",
      "park",
      "прогулк*",
      "прогуля*",
      "погулять",
      "гулять",
      "парк",
      "парке",
      "парка",
      "парку",
      "поход",
      "походе",
      "похода",
      "походы",
    ],
  ],
  [
    "shopping",
    [
      "shop",
      "shopping",
      "groceries",
      "grocery",
      "supermarket*",
      "mall",
      "покупк*",
      "магазин*",
      "продукты",
      "продуктами",
      "шопинг*",
      "рынок",
      "рынке",
      "рынка",
      "супермаркет*",
      "закуп*",
    ],
  ],
  [
    "meal",
    [
      "breakfast*",
      "brunch*",
      "lunch*",
      "dinner*",
      "supper",
      "restaurant*",
      "picnic*",
      "bbq",
      "barbecue",
      "завтрак*",
      "позавтрака*",
      "обед*",
      "пообеда*",
      "ужин*",
      "поужина*",
      "ресторан*",
      "перекус*",
      "бранч*",
      "шашлык*",
      "пикник*",
    ],
  ],
  [
    "coffee",
    [
      "coffee*",
      "cafe*",
      "espresso",
      "latte",
      "cappuccino",
      "tea",
      "кофе*",
      "кофей*",
      "кафе",
      "чай",
      "чаю",
      "чая",
      "чаепити*",
      "капучино",
      "латте",
    ],
  ],
  // A party of no kind named is drawn as a birthday, after every subject:
  // "Christmas party" is the winter holidays', "Dinner party" a meal.
  ["birthday", ["party", "parties", "вечеринк*", "тусовк*", "праздник*", "корпоратив*"]],
];

/** One word of a pattern: folded, or exact; whole, or the start of a word. */
interface Part {
  readonly text: string;
  readonly prefix: boolean;
  readonly exact: boolean;
}

const WORD = /[\p{L}\p{N}]+/gu;

function partsOf(pattern: string): Part[] {
  return pattern.split(" ").map((word) => {
    const exact = word.startsWith("=");
    const bare = word.replace(/^=/, "");
    const prefix = bare.endsWith("*");
    const text = bare.replace(/\*$/, "");
    return { text: exact ? text : foldForSearch(text), prefix, exact };
  });
}

/** The patterns, parsed once, in the groups' order. */
const PATTERNS: readonly (readonly [Subject, readonly Part[]])[] = WORDS.flatMap(
  ([subject, words]) => words.map((pattern) => [subject, partsOf(pattern)] as const),
);

const fits = (part: Part, word: string, folded: string) => {
  const text = part.exact ? word : folded;
  return part.prefix ? text.startsWith(part.text) : text === part.text;
};

/** The subject an item with this title is illustrated with, if any (design D215). */
export function subjectOf(title: string | null | undefined): Subject | null {
  if (!title) return null;
  const words = title.match(WORD) ?? [];
  if (words.length === 0) return null;
  const folded = words.map(foldForSearch);
  for (const [subject, parts] of PATTERNS) {
    for (let at = 0; at + parts.length <= words.length; at++) {
      if (parts.every((part, i) => fits(part, words[at + i]!, folded[at + i]!))) return subject;
    }
  }
  return null;
}
