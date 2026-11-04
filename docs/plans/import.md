# Import plan

Status: **in progress** — the formats, their order and the flow are
decided; the splitter (PR I1) and the import flow for iCalendar, jCal and
ZIP (PR I2) are built. This plan owns reading calendars
and tasks from files into AstroTime, and writing them out again. It builds
on foundation's [D5](foundation.md#D5) (the store is the UI's truth, only
the sync engine talks to servers), [D7](foundation.md#D7) (nothing lost),
[D37](foundation.md#D37) (what the user may do in a calendar),
[D122](foundation.md#D122) (the calendar on this device) and
[D145](foundation.md#D145) (the first load's budget), and on the
providers plan's [D251](providers.md#D251) (subscriptions), which shares
its splitter. Its decisions are D265–D274.

## Goal

The owner: "In the app's settings, make it possible to import calendars
and tasks from files. There is some special format for it, I think. But
the more formats we support, the better."

So: whatever file another calendar or task app gave the user, AstroTime
reads it on the device, shows what is in it, and puts it in the calendar
or list the user picks, as if made here; the sync uploads it as usual.
Nothing in the file is lost on the way, and what a converted format could
not carry is said, not dropped in silence.

## Decisions

- **D265. Import is in Settings, and reads on the device.** Settings gets
  a "Data" group with "Import from a file" (and, with [D274](#D274),
  "Export"). The file is picked as the edit dialog picks one from the
  device (design [D233](design.md#D233), foundation
  [D232](foundation.md#D232): an `<input type="file">`, which opens the
  system's picker on Android and the file dialog on the desktop), read in
  the page, and goes nowhere but into the store: no server sees it but the
  user's own, through the sync, once imported. A file over 64 MiB is refused before
  it is read (its text is held whole while it is split); a ZIP is read to
  1000 files and 64 MiB in all, no file inflating past its stated size or
  1000 times its own, so a ZIP bomb costs nothing: what is past a limit is
  named as unread, and so is an entry whose own header is not where the
  archive's directory says, or names another file or method.

- **D266. The formats, and the order they come in.** Surveyed on
  2026-11-04 from each format's specification and each exporter's
  documentation:

  | Format                              | Who writes it                                                                                                                                       | Carries                                    | When                  |
  | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------- |
  | iCalendar `.ics` (RFC 5545)         | every calendar app's export: Google Calendar, Nextcloud, Apple Calendar, Thunderbird, Outlook ("Save calendar"), Proton, Fastmail, Radicale's `GET` | events, tasks, series, alarms, time zones  | I2                    |
  | jCal `.json` (RFC 7265)             | CalDAV servers on request, a few web apps                                                                                                           | as iCalendar, spelt in JSON                | I2 (ical.js reads it) |
  | ZIP of the above                    | Google Calendar's "Export" (one `.ics` per calendar), Google Takeout                                                                                | many calendars at once                     | I2                    |
  | vCalendar 1.0 `.vcs`                | older phones (Samsung, Nokia, Sony), Outlook's "vCalendar format"                                                                                   | events, tasks; a rule syntax of its own    | I3                    |
  | CSV, Outlook's columns              | Outlook's "Export to a file" (calendar and tasks), Thunderbird's CSV export (the same columns)                                                      | events or tasks, no series, local times    | I4                    |
  | CSV, Google's columns               | the layout Google Calendar's own import documents (`Subject`, `Start Date`, …), which spreadsheets are made in                                      | events, no series                          | I4                    |
  | Google Takeout Tasks (`Tasks.json`) | Google Takeout                                                                                                                                      | task lists, subtasks, due dates, done      | I5                    |
  | xCal (RFC 6321)                     | no common exporter found                                                                                                                            | as iCalendar, spelt in XML                 | [Deferred](#deferred) |
  | Todoist CSV                         | Todoist's project template export                                                                                                                   | tasks; dates as free English ("every day") | [Deferred](#deferred) |
  | Microsoft To Do, Apple Reminders    | no export file at all; their tasks reach a file through Outlook's CSV, or sync over CalDAV (providers plan)                                         | —                                          | not a format          |

  iCalendar first: every app exports it, and it carries everything
  AstroTime keeps. Then what older and non-calendar tools leave people
  with, by how many people have such a file.

- **D267. One file, many objects: the splitter.** `splitCalendars`
  (`@astrotime/core/split`) cuts a file into calendar objects, one per
  UID: a series with its exceptions wherever they stand in the file, with
  the `VTIMEZONE`s its times name and no others, and every property of the
  file's calendar but `METHOD` (a calendar object resource has none, RFC
  4791 §4.1). Each component is read on its own, so one value ical.js
  refuses costs that component, not the file, and one whose `END` never
  came ends where the next component begins or the calendar ends, so it
  never takes the rest of the file with it; what it said is kept when it
  reads whole, and named either way (one cut by the file's end is not
  kept: its last line may be cut too). An `END` with no `BEGIN` is named
  as one and left out. It forgives what exporters
  get wrong: a byte order mark, LF or CR line ends, blank lines, several
  `VCALENDAR`s one after another, a file cut short (what came whole is
  kept), a component with no UID (it gets one). Any line that starts as a content
  line (a name of letters, digits and "-", in any case, then ";" or ":",
  RFC 5545 §3.1) is a property, one AstroTime knows or not, and kept
  ([D7](foundation.md#D7)); a line that does not ("PIN 1234", "Dial in:
  555 0100") after a text value (`DESCRIPTION`, `SUMMARY`, `LOCATION`,
  `COMMENT`, `CONTACT`, `RESOURCES`, an `X-` property) is that value broken
  without folding, joined as the line break it meant; anywhere else it is
  a stray line, left out; both are named. A content line after a text
  value whose name iCalendar does not have ("Meeting-ID:123") may be that
  value's: it is kept as the property it reads as, and named. The
  same component twice under one UID (Google's and Outlook's exports do
  it) is kept once; a second, different master, or a component of another
  kind under a UID taken, is kept as an object of its own under a new UID
  (`<UID>-2`, or the next suffix no UID of the file has, where the caller
  gives none, so a subscription's stays the same on every run); a series'
  exceptions stay with its first master, and an exception of another kind
  goes with the object of its kind that left the UID; a component given
  again is kept once, wherever its first went. An object that cannot be
  read loses only the components that cannot be read alone (an exception
  with a broken `RECURRENCE-ID`), each named; its series and its other
  exceptions are kept. Objects come in the order of their first component
  in the file.
  Nothing is dropped unnamed: what cannot be kept (no UID where none can
  be given, unreadable, never ended) is a problem with its place in the
  file, and so is what was kept but changed. A `VTIMEZONE` that cannot be
  read is named, and the objects naming it go without it: a definition
  ical.js cannot read cannot be stored either, and the time model reads
  the TZID ([D32](foundation.md#D32)); a missing one likewise. A TZID
  defined twice, differently, in one calendar: every object takes the
  first definition, the same on every run, and the second is named. A calendar
  property that cannot be read is named and left out, the others kept.
  `splitCalendar`, the same with a strict outer shape
  (exactly one whole `VCALENDAR`, else `NotCalendarError`), is D251's.
  Text is decoded as UTF-8 (UTF-16 by its byte order mark); a file that
  is not UTF-8 is read in the charset it names (vCalendar's `CHARSET`),
  else Windows-1251 when the user speaks Russian and Windows-1252
  otherwise, and the preview says the encoding was guessed.

- **D268. What the file holds, before anything is written.** The import
  dialog shows each source of the file (a `VCALENDAR`, a CSV, a Takeout
  task list) with its name (the file's, else the file name), how many
  events and tasks it has, the days they span, and its problems in words,
  counted by kind, with the first few named. Components AstroTime does not
  keep (`VJOURNAL`, `VFREEBUSY`) are counted as not imported.

- **D269. Where each source goes.** Per source, its events go to one
  calendar and its tasks to one list (the same one when it takes both):
  any calendar the user may create in ([D37](foundation.md#D37)) that
  holds that kind, or a **new calendar on this device** named after the
  source, with the source's colour. The first offered is a calendar of
  the same name if one exists, else the one new items go to. A new
  calendar on a server account needs `MKCALENDAR`, which no provider has
  yet: [Deferred](#deferred).

- **D270. The same UID already there.** In the target calendar, an object
  with the same UID that is the same item ([`sameObjects`](foundation.md#D107))
  is skipped, silently counted. One that differs is a duplicate: the
  dialog asks once for all of them, "Update them", "Import as copies" (a
  new UID, the series with its exceptions) or "Skip them"; none is chosen
  for the user. An update lays the file's object over the stored one
  (`overlay`): the file says what the item is, every property and
  component iCalendar names (its start and its `DTEND` or `DURATION`,
  its rule and `EXDATE`s, its exceptions, its guests), and what it leaves
  out is gone; the stored copy gives only what a file from another app
  cannot know ([D7](foundation.md#D7)): its `X-` properties the file does
  not have, and its alarms and its attachments when the file has none of
  them. An item deleted here whose deletion has not reached the server
  yet is not there as the user sees it, so it is not asked about: the
  file brings it back, as a change of it (the store revives it by UID,
  [foundation D38](foundation.md#D38)). Copies made in one run name each other: a copied
  subtask's `RELATED-TO` names its copied parent.

- **D271. Written through the store, in batches.** The objects become
  local changes (`changeLocal`, pending creates or updates), as an edit
  made here would, so the sync uploads them ([D5](foundation.md#D5)); on
  the calendar on this device they are final ([D122](foundation.md#D122)).
  200 objects a transaction, the page given back between batches, the
  progress shown as a count; "Stop" ends it after the batch in flight, and
  what landed stays, the dialog says how much. A sync is asked for once,
  at the end. One import runs at a time: a second tap on "Import" or on an
  answer before the first came back does nothing, and a run writes a UID
  to a calendar once (the same UID in two sources or two files of a ZIP is
  counted as given twice). A write that fails ends the run: the batch is
  one transaction, so what landed before stays and is counted, and the
  error is said. A calendar made for the import that got nothing (stopped
  or failed before its first write) is removed again, and so are those
  made before one that could not be made.

- **D272. Nothing lost, and what a conversion cannot carry, said.** An
  iCalendar or jCal object is stored as the file wrote it
  ([D7](foundation.md#D7)), `METHOD` aside. A converted format (vCalendar,
  CSV, Takeout) maps each field it has a home for; what has none (a CSV
  column such as Outlook's "Mileage", a vCalendar 1.0 rule iCalendar
  cannot say) is named in the preview as not imported, never written as
  something it is not.

- **D273. It weighs nothing until it is opened.** Settings' entry is a
  line in Settings' chunk; the import dialog is a chunk of its own, loaded
  when it is first opened ([D145](foundation.md#D145)); each converter
  (vCalendar, CSV, Takeout, ZIP) a chunk of its own, loaded for its
  format; the splitter loads with the dialog (and with a subscription's
  sync), never with the app, importing the core modules it needs and not
  the package's index. The strings load with the dialog. The first load
  grows by nothing.

- **D274. Export: a calendar or list as one `.ics`.** "Export" in the same
  group writes a calendar's objects, as stored, into one `VCALENDAR` as
  Nextcloud's export does (each `VTIMEZONE` once, `X-WR-CALNAME` and the
  colour), saved with `Platform.saveFile` where the platform saves files
  and as a download elsewhere. Built last (I6), as it is cheap once import
  exists.

## Deferred

- **New calendars on a server account** (D269): `MKCALENDAR` for CalDAV,
  each provider's own call for the others; import offers existing
  calendars and new ones on this device until then.
- **xCal (RFC 6321)** (D266): no exporter people use writes it; it would
  need an XML reader in the import chunk. Comes when a user has such a
  file.
- **Todoist's CSV** (D266): its dates are free English ("every other
  Monday", "tomorrow at 5pm"), which needs Todoist's own grammar to read;
  titles and subtasks alone would import tasks without their dates.
  Revisit if Todoist documents a dated export.

## PR plan

### PR I1 — This plan and the splitter

D265–D274 written here; `splitCalendar` and `splitCalendars`
(`@astrotime/core/split`), with exports recorded from Radicale and made in
each exporter's shape. D267.

Done when: every export in `packages/core/test/fixtures/exports/` splits
into objects that hold every component of the file unchanged, a series'
exceptions with it, only the zones each uses, byte for byte the same on
every run; the broken files (byte order mark, LF and CR, blank lines, a
broken fold, a cut file, no UID, two masters, mixed kinds, a value ical.js
refuses, ten thousand events) behave as D267 says; HTML, empty, cut and
doubled texts throw for `splitCalendar`; nothing on the first load imports
it.

### PR I2 — The import flow, iCalendar and jCal

The "Data" group, the import dialog, the preview, the targets, the
duplicates, the batches, `.ics`, `.json` (jCal) and `.zip`. D265, D268–D271,
D273.

Done when: e2e on a phone and a wide screen, English and Russian, imports
a file with events, tasks, a series and a duplicate into a calendar and a
new one on this device, stops one in the middle, and sees the items in the
views; the first load grows by at most 0.1 KiB.

### PR I3 — vCalendar 1.0

### PR I4 — CSV (Outlook's and Google's columns)

### PR I5 — Google Takeout Tasks

### PR I6 — Export

Each converter's PR: its recorded or documented sample files, what maps
and what is said as not imported (D272), its own chunk (D273).
