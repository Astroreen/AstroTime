// Which month's banner the Agenda draws above a month (design D218): the
// banners are seasons, drawn for the northern hemisphere, so south of the
// equator a month gets the banner six months on (July's winter is
// January's). Where the user is is read from their time zone alone, never
// asked: a zone whose place in the tz database lies south of the equator,
// or any of its old names (`southern-zones.ts`, generated).
import { SOUTHERN_ZONES } from "./southern-zones.ts";

/** Whether a time zone is south of the equator, with seasons the other way round. */
export function isSouthern(timeZone: string): boolean {
  return SOUTHERN_ZONES.has(timeZone);
}

/** The banner (1–12, by the northern months) above month `month` (1–12) in `timeZone`. */
export function bannerOf(month: number, timeZone: string): number {
  return isSouthern(timeZone) ? ((month + 5) % 12) + 1 : month;
}
