# Grilling: foundation — 2026-10-31

The owner and an agent walked AstroTime's design tree before any code. Each
question came with a recommended answer; the owner accepted, changed or
widened it. The resulting decisions live in
[`../plans/foundation.md`](../plans/foundation.md); this page records how
they were reached, so the reasons survive.

## The brief

The market has no good-looking client that works with calendars and tasks
together. Nextcloud can be the backend, but its clients do either calendar
or tasks, never both, and the alternatives are closed and cannot connect to
your own services. AstroTime is one place to see events and tasks, borrowing
logic from Google Calendar, Google Tasks and open-source clients. It must run
on the phone, on Linux, possibly Windows, and on the web; TypeScript, with
Jhin's stack and Caspian Logistics' and Jhin's ways of documenting and
working.

## Round 1

| #   | Question                 | Answer                                                                                                                                                      | Decision |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Q1  | Repository               | `Astroreen/AstroTime`, public, pushed from here                                                                                                             | D30      |
| Q2  | License                  | AGPL-3.0                                                                                                                                                    | D29      |
| Q3  | Protocol                 | generic CalDAV + iCalendar, Nextcloud as the main target                                                                                                    | D2       |
| Q4  | Google                   | after the MVP, behind a provider interface                                                                                                                  | D4       |
| Q5  | Offline                  | offline-first, the local store is the source of truth                                                                                                       | D5       |
| Q6  | Phone's system calendars | after the MVP, read-only first                                                                                                                              | D4       |
| Q7  | Tasks on the calendar    | **changed:** Google's layout — all-day strip pinned on top, timed items on the time grid, drag to move, click to edit; the overlap layout left to the agent | D14, D16 |
| Q8  | Task features            | **widened:** the whole VTODO protocol, so later work only extends the UI                                                                                    | D7, D10  |
| Q9  | Event features           | CRUD, all-day/timed, recurrence with exceptions, time zones, reminders; attendees shown only                                                                | D9       |
| Q10 | Views                    | Day, Week, Month, Agenda                                                                                                                                    | D13      |
| Q11 | Own backend              | none; pure client                                                                                                                                           | D3       |
| Q12 | Platform order           | **changed:** web first (design is reviewed in a browser preview), then Android; iOS and macOS out of scope; Windows last if at all                          | D12      |

## Round 2

Asked after reading Jhin and Caspian Logistics.

| #   | Question        | Answer                                                                                                                                                                                                              | Decision |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Q13 | Mobile shell    | Capacitor; Electron for desktop; one React UI                                                                                                                                                                       | D22      |
| Q14 | Monorepo layout | Jhin's layout without plugins; an isomorphic core                                                                                                                                                                   | D23, D24 |
| Q15 | Docs            | Jhin's context library, plus Caspian's dated grilling sessions                                                                                                                                                      | D26      |
| Q16 | CI/CD           | Jhin's CI, Claude review, Dependabot, tag releases incl. an Android APK                                                                                                                                             | D27, D28 |
| Q17 | Local store     | SQLite everywhere through Drizzle                                                                                                                                                                                   | D25      |
| Q18 | CORS on the web | the owner did not know CORS and pointed at app passwords; the agent explained that an app password is authentication, while CORS is a browser-only restriction Nextcloud does not lift for CalDAV — resolved in Q19 | D20      |

## Round 3

| #   | Question                        | Answer                                                                                                            | Decision |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| Q19 | CORS                            | Vite proxy in development; one Docker image (static app + stateless `/dav` proxy with an allowlist) in production | D20      |
| Q20 | Overlap layout                  | cascade by start and length; equal columns past three or four at once                                             | D15      |
| Q21 | Tasks on the time grid          | chip at `DUE`, block for `DTSTART`+`DUE`, date-only in the all-day strip, undated in the panel, completed dimmed  | D16      |
| Q22 | "Whole protocol" for events too | parse and keep everything, lossless; the UI grows                                                                 | D7       |
| Q23 | iCalendar library               | `ical.js`, wrapped                                                                                                | D8       |
| Q24 | Editing an occurrence           | "This / This and following / All"                                                                                 | D11      |
| Q25 | Conflicts                       | merge by field; same field → server wins, ours to the Conflicts list                                              | D6       |
| Q26 | Signing in                      | Nextcloud Login Flow v2 and any CalDAV server via `.well-known`                                                   | D19      |
| Q27 | Languages                       | English and Russian from day one                                                                                  | D17      |
| Q28 | Real-server tests               | Radicale on every PR, Nextcloud nightly                                                                           | D27      |

## Round 4

| #   | Question          | Answer                                                                               | Decision |
| --- | ----------------- | ------------------------------------------------------------------------------------ | -------- |
| Q29 | Protecting `main` | required `CI`, no direct or force pushes; the first commit goes in before protection | D30      |
| Q30 | Claude's secret   | the owner adds `CLAUDE_CODE_OAUTH_TOKEN` and asked for the exact commands            | D27      |
| Q31 | The first step    | repository, skeleton, docs, CI in one PR; no features yet                            | PR 1     |

## Round 5

The design questions, asked once the backend had landed. The plan also
added D53 (settings in the drawer, search) to make D44–D46 buildable.

| #   | Question             | Answer                                                                                       | Decision       |
| --- | -------------------- | -------------------------------------------------------------------------------------------- | -------------- |
| Q32 | Style                | Google's density, a calm look of our own                                                     | design D43     |
| Q33 | Themes               | dark and light, by the system setting                                                        | design D44     |
| Q34 | Week start and clock | by locale, overridable                                                                       | design D45     |
| Q35 | Screen layout        | **answered with screenshots** of Google Calendar and Tasks on Android: that layout, as it is | design D46–D52 |
| Q36 | Item colour          | the calendar's, or the item's own `COLOR`                                                    | design D47     |

## Left open on purpose

- The i18n library, chosen in PR 5 (D17). _Chosen in PR 5a:_ i18next, see
  [D17](../plans/foundation.md#D17).
