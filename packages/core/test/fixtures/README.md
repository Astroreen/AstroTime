# Fixtures

iCalendar as each client writes it, for the round-trip and occurrence tests
(`../calendar-object.test.ts`, `../occurrences.test.ts`; every `.ics` here
must parse and serialize back with every property kept, D7). The files are
kept byte for byte (`*.ics -text` in `.gitattributes`).

| Files                    | Where they come from                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `radicale-*.ics`         | objects as Radicale serves them back (PR 4)                                                                                                                                                        |
| `nextcloud-served-*.ics` | objects as Nextcloud serves them back after another client wrote them (PR 4)                                                                                                                       |
| `nextcloud-web-*.ics`    | written by Nextcloud's own web Calendar and Tasks apps, driven in a browser, then fetched over CalDAV ([`scripts/record-nextcloud-fixtures.ts`](../../../../scripts/record-nextcloud-fixtures.ts)) |
| the others               | written by hand in the shape each client writes (PR 2, `docs/plans/foundation.md#pr-2--icalendar-core`)                                                                                            |

## `nextcloud-web-*.ics`

Recorded on 2026-11-01 from **Nextcloud 31.0.14** (`nextcloud:31-apache`)
with **Calendar 5.5.24** and **Tasks 0.18.1**, in Chromium set to
`Europe/Vilnius` and `en-US`.

| File                                         | Made in the web UI as                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `nextcloud-web-event-timed.ics`              | a timed event with a location, a description and a category                   |
| `nextcloud-web-event-allday.ics`             | a one-day all-day event                                                       |
| `nextcloud-web-event-multiday.ics`           | a three-day all-day event                                                     |
| `nextcloud-web-event-reminder.ics`           | a timed event with a reminder 15 minutes before                               |
| `nextcloud-web-event-recurring.ics`          | weekly, six times; the second occurrence moved and renamed, the third deleted |
| `nextcloud-web-task-due.ics`                 | a task with a due date and time                                               |
| `nextcloud-web-task-start-due.ics`           | a task with a start and a due date and time                                   |
| `nextcloud-web-task-completed.ics`           | a task due on a date (all day), then completed                                |
| `nextcloud-web-task-subtask.ics`             | a subtask, added from its parent's menu                                       |
| `nextcloud-web-task-priority-categories.ics` | a task with high priority and two tags                                        |

Nothing is normalised: UIDs, `DTSTAMP`, `CREATED` and `LAST-MODIFIED` are as
recorded, and the Calendar app's files end without a final line break, as the
server serves them. To keep the dates stable, the browser's clock starts at
2026-11-02 07:00 UTC, so those timestamps fall on that morning and the items
on fixed days whenever the script runs. The script refuses a recording that
names the test server.

### Recording them again

With docker and the dev shell's Chromium:

    node scripts/record-nextcloud-fixtures.ts

It starts a disposable Nextcloud with PostgreSQL in Docker on
`127.0.0.1:18090` (`ASTROTIME_RECORD_PORT`; on SQLite the Tasks app's writes
fail with "database is locked"), installs the Calendar and Tasks apps from the
app store, records every file above, prints the versions it ran, and removes
the containers (`ASTROTIME_RECORD_KEEP=1` leaves them running to look at).
`ASTROTIME_RECORD_IMAGE` picks another Nextcloud image. Update the versions
here, and check the diff: new UIDs and timestamps are expected, anything else
is a change in what Nextcloud writes.
