// Which month's banner the Agenda draws above a month (design D218): the
// banners are seasons, drawn for the northern hemisphere, so south of the
// equator a month gets the banner six months on (July's winter is
// January's). Where the user is is read from their time zone alone, never
// asked: a zone wholly or mostly south of the equator, seasons and all.

/** Zones south of the equator with seasons: whole areas, then single zones. */
const SOUTH_AREAS = ["Antarctica/", "Australia/", "America/Argentina/"];
const SOUTH_ZONES = new Set([
  "Africa/Gaborone",
  "Africa/Harare",
  "Africa/Johannesburg",
  "Africa/Lusaka",
  "Africa/Maputo",
  "Africa/Maseru",
  "Africa/Mbabane",
  "Africa/Windhoek",
  "America/Asuncion",
  "America/Buenos_Aires",
  "America/Montevideo",
  "America/Punta_Arenas",
  "America/Santiago",
  "America/Sao_Paulo",
  "Atlantic/Stanley",
  "Indian/Antananarivo",
  "Indian/Mauritius",
  "Indian/Reunion",
  "Pacific/Auckland",
  "Pacific/Chatham",
  "Pacific/Norfolk",
  "Pacific/Noumea",
  "Pacific/Fiji",
  "Pacific/Tongatapu",
  "Chile/Continental",
  "NZ",
]);

/** Whether a time zone is south of the equator, with seasons the other way round. */
export function isSouthern(timeZone: string): boolean {
  return SOUTH_ZONES.has(timeZone) || SOUTH_AREAS.some((area) => timeZone.startsWith(area));
}

/** The banner (1–12, by the northern months) above month `month` (1–12) in `timeZone`. */
export function bannerOf(month: number, timeZone: string): number {
  return isSouthern(timeZone) ? ((month + 5) % 12) + 1 : month;
}
