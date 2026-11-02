# Fixtures

A calendar home's `PROPFIND` answers (`Depth: 1`, the props
`CalDavProvider.calendars` asks for), for the privilege tests
(`../privileges.test.ts`, docs/plans/foundation.md#D37); and folders of a
user's Nextcloud files, for the files tests (`../files.test.ts`,
docs/plans/foundation.md#D231). Kept byte for byte, but where said.

| File                           | Where it comes from                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nextcloud-owner.xml`          | **Nextcloud 31.0.14** (`nextcloud:31-apache`), recorded 2026-11-01: the home of user `astro`, who owns `personal`, `shared-ro` and `shared-rw`                                                                                                                                                                      |
| `nextcloud-shares.xml`         | the same server, the home of a second user `reader`: its own `personal`, `shared-ro` shared to it read-only and `shared-rw` read-write (shared with Nextcloud's `<oc:share>` request on the calendar, as its web Calendar does)                                                                                     |
| `radicale.xml`                 | **Radicale 3.8.0**, recorded 2026-11-01: the home of `astro` with `personal` (rights `rw`) and `readonly` (rights `r`, Radicale's `from_file` rights)                                                                                                                                                               |
| `write-content-only.xml`       | **written by hand**, in Nextcloud's shape: no server at hand grants these. A calendar with `write-content` and no `bind`/`unbind` (RFC 3744 lets a server grant each alone), one with `bind` and no `unbind`, one with only CalDAV's `read-free-busy`, and one whose privilege set the server does not report (404) |
| `nextcloud-files-root.xml`     | **Nextcloud 34.0.5**, recorded 2026-11-02 from the test user `astrotime-test` (the props `nextcloudFiles` asks for): the top of its files, with Nextcloud's skeleton files and a folder shared to it, renamed `Общее` here for its owner's privacy (its href only; nothing else changed)                            |
| `nextcloud-files-calendar.xml` | the same server and user: its `/Calendar` folder, made for the recording with one 17-byte text file in it, both deleted afterwards                                                                                                                                                                                  |
