# Recordings of services

What each service answered to the scenario of `../../scenario.ts`, made by
`scripts/record-caldav-service.ts` and replayed by `../../services.test.ts`
on every run (docs/plans/providers.md#D249). The account's name, e-mail and
the ids a service puts in its paths are replaced by stand-ins (`user`,
`user@example.com`, `account-N`) before a file is written; the script
refuses to write one that still holds any of them or the password.

| File                 | Where it comes from                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baikal-digest.json` | **Baïkal 0.10.1** with Digest, the interop run's container (`packages/sync/test/interop/`), recorded 2026-11-04: its user `astro` is `user` here          |
| `xandikos.json`      | **Xandikos 0.4.10**, the interop run's container, recorded 2026-11-04, with its default calendar (`--defaults`)                                           |
| `davical.json`       | **DAViCal** (`tuxnvape/davical-standalone`, the compose file's digest), the interop run's container, recorded 2026-11-04: its user `admin` is `user` here |

A cloud service joins this table when its test account is recorded; until
then it is not offered by name (providers D250).
