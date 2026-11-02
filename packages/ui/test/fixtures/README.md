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
