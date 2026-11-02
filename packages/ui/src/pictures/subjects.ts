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
      "airport*",
      // "Train" alone is also to teach ("Train the new hire"): only with a trip's words.
      "train to",
      "train from",
      "by train",
      "night train",
      "train station",
      "train ride",
      "train ticket*",
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
      // "Class" and "study" alone are also "First class", "Case study":
      // only as a lesson.
      "class at",
      "class with",
      "study session",
      "study group",
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
  ["cinema", ["cinema*", "movie*", "imax", "кино*", "фильм*"]],
  [
    "music",
    [
      "concert*",
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
      // "Park" alone is also to park a car: only as a place.
      "in the park",
      "to the park",
      "park walk",
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

/** Titles already read, the oldest forgotten first: every card asks as it is drawn. */
const READ = new Map<string, Subject | null>();
const READ_LIMIT = 1000;

/** The subject an item with this title is illustrated with, if any (design D215). */
export function subjectOf(title: string | null | undefined): Subject | null {
  if (!title) return null;
  const known = READ.get(title);
  if (known !== undefined) return known;
  const subject = read(title);
  if (READ.size >= READ_LIMIT) READ.delete(READ.keys().next().value!);
  READ.set(title, subject);
  return subject;
}

function read(title: string): Subject | null {
  // Composed first: a decomposed «й» or «ё» (NFD) would split its word at the mark.
  const words = title.normalize("NFC").match(WORD) ?? [];
  if (words.length === 0) return null;
  const folded = words.map(foldForSearch);
  for (const [subject, parts] of PATTERNS) {
    for (let at = 0; at + parts.length <= words.length; at++) {
      if (parts.every((part, i) => fits(part, words[at + i]!, folded[at + i]!))) return subject;
    }
  }
  return null;
}

/**
 * The user's own word a title has, if any (design D223): each word of
 * theirs the start of a title's word, three letters or more ("обед" finds
 * "обеда"), in a row when they wrote several, case and diacritics aside;
 * the first of theirs that a title has.
 */
export function ownWordOf<T extends { readonly word: string }>(
  title: string | null | undefined,
  own: readonly T[],
): T | null {
  if (!title || own.length === 0) return null;
  const words = title.normalize("NFC").match(WORD) ?? [];
  const folded = words.map(foldForSearch);
  for (const entry of own) {
    const parts = (entry.word.normalize("NFC").match(WORD) ?? []).map((word) => {
      const text = foldForSearch(word);
      return { text, prefix: text.length >= 3, exact: false };
    });
    if (parts.length === 0) continue;
    for (let at = 0; at + parts.length <= words.length; at++) {
      if (parts.every((part, i) => fits(part, words[at + i]!, folded[at + i]!))) return entry;
    }
  }
  return null;
}
