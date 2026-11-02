// The illustrations' and month banners' files (design D215, D218, D219):
// each a picture of its own the build emits beside the scripts, fetched only
// when a card or a banner shows it; here only their URLs, and each one's
// ground, its first shape, which fills its box until it comes and a card
// wider than it (`pictures.test.ts` holds them to the files).
import birthday from "./art/birthday.svg?no-inline";
import cinema from "./art/cinema.svg?no-inline";
import coffee from "./art/coffee.svg?no-inline";
import doctor from "./art/doctor.svg?no-inline";
import meal from "./art/meal.svg?no-inline";
import music from "./art/music.svg?no-inline";
import shopping from "./art/shopping.svg?no-inline";
import sport from "./art/sport.svg?no-inline";
import study from "./art/study.svg?no-inline";
import travel from "./art/travel.svg?no-inline";
import walk from "./art/walk.svg?no-inline";
import winter from "./art/winter.svg?no-inline";
import month01 from "./art/month-01.svg?no-inline";
import month02 from "./art/month-02.svg?no-inline";
import month03 from "./art/month-03.svg?no-inline";
import month04 from "./art/month-04.svg?no-inline";
import month05 from "./art/month-05.svg?no-inline";
import month06 from "./art/month-06.svg?no-inline";
import month07 from "./art/month-07.svg?no-inline";
import month08 from "./art/month-08.svg?no-inline";
import month09 from "./art/month-09.svg?no-inline";
import month10 from "./art/month-10.svg?no-inline";
import month11 from "./art/month-11.svg?no-inline";
import month12 from "./art/month-12.svg?no-inline";
import type { Subject } from "./subjects.ts";

export interface Art {
  readonly url: string;
  /** The picture's own ground. */
  readonly ground: string;
}

export const ITEM_ART: Readonly<Record<Subject, Art>> = {
  birthday: { url: birthday, ground: "#c6b3e6" },
  winter: { url: winter, ground: "#2f4a7a" },
  travel: { url: travel, ground: "#a8c7fa" },
  doctor: { url: doctor, ground: "#9fd8c8" },
  study: { url: study, ground: "#a9c79a" },
  cinema: { url: cinema, ground: "#7a4f8f" },
  music: { url: music, ground: "#c6b3e6" },
  sport: { url: sport, ground: "#a8c7fa" },
  walk: { url: walk, ground: "#a8c7fa" },
  shopping: { url: shopping, ground: "#9fd8c8" },
  meal: { url: meal, ground: "#f4b393" },
  coffee: { url: coffee, ground: "#e8c9a4" },
};

/** The month banners, January's first, as drawn for the northern hemisphere (design D218). */
export const MONTH_ART: readonly Art[] = [
  { url: month01, ground: "#8aa3cf" },
  { url: month02, ground: "#97acd6" },
  { url: month03, ground: "#a0bbe6" },
  { url: month04, ground: "#a4c2f0" },
  { url: month05, ground: "#9ec2f2" },
  { url: month06, ground: "#a4c6f8" },
  { url: month07, ground: "#a8c7fa" },
  { url: month08, ground: "#f2c4a0" },
  { url: month09, ground: "#b4cbe2" },
  { url: month10, ground: "#c5c4e2" },
  { url: month11, ground: "#9aa3b6" },
  { url: month12, ground: "#4a6195" },
];
