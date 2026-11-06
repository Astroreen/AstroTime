// The illustrations' and month banners' files (design D215, D218, D219):
// each a picture of its own the build emits beside the scripts, fetched only
// when a card or a banner shows it; here only their URLs, and each one's
// ground, its first shape, which fills its box until it comes and a card
// wider than it (`pictures.test.ts` holds them to the files).
import beach from "./art/beach.svg?no-inline";
import birthday from "./art/birthday.svg?no-inline";
import car from "./art/car.svg?no-inline";
import cinema from "./art/cinema.svg?no-inline";
import cleaning from "./art/cleaning.svg?no-inline";
import code from "./art/code.svg?no-inline";
import coffee from "./art/coffee.svg?no-inline";
import doctor from "./art/doctor.svg?no-inline";
import haircut from "./art/haircut.svg?no-inline";
import halloween from "./art/halloween.svg?no-inline";
import meal from "./art/meal.svg?no-inline";
import meeting from "./art/meeting.svg?no-inline";
import music from "./art/music.svg?no-inline";
import shopping from "./art/shopping.svg?no-inline";
import sport from "./art/sport.svg?no-inline";
import study from "./art/study.svg?no-inline";
import travel from "./art/travel.svg?no-inline";
import walk from "./art/walk.svg?no-inline";
import wedding from "./art/wedding.svg?no-inline";
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
  birthday: { url: birthday, ground: "#b39dd9" },
  winter: { url: winter, ground: "#5a77ae" },
  travel: { url: travel, ground: "#9bbcf0" },
  doctor: { url: doctor, ground: "#90cbbb" },
  study: { url: study, ground: "#9bbc8d" },
  cinema: { url: cinema, ground: "#4e3363" },
  music: { url: music, ground: "#4f3469" },
  sport: { url: sport, ground: "#8aaee6" },
  walk: { url: walk, ground: "#9ebfec" },
  shopping: { url: shopping, ground: "#8fcbbc" },
  meal: { url: meal, ground: "#e19b77" },
  coffee: { url: coffee, ground: "#d2ab83" },
  beach: { url: beach, ground: "#7fb4d9" },
  car: { url: car, ground: "#94b5e2" },
  cleaning: { url: cleaning, ground: "#a6bfe0" },
  code: { url: code, ground: "#5d6ea3" },
  haircut: { url: haircut, ground: "#8cbfb4" },
  halloween: { url: halloween, ground: "#7a5a8c" },
  meeting: { url: meeting, ground: "#a3b1dc" },
  wedding: { url: wedding, ground: "#c6a3c6" },
};

/** The month banners, January's first, as drawn for the northern hemisphere (design D218). */
export const MONTH_ART: readonly Art[] = [
  { url: month01, ground: "#8aa3cf" },
  { url: month02, ground: "#a9acd6" },
  { url: month03, ground: "#9cb9df" },
  { url: month04, ground: "#a3c1e8" },
  { url: month05, ground: "#9fc2ec" },
  { url: month06, ground: "#9cc4f0" },
  { url: month07, ground: "#7fb2e2" },
  { url: month08, ground: "#e9b48a" },
  { url: month09, ground: "#a3c0dc" },
  { url: month10, ground: "#c6b3d3" },
  { url: month11, ground: "#9ea6b6" },
  { url: month12, ground: "#6b7fb6" },
];
