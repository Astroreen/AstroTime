# Fixtures

Answers of the public Photon geocoder (`https://photon.komoot.io/api/`), for
the place search's tests (`../places.test.ts`) and the end-to-end tests that
search a place (`apps/web/e2e/places.spec.ts`), so no test reaches the
network (docs/plans/design.md#D175).

Recorded on 2026-11-02 by hand with `curl`, three requests in all, with a
User-Agent naming AstroTime; pretty-printed, otherwise as Photon sent them.

| File                     | Request                                                       | Answer |
| ------------------------ | ------------------------------------------------------------- | ------ |
| `photon-en.json`         | `?q=Brandenburger Tor&lang=en&limit=5`                        | 200    |
| `photon-default.json`    | `?q=Красная площадь&lang=default&limit=5&lat=55.75&lon=37.62` | 200    |
| `photon-ru-refused.json` | `?q=Красная площадь&lang=ru&limit=5`                          | 400    |

The public instance names places in English, German and French only
(`photon-ru-refused.json`: "Supported are: default, de, en, fr"), so any
other language asks for `default`, each place's own name. The answers came
with `Access-Control-Allow-Origin: *` and `Cache-Control: max-age=3600`.

The search asks for six places (`limit=6`); these were recorded asking for
five. Nothing read depends on how many come, and the tests hand the answer
over whatever the request asked, so they were not recorded again: two more
requests to a service whose fair use the app keeps.

## Wikipedia

Answers of Wikipedia's API for a place's photo (`../place-photos.test.ts`,
`apps/web/e2e/pictures.spec.ts`, `apps/web/e2e/built/csp.spec.ts`;
docs/plans/design.md#D220). Recorded on 2026-11-02 by hand with `curl`,
four requests, with a User-Agent naming AstroTime; pretty-printed,
otherwise as Wikipedia sent them. Each search asked `generator=search`,
`gsrlimit=3`, `prop=pageimages|coordinates`, `piprop=thumbnail|name`,
`pithumbsize=960`, `pilicense=free` (the app asks `prop=pageimages` only).

| File                            | Request                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `wikipedia-en-search.json`      | en: `gsrsearch=Brandenburger Tor nearcoord:1km,52.517,13.381`                          |
| `wikipedia-ru-search.json`      | ru: `gsrsearch=Красная площадь nearcoord:1km,55.754,37.622`                            |
| `wikipedia-en-search-none.json` | en: `gsrsearch=Kavine Pas Jona nearcoord:1km,54.687,25.28` (no pages)                  |
| `wikipedia-en-imageinfo.json`   | en: `titles=File:Brandenburger_Tor_abends.jpg`, `prop=imageinfo`, `iiprop=extmetadata` |

## `import/`

Files from other apps, for the import's converters (`../import.test.ts`,
docs/plans/import.md#D266). All **synthetic**: written by hand in the
shape each exporter is documented to write, since no such app or phone was
at hand; each line's form follows the vCalendar 1.0 specification (versit, 1996) and the exporters' published samples.

| File          | In the shape of                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outlook.vcs` | Outlook's "vCalendar format" (`Save As`): UTC times, quoted-printable text with soft breaks, `PRIORITY` 1–3, `AALARM`/`DALARM`, an all-day event as local midnights                             |
| `nokia.vcs`   | an older phone's export (Nokia S60, Samsung): `TZ` and `DAYLIGHT`, local times, Windows-1251 and UTF-8 quoted-printable, 1.0's rules (`W1 MO WE #4`, `YM1`, `MD1 … LD`, `MP1 1+ TH`), a `VTODO` |
