# Fixtures

Answers of the public Photon geocoder (`https://photon.komoot.io/api/`), for
the place search's tests (`../places.test.ts`) and the end-to-end tests that
search a place (`apps/web/e2e/places.spec.ts`), so no test reaches the
network (docs/plans/design.md#D175).

Recorded on 2026-11-02 by hand with `curl`, three requests in all, with a
User-Agent naming AstroTime; pretty-printed, otherwise as Photon sent them.

| File                  | Request                                                       |
| --------------------- | ------------------------------------------------------------- |
| `photon-en.json`      | `?q=Brandenburger Tor&lang=en&limit=5`                        |
| `photon-default.json` | `?q=Красная площадь&lang=default&limit=5&lat=55.75&lon=37.62` |

The third, `?q=Красная площадь&lang=ru`, answered `400` with
`{"lang":[{"message":"Language is not supported. Supported are: default, de, en, fr", …}]}`:
the public instance names places in English, German and French, so any other
language asks for `default`, each place's own name. The answers came with
`Access-Control-Allow-Origin: *` and `Cache-Control: max-age=3600`.
