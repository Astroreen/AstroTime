# Design plan

Status: **in progress** — PR 5 of
[`foundation.md`](foundation.md#pr-5--calendar-grid) builds it; PR 5a-1
built the shell, both themes and the Day, 3-day and Week views; PR 5a-2 the
Month and Agenda views; PR 5b the tasks screen, the drawer's settings and
search. This plan
owns how AstroTime looks and is laid out (foundation's
[D18](foundation.md#D18)); where items go is the layout engine's
([D42](foundation.md#D42)).

## Goal

The owner's reference is **Google Calendar and Google Tasks on Android**, in
their dark theme: the screenshots the owner sent are the brief, described in
[`../design/README.md`](../design/README.md). AstroTime looks and behaves like them closely enough that a
Google Calendar user is at home, with its own calm palette rather than a
copy of Google's brand.

## Decisions

Decisions here are numbered on from foundation's, so a `D<n>` is unique in
the project.

### From the owner (grilling round 5)

- **D43. Google's density, a calm look of our own.** As dense as Google
  Calendar: many items readable at once, small radii, little chrome. Colours,
  type and icons are AstroTime's own, not Google's brand.
- **D44. Dark and light themes from the first screen**, following the system
  setting. Dark is designed first (the reference is dark). _Added by the
  agent, beyond the owner's answer:_ a manual override in the
  settings (D53), as Google Calendar has.
- **D45. Week start and clock from the locale**, overridable in settings:
  for Russian (and Lithuanian) Monday and 24 hours.
- **D46. The layout is Google Calendar's on Android** (the owner answered
  with the reference screenshots):
  - a top bar: the menu button (opens the drawer), the month and year as a
    button that opens a month picker, search, "today", the tasks toggle, the
    account;
  - a drawer with the views, the accounts and their calendars (each with its
    colour and a visibility checkbox), and settings;
  - the view below the bar; a floating "+" button bottom right creates an
    event or a task;
  - on a wide screen (desktop, a wide browser window) the drawer stays open
    as a sidebar, as Google Calendar's web app does; nothing else changes.
  - _Changed by the UI review ([D131](#D131)–[D133](#D133)):_ settings left
    the drawer for a Settings screen of their own; on a wide screen Create
    heads the sidebar instead of floating, and the top bar takes Google's
    web order.
- **D47. An item's colour is its calendar's**, as the server gives it
  (Apple's `calendar-color` property, which `CalDavProvider` reads into
  `RemoteCalendar.color`), unless the item has its own RFC 7986 `COLOR`.
  It is drawn darkened where white text needs it ([D120](#D120)): a pale
  colour is drawn visibly darker, a yellow such as `#f6bf26` as a dark
  olive, a pale cyan as a slate teal, as Google's own palette is dark
  enough for white. The colour itself, stored and written back, stays the
  server's. _Since [D172](#D172):_ a default colour other than the calendar's
  is a new item's own `COLOR`.

### Read from the reference

- **D48. Views: Day, 3 days, Week, Month, Agenda.** The reference uses the
  3-day view, so it joins the MVP (foundation's D13 deferred it; D13 is
  updated). Year stays deferred.
- **D49. The time grid is a grid of tiles.** Each hour of each day is a
  dark tile with rounded corners and a small gap between tiles; hour labels
  sit on the left, on the line between hours. Week numbers sit left of the
  day headers (week view, a pill per week in the month view). Today's date is
  a filled circle in the accent colour, its weekday in the accent too. A
  white line with a dot marks the current time across today.
- **D50. Items are rounded filled blocks** in their colour with the title
  in bold-ish text wrapping inside (over another's title, never:
  [D153](#D153)); an item drawn over another (D15) gets a
  thin outline in the background colour, so the edge between them shows.
  In the all-day strip, items are chips one line high. In the time grid a
  task is a chip as D42 sizes it (30 minutes tall, one line of text) at
  its start. _Changed in round 3 ([D159](#D159)): a task with a timed
  start and due was a block like an event._
- **D51. Tasks on the calendar.** A task's chip carries a check-circle icon;
  a completed task stays, struck through, in a muted colour. Undone tasks
  whose due (a date or a time, or the start of a task with no due,
  [D161](#D161)) is before the
  start of today, in the user's zone, collapse into one chip on today,
  "N undone tasks", which opens them; it shows only on today, in every view
  that has today, and the days they were due no longer show them. This is
  D16's roll-over, drawn as one chip, even for a single
  task (Google shows "1 undone task" too). It counts undone tasks only, so
  "hide completed" does not change it. A task with neither stays on the
  tasks screen only. A recurring task counts once, by its
  latest occurrence before today that is undone: an occurrence is done when
  its own exception (`RECURRENCE-ID`) says `STATUS:COMPLETED`, or when the
  series itself is completed (_done_ is completed or cancelled, as
  foundation's [D55](foundation.md#D55) reads it). In the Agenda view the chip heads
  today's group. D16's "hide
  completed" toggle stays, in the drawer, and hides completed tasks' chips on
  every view. When the all-day strip holds more than
  fits, it shows the first two rows and "+N", with a chevron that expands
  it in place (_since [D151](#D151):_ open, it stays open from period to
  period).
- **D52. The tasks screen is Google Tasks'.** The tasks toggle in the top
  bar opens it: a tab per task list (a VTODO calendar) with its count of
  undone tasks, and "+ New list"; under the tab, a card with the list's
  tasks (a circle to complete, a star), sort and menu buttons; below it,
  "Completed (N)" folded. On a wide screen it is a panel on the right of the
  calendar instead of a screen.
  Completing and starring are the only edits here: they write the task
  through the local store (`saveLocal`) and the sync engine uploads them
  (D5); editing dialogs and dragging are foundation's PR 6. _Since PR 6a:_
  a task opens its details, and each list has "Add a task" ([D109](#D109)). The star is
  stored as an AstroTime property (`X-ASTROTIME-STARRED:TRUE`),
  so the task's own `PRIORITY` is never touched and other clients keep it
  (AGENTS.md rule 2). _Built in PR 5b:_ what completing writes is
  [D94](#D94), the screen's details [D95](#D95).
- **D53. Settings in the drawer** (_since [D131](#D131): in a Settings
  screen of their own_): the theme (system, dark, light), the
  week start and the clock (D44, D45), and "hide completed" (D51). Search,
  in the top bar, finds items by title in the local store. _Built in
  PR 5b:_ the settings [D96](#D96), search [D97](#D97).

### Decided while building PR 5a

- **D58. The look is tokens in one stylesheet** (`packages/ui/src/styles.css`).
  Colours are CSS custom properties written with `light-dark()`; the root's
  `color-scheme` follows the system, and `data-theme="light"` or `"dark"` on
  the root element overrides it, so D53's setting only sets that attribute.
  An item's text is white, as the reference's, on its colour darkened as
  far as white needs (CSS relative colours), so any calendar colour reads
  (D47; the rule is [D120](#D120)'s, which replaced black or white text by
  OKLCH lightness); a done task's fill is its colour mixed 45% into the
  grid's, darkened the same way. Fonts are the system's and the
  icons AstroTime's own SVG, so nothing loads from another origin (D43). An
  hour is 56 px tall; from 1024 px wide the drawer is a sidebar (D46).
- **D59. Details read from the reference for the time grid:**
  - the top bar names the month, both months across a change of month
    ("October – November"), and the year only when it is not this one; prev
    and next buttons sit in it on a wide screen, a horizontal swipe moves on
    a touch screen ([D152](#D152)), and `n`/`j`, `p`/`k` and `t` move on a keyboard; search,
    the tasks toggle (5b) and the account (5a-3) join it with their screens;
  - the week number is ISO's, of the week the first day belongs to in the
    locale's weeks (the reference's 3 days from Sunday, November 1 show 44);
  - the strip folds when it needs more than three rows: two rows, then "+N"
    per day; "+N" and the chevron expand the whole strip in place;
  - the "N undone tasks" chip sits where a one-day task titled first would:
    after longer spans and one-day events, before the day's tasks, as in the
    reference (D51);
  - on open the grid shows two hours before now on today, else the morning;
  - the UI speaks the first of the user's languages it knows; the week start
    and the clock come from the region of their first language, so
    Lithuanian (`lt-LT`) gets English, Monday and 24 hours (D45);
  - the time grid is the wall clock: on the day a clock changes for DST the
    day is still 24 tiles, and the current-time line, like the items, is
    placed by the minutes the wall clock shows, not by the minutes elapsed
    since midnight.
  - a tab left open overnight moves an anchor on today to the new today at
    midnight; an anchor the user moved elsewhere stays.
  - a period is drawn once its items are read (`useEntries`' result names
    the range it read): on open the view draws nothing until then, and
    moving to another period or view keeps the one drawn until the next
    one's items are read, so its all-day items and task chips never
    arrive under a press and push the time grid down (about 70 px in the
    demo). The top bar names the new period at once; the Agenda reads its
    own days ([D87](#D87)), and after it the next view draws once read
    anew, not from the read kept from before it, even of the same days. A
    read that fails, of the items or of the calendars, ends the wait: the
    period is drawn empty (an error in the console), so the view never
    stays on the last period or blank.
- **D86. The Month view, read from the reference** (and from Google's
  Android app where the reference is silent):
  - six weeks from the week holding the month's first day, as the reference
    and the month picker show them; the weekday names above, today's in the
    accent; the week number (D59's) in a pill column on the left;
  - each day a tile with its number on top, today's in an accent pill; the
    days of the months around are dimmed (a fainter tile and number), their
    items shown as they are;
  - every item is a one-line chip in its colour, cut short without an
    ellipsis as in the reference: a task with its check-circle, a done one
    struck through and muted (D50, D51). An item over several days, a timed
    one over midnight too, is a span over the days of the week it covers.
    A week's rows are `layoutSpans` with `timed`: the strip's order first
    (spans, one-day events, the undone tasks chip on today where D59 puts
    it, tasks), then timed items in time order;
  - a tile shows as many rows as its height fits; a day with more gives its
    last row to "+N" (its hidden items; read out as "N more items on …",
    plural-aware), and only that day folds, other days keep their rows
    (`foldWeek`);
  - a tap on a day, anywhere on its tile or on the part of a span over it,
    or on its "+N", opens that day in the Day view, as Google's Android app
    does (its web app opens a popover instead); items open with PR 6.
    _Changed in PR 6a:_ a tap on an item, a span over several days too,
    opens its details ([D108](#D108)); the rest of the tile still opens the
    day. _Changed since:_ on a touch screen with no mouse or pen
    (`any-pointer: fine` does not match: a phone, a tablet) a tap anywhere
    on a tile opens its day, on an item, "+N" or the undone chip too, as
    Google's Android app does: there the chips are no buttons, so the
    tile (on a phone some 50 × 136 px) is the target, not a 16 px chip
    ([D119](#D119)). A long press still drags an item ([D111](#D111)),
    and its details open from the day, where every item is a button. A
    device with a mouse, a trackpad or a pen, a touch laptop too, keeps
    the chips as buttons that open their details, as before. The day's
    number is a button named by the date and how many items the day has
    ("Thursday, November 5, 4 items"; the date alone on an empty day),
    and "+N"'s name begins with what it shows ("+6 more items on …");
  - previous and next (buttons, keys, a swipe) go to the first day of the
    month before or after; the top bar names the month (D59).
- **D87. The Agenda**:
  - the days in order, each with its weekday and date on the left (today's
    in the accent, as the time grid's headers), which stay in view while
    the day's items scroll, and a month's name above its first day;
  - each item a card filled in its colour (D50): the title, and under it
    "All day", "Day 2 of 3" for an all-day item over several days, or its
    time (with the dates when it ends on another day); a task with its
    check-circle, a done one struck through and muted (D51);
  - a day's all-day items come in the strip's order, then its timed ones in
    time order (`layoutDay`); an item over several days, a timed one over
    midnight too, is listed on each day it covers. Days with nothing are
    left out, except today, which is always there ("Nothing planned today"),
    so the list has a today to open at; the "N undone tasks" chip heads
    today's group (D51);
  - it opens with the anchor (today, unless the user moved) at the top,
    having read four weeks before it and eight after; within a screen of
    either end it reads four weeks earlier or eight later, keeping the day
    on top where it was. It reads on its own up to a year from where it
    opened; "Show earlier" and "Show later" at its ends go further. So a
    calendar is never read whole; what was read stays while the view is open;
  - the top bar names the month of the day at the top of the list, and that
    day becomes the anchor, so another view opens there; previous and next
    go to the first day of the month before or after, "today" back to today.
    No swipe: the list scrolls.
- **D88. Keys for the views**, Google Calendar's: `d` Day, `x` 3 days (its
  custom view's key), `w` Week, `m` Month, `a` Agenda, beside D59's `n`/`j`,
  `p`/`k` and `t`.

### Decided while building PR 5b

- **D94. Completing and starring write what Nextcloud Tasks writes, and
  nothing else** (`completeTask`, `starTask` in `@astrotime/core`).
  Completing sets `STATUS:COMPLETED`, `COMPLETED` (now, in UTC) and
  `PERCENT-COMPLETE:100`; un-completing sets `STATUS:NEEDS-ACTION`,
  removes `COMPLETED` and sets `PERCENT-COMPLETE:0`, as Nextcloud Tasks
  does (the percentage before completion is not kept there either).
  Starring adds `X-ASTROTIME-STARRED:TRUE`; unstarring removes it. Each
  also sets `LAST-MODIFIED` and `DTSTAMP` to now (RFC 5545 §3.8.7.2,
  §3.8.7.3); `SEQUENCE` and `PRIORITY` are never touched, and every other
  line is written back byte for byte. One occurrence of a series is
  completed in its own exception (`RECURRENCE-ID`): a copy of the master
  without its recurrence, at the occurrence's time, made the first time
  and changed in place after; the series itself is not changed. D51
  already reads such an exception as a done occurrence. The edit goes
  through `Store.saveLocal` as a pending update (foundation
  [D5](foundation.md#D5)).
- **D95. The tasks screen, in detail** (D52):
  - a task list is a calendar whose components include `VTODO`; lists are
    in their names' order, and the tasks screen shows every list, whatever
    the drawer hides from the views;
  - a tab's count of undone tasks shows on the other tabs, not the open one,
    as in the reference; each tab's accessible name always has it;
  - the card's sort button offers my order (`X-APPLE-SORT-ORDER`, else the
    creation time, as Nextcloud Tasks reads a task without one), date (by
    due, undated last) and starred first; one order for every list, kept on
    this device;
  - a subtask sits under its parent (`RELATED-TO`), indented, while both
    are undone; "Completed (N)" lists completed tasks flat, the most
    recently completed first, folded until opened;
  - a task shows its due as "Today", "Tomorrow", "Yesterday" or a date, in
    the danger colour when overdue, with a mark when it repeats;
  - a series shows once, by its earliest occurrence that is not done, as
    Google Tasks shows a repeating task's current instance; completing it
    (D94) brings the next one, and a series with every occurrence done is
    completed;
  - a list's tasks can be completed or starred only where it allows edits,
    and "Add a task" shows only where it takes new items
    ([foundation D37](foundation.md#D37));
  - "+ New list" and the card's menu are drawn but disabled until lists can
    be made and changed ([Deferred](#deferred)); the "+" button is the
    calendar's, disabled until PR 6 (_since PR 6a_ it makes a task in the
    list shown, [D109](#D109));
  - on a phone the screen covers the calendar, with a back arrow; from
    1024 px it is a 360 px panel right of the view, its toggle pressed.
- **D96. The settings, in detail** (D53): one value in the app's
  preferences (`astrotime.settings`), read leniently (anything unknown is
  the default) and applied at once. The theme sets `data-theme` (D58) or
  removes it for the system's. A language chosen keeps the region of the
  user's first language for dates, so `ru-RU` choosing English gets
  English, Monday and 24 hours; the region's clock comes from
  `Intl.Locale`'s hour cycles, since `Intl.DateTimeFormat` falls back to
  the language's own for a pair it has no data for. The week starts on the
  region's day, Monday, Sunday or Saturday; the clock is the region's,
  12 or 24 hours. "Hide completed tasks" hides completed tasks' chips on
  every view, never the undone chip (D51). In the drawer each setting's
  name sits above its value, as Android's settings list them, so nothing
  is squeezed in the sidebar (_since [D131](#D131)_ the name sits on the
  left and its value on the right, in Settings). _Since:_ "Reminders", a switch, last
  ([foundation D101](foundation.md#D101)); after it, on the desktop only
  (the `Platform`'s `shell`), "Keep running when the window is closed",
  on unless turned off, with a line saying how to quit while it is on
  ([desktop D75](desktop.md#D75)). _Since [D169](#D169):_ "Show week
  numbers", after "Hide completed tasks". _Since [D172](#D172),
  [D173](#D173):_ the default colours and the user's own, in a "Colours"
  group.
- **D97. Search, in detail** (D53): `Store.search` finds the objects whose
  title holds the text, in the visible calendars, at most 50, the latest
  start first. Migration 6 adds a `titles` column: every component's
  `SUMMARY` lower-cased, decomposed (NFKD) and stripped of combining
  marks, so case and diacritics do not matter in any script (`é` finds
  `e`, `ё` finds `е`; `й` finds `и` too); the text searched is folded the
  same way and matched with `LIKE`, its `%` and `_` escaped. Rows written
  before migration 6 hold `NULL` and are parsed, as foundation
  [D55](foundation.md#D55)'s `done` is. A result shows by its next
  occurrence within a year, else its last, in time order, undated tasks
  last, with its colour and when it is. Choosing one closes the search: a
  dated item moves the calendar to its day and is outlined in the accent
  until the view moves on; an undated task opens the tasks screen on its
  list, outlined.

### Decided while building PR 6a

- **D108. The details and edit dialogs, as Google Calendar's**
  (foundation [D9](foundation.md#D9)–[D11](foundation.md#D11)):
  - a tap on any item, in any view, in the undone tasks' list, a search
    result or a task on the tasks screen, opens its **details**: the whole
    screen on a phone, a card from 640 px; its colour, title, when it is in
    the user's zone (and the zone it was set in, when another), how it
    repeats in words ("Every 2 weeks on Monday, Wednesday", "Каждые 2
    недели в понедельник, среду"), where, its description with its web and
    mail links opening in a new tab (`noopener`; nothing else is markup),
    its reminders in words ("15 minutes before", "1 day before at 9:00"
    for an all-day item), its guests with their answers and a note that
    AstroTime does not invite, its calendar. Each action shows only where
    the calendar's rights allow it ([foundation D37](foundation.md#D37),
    `rightsOf`, the one check every part of the UI asks): Edit, and a
    task's Complete and Star, with `edit`; Delete when a scope is left:
    one occurrence or the following ones are an edit of the series, all
    of them or an item that does not repeat a deletion (`delete`), as is
    the last exception of a series held without its master
    ([foundation D105](foundation.md#D105)). A
    calendar that allows neither says it is read-only. A search result moves the calendar to its day, as D97 says, and
    opens its details over it;
  - the **edit dialog**: the whole screen on a phone, a dialog from 640 px,
    the title and Save in its bar, closed by its ✕ or Escape, saved by
    Save or Enter in a one-line field. Creating, it starts with Event and
    Task to switch. The title; "All day"; the start and end dates (the
    browser's date field) and times (a list of every quarter of an hour in
    the user's clock, [D96](#D96), since the browser's time field keeps its
    own); a task's start, always, and its due, a field of its own
    ([D159](#D159); _until round 3 each had a switch_); the zone when it is
    not the user's; the repeat (does not repeat, every day, every week on
    the start's weekday, every weekday, every month on its day, on its nth
    weekday, every year, "Custom…": every n days, weeks, months or years,
    the weekdays, the month's day or weekday, and the end: never, on a day,
    after n times; another client's rule beyond these is kept as written
    until another is chosen); the reminders (before a timed item: at the
    start, 5, 10, 15, 30 minutes, 1 and 2 hours, 1 and 2 days, a week; for
    an all-day item: on the day, a day, two days and a week before, at
    9:00); the calendar, from those that hold the item's component and
    take new items, or for an existing item its own, and others only when
    its own lets it be deleted (a move is a creation there and a deletion
    here, [foundation D106](foundation.md#D106)); the colour, the calendar's or one of nine CSS names; the
    location; the description. A new start keeps the event's length, and a
    task's due as far after it ([D159](#D159)); a new start date moves its
    end, and the rule with it ([foundation D105](foundation.md#D105)). An end
    before the start, a due before the start or a repeat ending before the
    item is refused, in words;
  - **creating**: the "+" button makes an event on the day shown from the
    next half hour after now, an hour long (Google's prefill); a tap on an
    empty slot of the time grid makes one from that half hour, an hour long
    (a press dragged sizes it, [D111](#D111)); a tap on a Month
    tile's empty space keeps opening the day ([D86](#D86)), where Google's
    Android app creates on a long press ([Deferred](#deferred)). A new item
    goes in the first calendar that takes new items the views show;
  - **the scope dialog** asks "This occurrence / This and following
    occurrences / All occurrences" after Save or Delete on an occurrence of
    a series, the first chosen; "This and following" splits the series, a
    new item, so a calendar that takes none does not offer it, and an edit
    only a split could save (a new rule on a new day) says so instead; deleting an item that does not repeat asks
    "Delete this event?" first;
  - dialogs are labelled by their titles, hold the focus while open and
    give it back to what opened them.
- **D109. Tasks in the dialogs** (D52, foundation [D10](foundation.md#D10)):
  a task's details show its due ("Due Wednesday, November 4, 3:00 PM"),
  its parent and its subtasks' titles, with "Mark completed" (an
  occurrence of a series in its exception, as D94 completes it) and the
  star. _Until round 3 ([D162](#D162)):_ the details showed its status and
  progress, its priority and its tags, and the edit dialog added the
  status (not started, in progress, completed, cancelled), the priority as
  Nextcloud Tasks offers it (none; high, medium, low written as 1, 5, 9;
  read 1–4, 5, 6–9), the progress in percent and the tags, comma-separated
  (`CATEGORIES`). Each list on the tasks screen has "Add a task" at the top
  of its card, which makes a task in that list, as the tasks screen's "+"
  button does on a phone: on today, all day, since round 3
  ([D161](#D161)); it was undated.

### Decided while building PR 6b

- **D111. Dragging and resizing, as Google Calendar's** (foundation
  [D14](foundation.md#D14), [D16](foundation.md#D16); what a drop writes:
  foundation [D113](foundation.md#D113)):
  - **what drags**: every item of a calendar whose rights let it be edited
    (foundation [D37](foundation.md#D37)), in the time grid (a block, a
    task's chip), the all-day strip and the Month; a read-only calendar's
    items, the undone tasks chip and the Agenda's cards do not. A tap still
    opens the details (in the Month on a touch screen, the day: [D86](#D86));
  - **the press**: a mouse or a pen drags once it moves 4 px, so a click
    still opens; a finger drags after a long press of 500 ms held still
    (Google's Android app), and one that moves 8 px first scrolls the view
    or swipes it to the next period. While a finger drags, the view does not
    scroll; a long press opens no menu, and nothing selects text;
  - **where it goes**: on the time grid it moves by the 15-minute slots and
    the days between where it was picked up and where the pointer is (so a
    block at 10:05 moves to 10:20, as Nextcloud's calendar snaps; Google
    snaps to the quarter too); in the strip and the Month by days, keeping
    its length and time. From the grid into the strip it becomes all day
    from that day, over as many days as its times covered (one, for most);
    from the strip onto the grid it starts at the slot, an hour long. Dropped on the days shown only: past them is
    [deferred](#deferred);
  - **resizing**: a block's bottom edge moves its end and its top edge its
    start (8 px each; a block under 28 px has only its bottom edge), on its
    own day, at least 15 minutes long; D16's start–due task resizes either
    end. Google's web app resizes the end only, its Android app both;
    a chip has no length and does not resize;
  - **the ghost**: while it drags, the item is drawn where it would go, by
    the layout engine (foundation [D42](foundation.md#D42)), in its colour
    above the others, with its title and its new time (a short one: the
    time first); the original stays where it was, dimmed, until the save is
    written and the item is drawn anew, also while the scope is asked.
    Near the grid's top or bottom edge, once the drag moves that way, the
    grid scrolls, faster nearer the edge;
  - **Escape** cancels a drag; so does Cancel in the scope dialog. A drop
    that changes nothing writes nothing and asks nothing;
  - **an occurrence of a series** asks the scope with [D108](#D108)'s
    dialog and its rule: a new time on the same day offers all three, a
    new day "This occurrence" and "This and following" ("This and
    following" only where the calendar takes new items, D37);
  - **a press dragged over an empty column** sizes a new event from the
    first slot to the end of the last and opens the edit dialog with it
    ([D108](#D108)'s creating); one that never leaves its slot is a tap;
  - a drop that could not be saved (gone meanwhile, in doubt, failed;
    foundation [D103](foundation.md#D103)) says so in a note at the bottom
    of the view, with Dismiss; the item is drawn where the store has it.
- **D112. Keys and what a move says.** A focused item (its button) moves
  with **Alt and an arrow**: up or down by 15 minutes and left or right by a
  day on the time grid, left or right by a day in the strip, by a day or a
  week in the Month; **Alt, Shift and up or down** move a block's end by 15
  minutes. Alt with an arrow is the browser's back and forward, so on an
  item the key is taken from the browser. Each item names its keys
  (`aria-keyshortcuts`) and describes them in words (`aria-describedby`, in
  the user's language). After a move or a resize, by keys or a drop, a
  status region says what it is now ("Moved: Lunch with Marta. Thursday,
  November 5 · 3:00 – 4:00 PM", "Перенесено: Обед с Мартой. Четверг, 5
  ноября · 15:00–16:00"; "Resized: …"), a cancelled drag says so, and the
  focus follows the item to its new day. A key's move asks the scope as a
  drop does.

### Decided in the accessibility pass

- **D119. Accessible by WCAG 2.2 AA, kept so by an audit in CI.**
  `apps/web/e2e/a11y.spec.ts` runs axe-core (`@axe-core/playwright`) with
  the WCAG 2.0, 2.1 and 2.2 A and AA rules over every view in both themes
  on a phone and a wide screen, the drawer, the month picker, the strip
  expanded, the undone tasks, the tasks screen and panel, the settings,
  search with results, an event's and a task's details and edit dialog,
  the scope dialog, the accounts dialog, the Conflicts list and adding an
  account, from the demo data with the clock frozen; any violation fails
  CI's `e2e` job. A popup is audited once Base UI's entering marks are gone
  and its transitions have run out, not half faded in. A rule is switched
  off only in the spec's `DISABLED` (everywhere) or `EXEMPT` (on some
  elements), each with its reason, and an exemption matches nothing
  taller than it names, so it cannot hide a larger element that comes to
  fail. There is one, and it is **an accepted gap, not conformance**, with
  a mouse only: **target size** (2.5.8) is not checked on the button of
  each Month chip, "+N" and undone chip, one line of 16 px every 17 px as
  dense as the reference ([D86](#D86)); its day's number, the week's pill
  and the rest of the Month are checked. The criterion's _equivalent_
  exception does not cover it: the day's number (24 px) opens the day,
  where every item is a larger target, but not the item itself. An
  exemption holds only where the page matches its media query, this one
  `(any-pointer: fine)`. **On a touch screen the Month conforms**, with
  no exemption: a tap on a tile opens its day, the chips are no buttons
  (D86), and the audit's phone runs with a touch screen and no mouse.
  There an item's details are reached through its day, which is not a
  2.1.1 or 4.1.2 gap: the day's number is a button that says the day and
  how many items it has, it opens the Day view, and there each item is a
  button that opens its details and moves by its keys (D112); a screen
  reader's double tap on a chip opens the day too. What is lost on such a
  device with a keyboard is Tab to each chip in the Month, and the
  Month's own keys, a week at a time ([deferred](#deferred)). With a
  mouse the gap stays, for the density the owner chose ([D43](#D43)).
  The spec also proves what axe cannot see ([D120](#D120)).
- **D120. What the pass changed, and the rules it leaves:**
  - **an item's text on its colour** is white, as the reference draws it
    (Google Calendar keeps white text and colours dark enough for it), and
    the fill is the colour darkened as far as white needs, no further. In
    `styles.css` (`--item-fill`, CSS relative colours) the colour's
    linear-light sRGB channels are clipped to 0–1, then scaled down
    together until its WCAG relative luminance is at most **0.18**; white
    on 0.18 is 1.05 / 0.23 = **4.57:1**, over the 4.5:1 small text needs,
    with no exception for large text. Scaling the three channels together
    keeps the colour's hue (in OKLCH it scales lightness and chroma
    alike), a colour already that dark is drawn as it is, and clipping
    first holds the bound for a colour outside sRGB (`display-p3`, a wide
    `oklch`). `packages/ui/test/item-colors.test.ts` proves it over every
    OKLCH hue, chroma to 0.5 and lightness, and over the `#rrggbb` cube,
    each rounded up to 8 bits; `a11y.spec.ts` checks Chromium draws it so
    in both themes. A browser without relative colour syntax (Safari
    before 18, Firefox before 128) mixes every colour 45% into black
    instead (`color-mix`, which does not clip): white reaches 4.75:1 on any
    sRGB colour, the `#rrggbb` a CalDAV server sends; a wide-gamut colour
    there may fall short. A cap on OKLCH lightness alone (`min(l, …)`) was
    weighed and dropped: lightness is not luminance, so one cap must be
    about 0.52 to hold for a vivid green, and so darkens a grey that 0.568
    would serve; and a dark, vivid colour leaves sRGB and comes back
    brighter when clipped. The first version of this pass made the text black or
    white instead, which put black text on the demo's green and blue,
    unlike the reference. A done task's fill is its colour mixed 45% into
    the grid's and then darkened the same way: in the dark theme it is darker,
    in the light one greyer rather than lighter, still muted as D51 asks
    (less colour than the item it was, with white text at 4.5:1); it keeps its strike-through and its text is not
    faded, as done items are not disabled: they reach 4.5:1 too. An item's
    time is set apart by its weight, not by opacity. The colour is drawn
    the same way wherever it shows (`.item-color`): the undone chip's mark,
    a search result's dot, the details' swatch, the editor's colour
    choices, and the drawer's calendar checkbox, which is the calendar's
    swatch: drawn in the fill its items have, so the colour there is the
    one on the grid, with a white mark. As a control it needs 3:1 against
    the drawer (1.4.11): on the light drawer the fill reaches 4.57:1
    against white, on the dark one a pale colour, darkened to 0.18, still
    has 3.1:1, and a darker one is drawn as the server has it, so a
    colour near the dark drawer's own falls below 3:1 there (Deferred:
    contrast against the dark grid);
  - **muted text** is `ink-muted` at full strength: the faded variants
    (a day outside the month, the drawer's sync line, placeholders) were
    3.5:1;
  - **targets** are at least 24 × 24 px (2.5.8): the Month's day numbers,
    the strip's rows (24 px, were 22) and so its chips and "+N"; on a
    touch screen the Month's tiles, its chips being no buttons there
    ([D86](#D86)); with a mouse the Month's own chips are D119's accepted
    gap;
  - **names say what shows** (2.5.3): "Today" names the day its icon shows
    ("Today, Wednesday, November 4"), and a search result's or a task
    list tab's text keeps its words apart as its name says them;
  - **focus**: every focusable element without a ring of its own gets the
    accent's 2 px outline (the stylesheet's `:focus-visible`). An item's
    ring, the undone chip's and "+N"'s are drawn inward
    (`-outline-offset-2`): the grid's scroller, the strip and a Month day's
    rows clip what goes past them, and in the Month an outer ring covered
    the next chip. An item's is white, with the text's contrast on its fill
    (above). The spec tabs through the Week and the Month and checks each
    stop's whole ring lies inside every box that clips it. The tasks
    screen's tabs and panels, search results and menu items included.
    Base UI's dialogs, popovers and the drawer keep the focus inside while
    open and give it back to what opened them, an item's details too;
  - **landmarks and headings**: the top bar is the banner, the drawer the
    navigation, the view the main region named by the period, with a
    level-1 heading of the period for screen readers; each day's header is
    a level-2 heading. On the time grid and the Month each day is a list
    named by its date and each item a list item named by what it is, its
    title and its time (D50); the hour tiles and labels are hidden from
    screen readers;
  - **live regions**: a drag's or a key's move is said ([D112](#D112)); in
    the accounts dialog Sync now is heard to run and end (_since
    [D137](#D137)_ in the dialog's one live region, not one per account's
    sync line), and a sync that comes to need the user is
    said once, as the account button's dot shows it: the status keeps its
    text while the need lasts, through the syncs that run meanwhile, so it
    is not said again after each;
  - **less motion**: with `prefers-reduced-motion: reduce` nothing slides,
    fades or scales (transitions take no time) and a CSS animation runs
    once, at once; a spinner (`data-spinner`: the account button's while a
    sync runs, the sign-in's) turns on, as it says something is running;
  - **reflow**: at 320 px wide (1280 px at 400% zoom) every view needs no
    sideways scroll and the top bar's buttons and "+" stay on screen;
  - **language**: the document's `lang` is the UI's language (D53), so a
    screen reader reads Russian as Russian.

### Decided in the UI review (after v0.2.0)

The owner's feedback on v0.2.0: "settings sit right at the left of the
calendar on the web. Why there? Better a separate settings button, with
everything in settings. The '+' button sits too close to the edge, and with
the tasks panel open on the right it stands out even more. Review the UI and
UX as a whole." The review looked at every view, dialog and state at 412 and
1440 px, both themes, English and Russian, and ranked what it found; these
are its decisions.

- **D131. Settings are a screen of their own**, as Google Calendar's: the
  whole screen on a phone (the details' and edit dialog's sheet,
  [D108](#D108)), a dialog from 640 px, titled "Settings" with ✕ (Escape
  closes it too). The drawer keeps what it is for, the views and the
  calendars; on the desktop the settings no longer push the calendars up the
  sidebar. Inside, groups, each a card under its name, as Android's settings
  group them: _General_ (theme, language), _Views_ (week start, clock, hide
  completed tasks), _Calendars of_ each account (each calendar with the
  drawer's checkbox in its colour: shown in the views or not; one state is
  one widget, a checkbox, wherever it is met, not a checkbox in the drawer
  and a switch here), _Notifications_ (reminders) and, on the desktop only,
  _Desktop app_ (keep running, [desktop D75](desktop.md#D75)). A setting's
  name is on the left and its value on the right; a value too wide wraps
  under its name, so nothing scrolls sideways at 320 px. Each still applies
  at once ([D96](#D96)). **Reached by** a gear in the top bar on a wide
  screen (Google's web app) and by "Settings", the drawer's last row, on a
  phone (Google's Android app). A gear beside the account in the phone's top
  bar was weighed and left out: the bar already holds five buttons, and at
  360 px a sixth leaves the title some 90 px, too little for "October –
  November"; at 320 px less. Its switches show their off state by an
  outline (the track was a grey near the card's own), as every switch in
  the UI now does.
- **D132. Create: at the sidebar's top on a wide screen, floating
  elsewhere.** With the sidebar open, "Create" is an extended button (the
  "+" and its word) heading it, where Google Calendar's web app has it, and
  the wordmark it replaced is the browser's title; nothing floats over the
  grid, whose last column and the tasks panel's edge it covered. With no
  sidebar (a phone, a tablet, a desktop with the sidebar closed) the "+"
  button floats bottom right with Material 3's margins, 16 px on a phone and
  24 px from 640 px, inside the system bars' insets ([android
  D68](android.md#D68)). Where the button floats, the time grid keeps 80 px
  below midnight, as the Agenda and the tasks list already did, so it never
  hides the last hour for good; under a sidebar's Create the grid ends at
  midnight.
- **D133. The top bar on a wide screen is in Google's web order**: the menu,
  "Today" as a word in an outlined pill, previous and next, then the period
  they move (the month picker's button); search, Settings, the tasks toggle
  and the account at the right. The arrows sat at the far right, away from
  the title they change. On a phone the bar is as it was (D46, D59): the
  menu, the period, search, today's date as an icon, tasks, the account.
- **D134. One scale for type, one rule for corners, and empty screens that
  say what to do.**
  - **Type**: eight sizes, each a role, as tokens in `styles.css`
    (`text-tiny` 11 px: hour labels, the month picker's weekdays, chips and
    "+N" where columns are narrow, a phone's Week and the Month;
    `text-chip` 11.5 px: an item's title on the grid, the strip and the
    Month; `text-note` 12.5 px: hints and second lines; `text-small` 13 px:
    group headings and secondary text; `text-body` 14 px; `text-row` 15 px:
    a list's main line, a tab; `text-title` 19 px: a dialog's or a day's
    title; `text-headline` 22 px: a screen's title, an item's in its details
    and editor, the period), and one for fields: `text-input` 16 px, every
    field that takes text or a choice (search, the edit dialog's fields,
    sign-in's, Settings' choices), since iOS Safari zooms the page into a
    field under 16 px when it gets the focus. The UI had grown sixteen sizes
    in half-pixel steps (11 to 26 px), so two lists side by side rarely
    matched; each was mapped to the nearest role, no text moved by more
    than a pixel, and the fields grew to 16 px (the edit dialog's and
    sign-in's from 15, Settings' choices from 14). The accounts' and
    sign-in's screens keep their other sizes until they are reworked (Deferred).
  - **Corners**: an item 4–8 px, as dense as the reference (D43); a menu
    and a popover 12 px; a card in a screen (a task list's, a Settings
    group) and the Create button 16 px; a dialog 24 px; buttons and fields
    that are one line, a full pill, a select 8 px. The month picker was the
    one popover at 16 px.
  - **Empty screens**: search before a word is typed and when nothing is
    found, and the tasks screen with no task list, show what is empty and
    what to do (an icon in a soft circle, a line, a hint: "Only the
    calendars shown are searched", "A task list is a calendar that holds
    tasks…") in the middle of the free space, instead of one grey line at
    the top.
  - **Create in the light theme** is a deeper tonal blue
    (`--color-fab` `#c2d6fa`, was `#d2e2fc`), so the screen's main action
    stands off the light canvas: 1.29:1 against it (was 1.15:1; the dark
    theme's is 1.72:1), with its shadow as the edge. The fill is a tonal
    surface, as Material 3's is, not what tells the button: its "+" and its
    word are, at 9.43:1 on the fill (dark: 7.77:1), past 1.4.11's 3:1 and
    text's 4.5:1.
  - **"Nothing found" is a status** (`role="status"`), so a screen reader
    hears that a search found nothing; results are a list it can walk. The
    status is there, empty, while search is open, and only "Nothing found"
    goes in it: the hint before a word is typed is outside it, so opening
    search says nothing more than the field's name.
- **D135. A tab strip wider than its room says so.** The tasks screen's
  tabs (one per list, then "+ New list") scroll sideways when they do not
  fit, as Google Tasks' do; in the 360 px panel the Russian strip already
  did ("+ Создать список" cut at the panel's edge), with nothing to tell
  that more was there. Now a side that hides tabs fades out over 40 px (a
  mask on the strip, measured on scroll and on resize of the strip and its
  tabs), and the open list's tab is scrolled into view when it is chosen,
  from a search too ([D97](#D97)). No arrows: the strip scrolls by touch,
  wheel and Tab, and the fade is the sign. The chosen tab is scrolled by the
  strip's own `scrollLeft` until it clears the fade, so neither the page
  nor the panel moves. _Since PR (d1):_ a tab reached by the keyboard
  (Tab, the arrows; `:focus-visible`) is scrolled clear of the fade too,
  not only one chosen; a mouse's press, which focuses the tab as well, does
  not move the strip under the pointer before its click lands (the choice
  then scrolls it). When the strip or its tabs change size (a count, a font
  loading, the lists arriving), the open tab is brought clear again only
  if it was clear before and the change covered it: a strip the user
  scrolled stays where they put it. And the line
  under the strip is its wrapper's, so the mask no longer fades it at the
  ends.
- **D136. A closing dialog lets a press through.** While a dialog's
  backdrop and popup fade out (Base UI marks them `data-ending-style`), they
  take no pointer events (`data-ending-style:pointer-events-none`, which
  `dialog-parts.tsx`'s `DialogBackdrop`, `DialogPopup`, `AlertDialogBackdrop`
  and `AlertDialogPopup` add; every dialog uses them, and
  `test/dialog-parts.test.ts` fails on a dialog that takes Base UI's parts
  directly, so a new dialog cannot forget it). A backdrop on its way out used
  to swallow the next press, so a drag begun on the grid just after closing
  the edit dialog did nothing, and the press went nowhere a user could see
  (it surfaced as a test that failed one run in seven on a loaded machine,
  then was found to be a real flaw). Google Calendar's grid takes the press
  as soon as a dialog starts to close. _Narrowed in PR (d2):_ to dialogs only (the
  first version took every element Base UI marks closing, a collapsing
  panel too). Menus and popovers are Base UI's: it makes a closing one
  inert, so a press passes it whatever this rule says, and a modal menu's
  own backdrop catches what falls outside it. A double click on the month
  picker's day is tested to act once: it picks the day, and its second
  click, passing the closing picker to the grid, makes no event there
  (_since [D154](#D154):_ a double click's second click creates nothing on
  the slot its first took, or after a first that was not on the grid).
  **Unverified against Base UI's menus and popovers:** no test was found
  that tells the old global rule from this one there (a menu's and the
  month picker's double click pass under both, Base UI making them inert
  itself), so that the narrowing changes nothing for them rests on reading
  Base UI's positioners, not on a test. What is tested is the dialogs:
  `apps/web/e2e/settings.spec.ts` closes a Dialog and an AlertDialog with a
  long fade and finds each backdrop and popup without pointer events, on
  the app's own styles, and fails without the parts' class.
- **D137. The accounts in Settings, one row for a calendar, and the scale
  everywhere** (the two Deferred items D131 and D134 left, once the first
  run became the calendar on this device, [foundation D122](foundation.md#D122)):
  - Settings' calendar groups become one **Accounts** group: each account
    with its avatar, name, how it syncs (text; the dialog's one live
    region says a sync, below) and its menu
    (sign in again, remove; _since #58_ no "Sync now" there: it synced
    every account, from one account's menu, so the accounts dialog's own
    "Sync now", which says it is for every account, is the one way; one
    account's sync alone is [Deferred](#deferred)), then its calendars, then "Add
    account". The same account row (`AccountRow`) is the accounts
    dialog's, Settings' and, compact, the drawer's head, and the same
    calendar row the drawer's (`CalendarRow`, `calendar-row.tsx`): one
    component each, so the places cannot drift. The row carries what tells
    the user what to do: "Sign in again" for a signed-out account (in all
    three) and what the last sync could not do, its errors and dropped
    changes (in the dialog and Settings; compact, the drawer leaves them to
    the dialog, where the account button's dot leads, and has no avatar,
    its name a heading). Its sync line is text, not a live region: one per
    row said a sync once for every account. The accounts' state has one
    live region at a time: the account button's while the dialog is closed
    (a need, said once, [D120](#D120)), and the dialog's own while it is
    open, since a modal dialog hides the page from a screen reader (a sync
    running, then how it ended: "synced", offline in the rows' calm words
    ("Offline: changes wait…", never "synced"), or still needing the
    user). `text-tiny`
    in the drawer's compact head is [D134](#D134)'s smallest role.
    The calendar on this device is named as everywhere else ("On this
    device"), not by its stored name. An account's menu, "Sign in again" or
    "Add account" closes Settings before its dialog opens, as the drawer
    does. The conflicts stay in the accounts dialog, where the account
    button's dot leads.
  - The accounts dialog is closed by ✕ before its title, as every other
    dialog, not by a word at its other end.
  - [D134](#D134)'s scale now holds everywhere: the accounts dialog,
    sign-in, removing an account, the keyring question and the store's
    error screen took its roles, and Tailwind's own sizes left in the UI
    (`text-xs`, `text-sm`, `text-lg`) became `text-note`, `text-body` and
    `text-title`, so a size is chosen by its role only; the update notice
    ([foundation D124](foundation.md#D124)) too, which now also sits above
    the system bar, and on a phone above the "+" button it covered
    ([D132](#D132)).

### Decided in the logic QA (after v0.2.0)

The owner's feedback 5 on v0.2.0: "silly logic errors". What the edit
dialog ([D108](#D108)) and the words of the UI did wrong, and do now:

- **D143. The edit dialog's corners.**
  - **An event with no length saves.** One another client wrote with no
    `DTEND` (RFC 5545: it ends when it starts) was refused as "ends before
    it starts" even for a new title. It keeps no length wherever it moves,
    its end moving with its start; only an event that had a length may not
    be given none (`problemOf`).
  - **A new start keeps the length over midnight** (`withStartTime`), as
    Google moves the end: 22:00–02:00 started at 23:00 ends at 03:00 the
    next day; 22:00–23:00 started at 23:30 ends at 00:30. The length is
    the wall clock's, as Google's: across a DST change an hour stays an
    hour on the clock.
  - **Save with nothing changed asks nothing** of an occurrence of a
    series, as a drop that changes nothing ([D111](#D111)); it writes
    nothing either.
  - **Event, task, event keeps the event's times** while creating: switched
    to a task, the event's days and its end time are kept with the form,
    and switched back it has them again, from the day the task starts on
    (several days, no length, all day). A task made an event otherwise
    lasts an hour from its start, or its one day. _Since round 3
    ([D159](#D159)):_ the task keeps the event's start and all-day state,
    with no due; it was due on the event's day, all day.
  - **A dialog keeps its keys**: the view and period keys
    ([D88](#D88)) do nothing behind the scope question or a confirmation
    (`alertdialog`), as behind any other dialog.
- **D144. Words that said the wrong thing.**
  - **A task's reminder on its due date reads as its day**: "On the day at
    9:00", "1 day before at 9:00", as an all-day item's ([D108](#D108)).
    The dialog related a task's reminders to its due (`RELATED=END`; _since
    round 3 to its start, [D159](#D159), and to its due only without one_), and a
    due date counts from its day's midnight, as an all-day start does; the
    words read only a start that way, so every preset of a dated task said
    "9 hours after the start" or "39 hours before". After a timed due it
    says "after the due time", not "after the start". The details, the
    edit dialog and the Conflicts list read every reminder by the time it
    counts from (`alarmOptions`: a date or not, the item a task or not), as
    core's `remindersOf` picks it.
  - **A reminder at a time of its own** says the day it rings on in the
    user's zone, as its time; the day was its own zone's.
  - **Russian counts 21, 31, 101 in the singular**: "Каждый 21 день",
    "Каждую 31 неделю", "Каждый 21 месяц", "Каждый 101 год"; they read
    "Каждые 21 день".
  - **A task in the search results** reads as its due: the day it is due
    and the time, or the day alone for a due date, where it gave its
    start's day with its due's time.

### Decided in round 3

The owner's feedback on v0.3.0, tested on the web on a phone and a
computer. For the views: "nothing animates when I flip a week, a month or a day"; "the
calendar button at the top right does not always work: on the phone I have
to hold it or press it twice"; "in the Day view, with many tasks on a day
without a set time, when I flip to another day the room those tasks took at
the top stays"; "I want to see a preview of the item in the background while
I make it"; "sometimes an item's text is covered by another event".

- **D151. The all-day strip is as tall as the days shown need**, on every
  period: flipped from a day whose strip held rows to one with none, the
  strip kept the old rows' room over nothing. Its rows were a style,
  `repeat(N, 24px)`, and `repeat(0, 24px)` is no value at all, so the
  browser kept the one before; with no rows it is now `none`, and the strip
  is its 4 px edge (`apps/web/e2e/calendar.spec.ts`). D51's expanded strip
  stays the user's choice across periods and views while the app is open,
  as Google Calendar's web app keeps its all-day section open from week to
  week: a strip with three rows or fewer has no chevron and shows all, so a
  choice kept never hides anything; the chevron folds it again.
- **D152. A swipe leaves the next tap alone.** After a quick sideways swipe
  over the time grid or the Month, the next tap anywhere, a top-bar button
  above all (the date icon of Today), gave no click: the swipe ended in the
  browser's own fling (Chromium starts one even over `touch-action: pan-y`,
  where it can move nothing sideways), and the next touch only stopped that
  fling, which takes its tap; a second tap, or a long press after it,
  worked. Reproduced in Chromium's touch input with a flick's timing
  (16 ms between moves): the click came after a slow swipe, a swipe over
  the top bar, or a vertical one, and never after a quick one over a
  `pan-y` view. Now `useSwipe` locks a finger's axis on its first 8 px of
  movement, under the browser's own touch slop, and cancels a sideways
  finger's `touchmove`s, so no fling starts; a vertical one stays the
  grid's scroll. Every top-bar button, the drawer's rows and the Agenda
  were checked after a swipe on a phone's viewport: each takes the first
  tap; the two `pan-y` views were the only ones it took.
  _Fixed after it landed:_ the swipe's finger was kept inside its listeners,
  attached by an effect after the view was drawn, and React's Strict Mode
  (in development: the dev server CI's tests run on, and the one the owner
  opens on a phone through `tailscale serve`) attaches them again just after
  mounting: a swipe begun in that moment lost where it began and moved
  nothing; the owner saw a swipe now and then go nowhere, and CI's two
  `useSwipe` tests failed now and then; on a CPU slowed twelve times it
  failed 5 runs in 5. The finger is now kept in a ref beside the listeners,
  which are attached as the element is (a layout effect), and
  `packages/ui/test/swipe-strict.browser.test.tsx` attaches them again while
  a finger is down, at a known point (a new ref), and the swipe still ends
  (it fails with the finger kept in the listeners). An end-to-end test on a
  CPU slowed twelve times was tried first and left out: on CI's two cores it
  ran past its 30 s before the read of the next days, and could not tell a
  lost swipe from a slow one. The Month's test waited for the month's name,
  which the top bar shows before its days are drawn; it waits for a day now.
- **D153. No item covers another's title** (the owner's feedback 6 on
  v0.3.0: "Sometimes an item's text is covered by another event. Text is
  what matters most. Maybe push the event further aside, or give it an extra
  column?"). On their screen, the demo's Wednesday ("Обзор дизайна"
  10:00–11:30, "Планирование бюджета" 11:00–12:30, "Созвон с Анной"
  11:15–11:45), the call was drawn over the budget's title: D15's cascade
  drew any later item over an earlier one, 15% further in, whenever they
  overlapped, so a title wrapping in a narrow column ran under the next
  item. As Google's rule, `layoutDay` now places a cluster's items in time
  order (the longer first when they start together), each on top of those
  before it, in the first of: a column where nothing overlaps it; a column
  where it starts at least the **title room** (45 minutes, 40 px: two lines
  of a title) after every item it overlaps there, with fewer than three
  stacked, drawn over them 15% of the column further in per item under it,
  so their titles show above it; a column of its own, beside the others. The
  columns share the day's width, and an item widens over the columns to its
  right while nothing in them overlaps it, as Google's do (10:00–11:30 under
  11:00–12:30, with 11:30–12:00 beside the latter, takes the whole width).
  Each placed item says how much of its top nothing covers (`room`); its
  title keeps to that, in whole lines cut with an ellipsis, and its time
  line, one line cut short, shows under it only where two lines of the title
  fit above it too: the title wins over the time (`textFit`), so no text
  runs under another item. This works for any item's height (a task's chip,
  30 minutes, is never drawn over). Tested as a pure function: the owner's
  day, the old cases, and 300 generated days on which an item drawn over
  another always starts at least the title room after it, further in
  (`packages/core/test/layout.test.ts`); `textFit` at the title room and
  around it (`packages/ui/test/text-fit.test.ts`); and in the browser, the
  demo's Wednesday on a phone's 3 days and week and a wide week and day,
  where no line of a title or time is under an item drawn over its own
  (`apps/web/e2e/calendar.spec.ts`; on the phone's views it failed before).
  D15, D42's cascade and D50 point here.

**Places on the map**, feedback 8: "I want 'Location' to search real places
on a map, connected to a map. That also gives a nice place card when viewing
an event or a task." What is written and which services are asked:
[foundation D176](foundation.md#D176), [D178](foundation.md#D178).

- **D175. Location searches places as the user types.**
  - **The field stays a text field** (`place-field.tsx`): what is typed and
    not picked is saved as typed, free text with no point. Below it, as
    Google's suggestions, the places Photon finds: each with its name and
    its address under it, "Places from © OpenStreetMap contributors" at
    the list's foot, as OpenStreetMap asks of a geocoder's users. Picking
    one fills the field with "name, address" and keeps its point; typing
    over it after makes it text again. The list is Base UI's Autocomplete
    in the popup and rows of the app's own dropdowns ([D167](#D167)), over
    the edit dialog; it is a text field with suggestions, not a `Select`.
  - **Asked sparingly**, as Photon's fair use asks: a query of three
    letters or more, once typing pauses (350 ms), one request at a time
    (the one before aborted), each answer kept for the session per query,
    six places. The last answer stays shown until the next comes.
  - **In the UI's language** where Photon has it (`en`, and `de`, `fr`);
    the public Photon refuses others (`lang=ru`: 400, "Supported are:
    default, de, en, fr"), so Russian asks for `default`, each place's own
    name: Moscow's in Russian, Berlin's in German.
  - **Near the user without asking where they are**: the search prefers
    places near the item's own place, else near the last place picked on
    this device, both rounded to a tenth of a degree (a town). No location
    permission is asked: the page's policy refuses geolocation
    (foundation [D110](foundation.md#D110)), and a town is enough.
  - **A setting, on by default**: Settings → Places, "Search places on the
    map", saying what it sends where: "What you type in Location goes to
    photon.komoot.io to find places, and the maps of places come from
    tile.openstreetmap.org" (the deployment's own Photon named instead,
    when it has one). Off, Location is the plain text field and the place
    card has no map: nothing is asked of either. Offline, or with Photon
    failing, no list shows and the field is the text field it always was.
- **D177. The place card.** In an item's details (`place-card.tsx`), a
  place with a point shows its name, its address under it, and a map of
  OpenStreetMap's tiles 144 px high across the card, the place in its
  middle under a pin, "© OpenStreetMap" in its corner linking to the
  copyright page; the tiles load as the card shows (`loading="lazy"`), and
  one that does not come leaves the map's ground. Two actions under it:
  - **Open in maps**: OpenStreetMap's page with a marker on the place
    (`openstreetmap.org/?mlat=…&mlon=…#map=17/…`); on Android a `geo:` URI
    with the point and its text (its parentheses escaped, as the label sits
    in them), which opens the user's maps app. A text
    with no point opens a search for it (`openstreetmap.org/search?query=…`,
    `geo:0,0?q=…`).
  - **Both actions stay with places off, and on the desktop**: they are
    links the user taps, and nothing goes anywhere until they do; the
    setting's "nothing is asked" is what the app asks on its own.
  - **Copy address**: the location's text, "Copied" for two seconds after;
    refused by the clipboard, the change notice says "The address could not
    be copied", on the page's body so the open details do not hide it from
    a screen reader; with no clipboard at all (an insecure page, some
    WebViews), no button.

  A text with no point (another client's, or typed) shows as it always did,
  whole, commas and all, with the same two actions. A place with a point
  is named by Apple's own name and address when its structured location
  has them (foundation [D176](foundation.md#D176)), else from its text:
  Apple's lines, or AstroTime's and Google's "name, address".

### Decided in round 3: settings, colours, dropdowns, accounts

The owner's feedback after v0.3.0, tried on a phone and a computer, for
Settings, the colours and the lists controls open.

**Settings, colours, dropdowns, accounts.**

- **D154. Periods move, as Google Calendar's Android app moves them** (the
  owner's feedback 1 on v0.3.0: "There are no transition animations. On the
  phone I can swipe, and nothing animates when I flip a week, a month or a
  day."). Its periods are drawn by one `Pager` (`components/pager.tsx`), in
  every view but the Agenda. On a touch screen (`any-pointer: coarse`) a
  view reads the periods before and after the one it shows with it (one live
  query over the three, so a step to either is drawn at once: a read draws a
  period when it covers its days, not only when it is its exact range);
  elsewhere it reads the period shown only, as before, since nothing is
  drawn beside it (a Month would expand three months of series for nothing
  on every change). There the periods before and after are drawn beside the
  one shown, `inert` and hidden from a screen reader, and a sideways swipe
  carries all three under the finger: `useSwipe` locks the axis on the first
  8 px ([D152](#D152)), and each move sets the track's `transform` and
  nothing else, no render; the grid's scroll is copied to the periods beside
  as the swipe locks, so none jumps as it comes in. Let go, it settles with
  Material's emphasized decelerate (at most 260 ms, less for what is left of
  the way) on the next or previous period past a quarter of the view's width
  (56 to 120 px) or a flick of 24 px on at 0.4 px/ms, and back otherwise
  (`swipeOutcome`); the step lands in the same frame as the settle ends (and
  a step that changed no period gives the track back, so a swipe never stays
  stuck on a neighbour; a settle ends only on its own step, the period it
  went to in the view it began in: a key, Today or another view pressed
  meanwhile ends the settle and moves as it would, sliding or fading in),
  the periods drawn in time order so none is moved in the page and each
  keeps its scroll. A vertical move is the grid's scroll, a long press the
  drag's ([D111](#D111)), a tap (no move past the 8 px) no swipe at all:
  none moves the period or starts a settle. A step to a period the read
  already drawn holds lands from it at once, even while a newer read of
  another range goes on (a swipe's neighbour was drawn from it), so a step
  never snaps back to wait for its read. A step by the arrows, the keys,
  Today, the month picker or a day opened slides the new period in from the
  side it comes from (40 px and a fade, 220 ms), on every screen; another
  view fades in (160 ms); the Agenda slides a picked day in from above or
  below (24 px), the same day picked again after a scroll too. Only
  `transform` and `opacity` move, with the Web Animations API, on the
  compositor. `prefers-reduced-motion` swaps at once: no slide, no fade, no
  follow. The time grid's scroll is kept from period to period and view to
  view (it was kept by its one grid; each period now has its own). A double
  click's second click on the grid creates nothing when it lands on the slot
  its first took, or when its first was not on that grid: the second click
  of a double click on the month picker's day passes the closing picker
  ([D136](#D136)) to the grid, and with the period drawn at once it can land
  on an empty hour, where the old week's taller strip had taken it before; a
  second click on another slot of the same grid is a click of its own. Where
  the first click went is read from the grid's own presses (an empty slot,
  or an item), not from the clicks it handled: a second click after a press
  on an item of the grid, or on another slot, creates; one whose first press
  was not on the grid within a second (the closing picker's, or a menu's
  drawn over it) creates nothing. Tested in `apps/web/e2e/motion.spec.ts`
  from the page's own calls to `animate`, so no test waits for an animation:
  the slide's side, the fade, nothing with reduced motion, the track under
  the finger and its settle, a short swipe going back, a vertical scroll
  moving nothing; in `packages/ui/test/pager.browser.test.tsx`, a step that
  changed no period freeing the swipe and a swipe with nothing beside
  stepping at once; in `drag.spec.ts`, a double click on an empty hour
  making one new event there. Year view and a swipe between the Agenda's
  days are not part of it; three periods are drawn on a touch screen only,
  as a desktop has no swipe.
- **D155. The item being made is drawn behind its dialog** (the owner's
  feedback 5 on v0.3.0: "I want to see a preview of the item in the
  background while I make it. When I create an event or a task, a modal
  opens and I still see the background. If the item lands on a day or days
  shown behind it, it should always be shown there as a preview."). While
  the edit dialog is open, the views draw its **draft**: the item as the
  form says now, on its days and times, under its title, in its colour and
  calendar, as an event or a task, following every change of a field. A new
  item is the object the form would save (`createItem` on the form's
  changes, as saving makes it), so a series is drawn on each of its days; an
  edited one is its occurrence at the form's times (`timesOfForm`,
  `ghostOf`), drawn instead of the occurrence where it was, done as it is,
  the series' other occurrences kept: the scope (this, this and following,
  all) is asked only at saving ([D108](#D108)), so while the dialog is open
  the one occurrence it edits is what is known to move, and a changed rule's
  new occurrences are not drawn ([Deferred](#deferred)). It is laid out with
  the others ([D153](#D153)), raised over them with a shadow (`data-draft`),
  and brought into sight where the view scrolls when its day or time changes
  (not with each letter of its title); it goes with the dialog, and a saved
  item is then drawn from the store. The editor makes it, in its own chunk
  (`useDraft` in `draft-aside.ts`, on `calendar/draft.ts`'s `draftOf` and
  `withDraft`), so nothing of it is in the first load ([foundation
  D145](foundation.md#D145)), and hands the views what it does to their
  entries (`DrawnDraft`: `apply`, `when`) through `useEditingState`'s
  `draft`; the form's fields are not touched. It is made anew only when
  where or how it is drawn changes (`placementOf`: kind, times, rule,
  colour, calendar): a new title renames it without making, parsing or
  expanding it again (a new item's occurrences are kept for each range a
  view asked for), and the description, the place or a reminder change
  nothing, so typing on a phone stays light. From 1024 px, where a dialog
  and a day of a week fit side by side, the dialog stands at the side of the
  screen away from the draft (`useDraftAside`), and its backdrop dims less
  (20%), as Google Calendar's web app keeps its draft beside its dialog;
  narrower, it stays in the middle (on a phone it is the whole screen). The
  Agenda draws it too. Tested: `packages/ui/test/draft.test.ts` (a new
  event, a new series, an edited event and an edited occurrence of a series,
  a form with no date, which draws nothing and tells nothing; a fault other
  than an item that cannot be made yet, which is told on the console; a done
  task drawn done; a new item outside the days asked; a new title renaming
  the draft without expanding it again) and `apps/web/e2e/draft.spec.ts` (a
  new event that follows its form, all day into the strip, the dialog beside
  it; an edited event at its new place and back at its old one when the
  dialog goes; a task in the Month; the phone).
- **D167. Dropdowns of our own** (feedback 14: "when I open one I am met by
  a not very pretty native list"). Every list a control opens is
  AstroTime's, from `components/select.tsx`: `Select` picks one value (Base
  UI's Select: the edit dialog's times, repeat, calendar and the custom
  rule's fields, and Settings' choices), `MenuButton` runs one action from
  a list (Base UI's Menu: "Add a reminder"). No `<select>` is left.
  - **One popup on every screen**, under its button, at least as wide as
    it and never wider than the screen, as Material's exposed dropdown
    menu is on Android; not a bottom sheet: Google's Android app opens a
    list under the field for the edit dialog's choices, and the popup
    keeps the field in sight. On a touch screen (`pointer: coarse`) its
    rows are 48 px; with a mouse 40 px.
  - **The chosen value** is checked and in the accent colour, and the list
    opens scrolled to it, so the time list's 96 quarters start where the
    item is. The popup never covers its button (Base UI's
    `alignItemWithTrigger` off): the same on a phone as with a mouse.
  - **Keyboard and screen reader** are Base UI's: a `combobox` button
    named by its label, a `listbox` of `option`s, arrows, typing to jump,
    Enter, Escape closing the list and not the dialog under it. The
    accessibility audit ([D119](#D119)) runs on the edit dialog with its
    time list and its reminder menu open, in both themes.
  - A choice may carry something before its name (`leading`), drawn in the
    list and on the button: the colour dropdown's dot.
  - A value no option has (a calendar gone meanwhile) reads "Not chosen" on
    the button, never a blank one.
- **D168. The colour dropdown** (feedback 13: "a dropdown of colours, with
  a dot of the colour left of its name"), instead of the circles: one
  `ColorSelect` (`components/color-select.tsx`) in the edit dialog and for
  Settings' defaults. Its entries, each a dot drawn as an item of the colour
  is ([D120](#D120)) left of its name: "The calendar's colour" first (its
  dot the calendar's; in Settings, where there is no one calendar, a ring),
  the palette's nine CSS names, the user's own colours ([D173](#D173)), and
  an item's own colour that is none of them (from another client, or one
  since deleted) by its generated name ([D170](#D170)), a CSS name by its
  hex's (`colorNameHex`), "Its own colour" only for what is no colour. A calendar's colour stays the server's: AstroTime does
  not change it (Deferred).
- **D169. Week numbers can be turned off** (feedback 10: "a setting whether
  to show week numbers"). "Show week numbers", in Settings' views group
  after "Hide completed tasks", on unless turned off: today's look stays
  the default, as Google Calendar's web app and Nextcloud's show them. Off,
  the week views' pill above the hour labels goes ([D49](#D49)) and the
  Month's column of pills goes, its gap too ([D86](#D86)), so the days
  start at the edge. One value with the other settings ([D96](#D96)).
- **D170. A colour's generated name** (feedback 10: "a name generator that
  names the colour from the colour chosen"): a pure function
  (`calendar/color-names.ts`, in the dialogs' chunks), the same name for
  the same colour. The hue's family (eighteen, by HSL hue: red, coral,
  orange, amber, yellow, lime, green, emerald, teal, cyan, azure, blue,
  indigo, violet, purple, magenta, rose) with one modifier by lightness and
  saturation: deep, dark, light, pale, dusty or bright. A dark orange is
  brown, a dark yellow olive, a dark magenta purple, a soft light orange
  beige, a light red pink; with no saturation it is grey, black or white.
  English says "Dusty rose", "Deep teal"; Russian names a colour by its
  adjective, the modifier a prefix of it: "Пыльно-розовый",
  "Тёмно-синий", "Глубокий бирюзовый".
  - **The rule:** an own colour's name is `null` while generated, so it
    follows every change of the colour, and the language spoken. Typing in
    the name makes it the user's, as typed: it stays through changes of
    the colour until they press "Name it from the colour", or save it
    blank.
- **D172. Default colours for new items** (feedback 10): "Colour of new
  events" and "Colour of new tasks" in Settings' "Colours" group, "The
  calendar's colour" by default. A default other than that is the new
  item's own `COLOR`, written when it is saved, as if chosen in its dialog:
  [D47](#D47) holds, an item's own colour before its calendar's. The dialog
  opens on the kind's default; switched to the other kind while still in
  it, the colour follows.
  - **An own colour is a default by its id** (`own:<id>`), so recolouring
    it moves the default; deleted, the default is the calendar's again.
  - **Read leniently:** a stored default that is no colour `editItem`
    takes ([foundation D174](foundation.md#D174)) reads as the calendar's,
    so it never refuses a new item's save.
- **D173. The user's own colours** (feedback 10: "make my own colours with
  their own names"): made, renamed, recoloured and deleted in Settings, in
  a dialog of their own: a palette (thirteen hues in three tones and three
  greys, drawn as items of them are) and a hex code, the name generated
  ([D170](#D170)). They are this device's, with the other settings
  ([D96](#D96)): Nextcloud keeps no list of a user's colours a client could
  share, so travelling with the account is Deferred. An item given one
  keeps its exact hex beside the nearest CSS name
  ([foundation D174](foundation.md#D174)).

**The items' editor and details.**

- **D159. A task is at its start** (the owner's feedback 4 and 7: "a task
  is a fixed time; on the calendar it shows as a task exactly 30 minutes
  long"; "it is odd that I can pick all day but not pick a due"). It
  changes foundation [D16](foundation.md#D16) and [D42](foundation.md#D42),
  [D50](#D50), [D51](#D51), [D108](#D108)'s "a task's start and due, each
  with a switch", [D109](#D109), [D143](#D143)'s event-to-task switching
  and [D144](#D144)'s reminders counted from the due:
  - **a task has a start, always**: a day and a time, or only a day when
    "All day" is on. There is no switch on the start. A task made on a
    tapped slot, or switched to from the event a tap or "+" began, takes
    that day and time, as the event would; the all-day state is kept too;
  - **on the calendar a task is a chip at its start**: 30 minutes tall at
    its time on the time grid, or one line in the all-day strip on its day,
    whatever its due and however far it is (`layoutDay`, `dayRange`; the
    Month and the Agenda show it on that day only). One with only a due
    (another client's, below) shows at its due the same way. On purpose,
    tasks other clients wrote with a start and a due lose the block from
    one to the other: the due shows in the details only (a mark of it on
    the calendar is [Deferred](#deferred));
  - **the due is a field of its own, off at first**: "Add due" ("Добавить
    срок"); tapped, it is set on the start's day, an hour after its start
    for a timed task (the next day's past midnight), the day alone for an
    all-day one; a ✕ beside it clears it ("Remove due"). "All day" is the
    start's and the due's alike. A due before the start is refused, in
    words (D108's rule);
  - **the due moves with the start**, as an event's end does: a new start
    in the dialog keeps the time between them (`withStartTime`,
    `withStartDate`), and a drag or a key moves both, a due date by the
    days the start moved (foundation [D113](foundation.md#D113)); a task
    is never resized, as it has no length on the grid;
  - **its new reminders count from its start**, where the calendar shows
    it (`RELATED=START`); one with only a due counts from its due
    (`RELATED=END`, as RFC 5545 §3.6.6 requires a `DTSTART` for the
    first). A reminder it already has keeps its relation as written,
    unless the user removes it (foundation [D7](foundation.md#D7));
  - **its details and a search result read its start** ("Wednesday,
    November 4, 3:00 PM · Due Friday, November 6"), its due after it.
- **D160. Tasks other clients wrote stay as they are.** Nextcloud Tasks
  and others write tasks with only a `DUE`, or with neither date. Such a
  task shows at its due ([D159](#D159)), or on the tasks screen only with
  neither, as before. The edit dialog opens it with a start shown from its
  due (the due's day and time, all day for a due date), or today, all day,
  without either (`startless` in the form). That start is shown, not
  written (foundation [D7](foundation.md#D7)): while the user leaves it, it
  follows the due (`withDueAt`), and the task keeps only its `DUE`, so a
  due moved or made all day shows where it now is; a new title alone
  writes the title. Once the user sets the start, or turns "All day" on or
  off (the times change with a start shown), it is written; and when the
  due is cleared, the start shown is written, as a task needs a time.
  A reminder added to a task with no time at all writes the start shown
  too, as the reminder counts from it (RFC 5545 §3.6.6 wants a `DTSTART`
  for `RELATED=START`); one with only a due keeps its due alone, the
  reminder before the due.
  "All day" is one switch for both ends: a task another client wrote
  with a date start and a timed due (or the other way round) opens as the
  start is. Its due keeps its own kind (`dueKind`) until "All day" is
  switched: a due date after a timed start stays a date, its day alone in
  the dialog, and a new start day moves it by whole days, a new start
  time not at all; a timed due after a date start keeps its time and its
  own zone (foundation [D7](foundation.md#D7)).
- **D161. Overdue is its due, else its start; the tasks screen's new task
  is today's.**
  - A task is **overdue**, and rolls over to today's "N undone tasks"
    ([D51](#D51)), when its due is before today, or, without a due, its
    start is (`isUndoneBefore`, unchanged: the occurrence ends at its due,
    else at its start). So a task with no due goes overdue on the day after
    its start, whatever time it started: one made at 15:00 today is not
    overdue tonight, and is in tomorrow's "N undone tasks". A task started
    before today and due after it is not overdue: it stays on its start's
    day.
  - The tasks screen's "Add a task" ([D109](#D109)) opens a task on today,
    all day, in that list, no longer an undated one. The owner's model has
    no undated task: a start "always has to be chosen", and a task with no
    day never reaches the calendar, the logic error of feedback 4. Google
    Tasks' list item with no date is what the owner moved away from; today
    all day is the least the list asks of the user, and the dialog changes
    it.
- **D162. A task has no status, priority, progress or tags in the
  dialogs** (the owner's feedback 9: "for tasks remove status, priority,
  completed and tags. None of that is needed"). It changes [D109](#D109).
  The edit dialog no longer has a task's status, priority, progress in
  percent or tags, and the details no longer show them; an event's tags
  still show in its details. Completing stays where it was: the check on
  the item and the tasks screen, and "Mark completed" in the details
  ([D94](#D94)). The fields go from the UI, never from the data: a
  task's `STATUS`, `PRIORITY`, `PERCENT-COMPLETE` and `CATEGORIES` are
  written back as they were (foundation [D7](foundation.md#D7)), and only
  completing changes the first and the third.
- **D163. Delete is in a "⋯" menu with "Make a copy" and "Copy to…"**
  (the owner's feedback 11). The details' Delete button becomes "More
  actions" (`MenuButton` with an icon, [D167](#D167)): Delete, "Make a
  copy" ("Сделать копию"), "Copy to…" ("Копировать в…"), in that order,
  each where the rights allow it (foundation [D37](foundation.md#D37),
  `rightsOf`): Delete as [D108](#D108) said; "Make a copy" when the item's
  calendar takes new items; "Copy to…" when any calendar takes one of its
  kind, so a read-only calendar's item can still be copied elsewhere. The
  menu shows only with one action in it. Edit stays a button of its own.
- **D164. What a copy is** (`copyItem` in `@astrotime/core`):
  - **"Make a copy"** saves the copy at once in the item's calendar, closes
    the details and says "Copy made" ("Копия создана"), with Open, which
    opens the copy's details; the notice goes by itself after 8 seconds,
    as a snackbar does. **"Copy to…"** opens the edit dialog as a new
    item, every field filled from this one, the calendar too (the first
    that takes it, when its own takes no new items); its kind cannot be
    switched; Save makes it wherever the dialog says, the copy with the
    user's changes, its first revision (`SEQUENCE:0`, `createFromCopy`).
    One notice shows at a time: a copy's replaces a failed change's, and
    the other way round.
  - **An occurrence of a series is copied alone**, as an item that does
    not repeat, at that occurrence's time and with its exception's fields:
    the copy is what the user tapped. Google's own help does not say, and a
    report of its "copy to my calendar" copying one instance of a series
    is the nearest evidence; a series copied whole is
    [Deferred](#deferred).
  - **What it keeps:** every line of the item, those AstroTime has no
    field for included (`X-*`, `GEO`, `X-APPLE-STRUCTURED-LOCATION`,
    `RELATED-TO`, the star; foundation [D7](foundation.md#D7)), and the
    calendar's other components (its `VTIMEZONE`s). "Copy to…" saves the
    copy with what the user changed, not a new item made of the fields.
  - **What it does not:** a new `UID`, `DTSTAMP`, `CREATED` and
    `LAST-MODIFIED`, `SEQUENCE:0`; no `RRULE`, `RDATE`, `EXDATE` or
    `RECURRENCE-ID`; no `ORGANIZER` or `ATTENDEE`, so no server that
    schedules sends an invitation for it and no guest's answer is copied
    (AstroTime does not invite, [D108](#D108)); a task is not done in its
    copy (`STATUS:NEEDS-ACTION`, no `COMPLETED`, `PERCENT-COMPLETE:0` when
    it had one); its reminders keep their times, without their `UID` and
    their `ACKNOWLEDGED`, and the item without Thunderbird's
    `X-MOZ-LASTACK`: those say the original's reminders were seen, which
    the copy's were not.

## Deferred

- **The draft beside the dialog in the Day view and the Agenda**
  ([D155](#D155)): there the draft is as wide as the view, so the dialog,
  standing at one side, still covers part of it; a dialog placed by the
  draft's height, or the view scrolled to its free half, would keep it
  whole.
- **The draft over the Agenda's sticky day headers** ([D155](#D155)): its
  `z-index` raises it over the other items and the now line; in the Agenda
  it would pass over a day's sticky header while the list scrolls under an
  open dialog, which the dialog covers in practice.
- **The draft's placement read from a ref** ([D155](#D155)): `useDraft`
  makes the draft in a memo keyed on `placementOf(form)` that reads the form
  from a ref written during render, so a field that changes where the item
  is drawn but is left out of `placementOf` would keep an old draft with
  nothing failing. A memo keyed on the placement's own fields (or a test
  that every field `draftOf` reads is in `placementOf`) would close it.
- **An edited draft offered to every range** ([D155](#D155)): `withDraft`
  adds an edited item's draft to each range a view asks for, and the layout
  leaves it out of the days it is not on; it is untested on a page the draft
  is not on (a swipe's neighbour). Filtering it by its days first would make
  that explicit.
- **The double click's one second** ([D154](#D154)): a second click of a
  double click is told from a click of its own by the grid's last press
  within 1 s, a fixed window, where the system's double-click time may be
  shorter or longer; the window's edge is untested. The click's own
  `detail` is all the browser tells.
- **A changed rule's occurrences in the draft** ([D155](#D155)): an edited
  series' draft moves the one occurrence the dialog edits; a new rule's
  other days, and a scope's (this and following, all) are drawn once saved.
  Drawing them needs the scope before Save (D108 asks after), or the rule
  applied to the whole series for the preview alone.
- **A series copied whole** — "Make a copy" and "Copy to…" copy the
  occurrence tapped as an item that does not repeat ([D164](#D164)); a
  choice to copy the whole series, its rule and exceptions with it, would
  be the scope question's.
- **Own colours with the account** — the user's colours are this device's
  ([D173](#D173)); with no place for them on a CalDAV server, a second
  device starts without them.
- **A calendar's colour changed here** — the colour dropdown offers it, as
  the server gives it ([D168](#D168)); setting it is a `PROPPATCH` of
  `calendar-color` the provider does not do yet.

- **A date picker of our own** — the edit dialog's dates are still the
  browser's date field; its calendar is no list, so [D167](#D167) left it.
  The month picker's grid is the natural start.
- **A task's due on the calendar** — since [D159](#D159) a task shows at
  its start only, and its due, however far, shows in its details alone;
  a mark on the due's day (Google's deadline flag) would show that a
  task is still open there. Until then a task started before today and due
  after it shows on its past start day only, in no "N undone tasks"
  ([D161](#D161)).
- **A task's due time through the all-day strip** — a timed task dragged
  into the strip becomes all day, its due a date ([D159](#D159): one "All
  day" for both ends), so dragged back onto the grid its due takes the
  slot's time, as many days after; the time it had is not kept.
- **Year view** ([D48](#D48)).
- **A long press in the Month view to create** — as Google's Android app
  does; a tap keeps opening the day ([D108](#D108)).
- **Dragging past the days shown** — Google moves to the next week when a
  drag rests at the view's side; here a drop lands on the first or last day
  shown, and the keys move on past them ([D111](#D111)).
- **Resizing an all-day item** — its edge in the strip or the Month, to
  more or fewer days; it moves, its length kept ([D111](#D111)).
- **Handles on a touch screen** — Google's Android app selects an item on
  a long press and shows round handles on its ends; here a finger resizes
  by the same 8 px edges as a mouse ([D111](#D111)).
- **Undo after a drop** — Google shows "Event saved · Undo"; a drop is
  undone by dragging it back ([D111](#D111)).
- **Keys between the strip and the grid** — a timed item made all day, or
  the other way, by a drag only ([D112](#D112)).
- **Dates in the app's own format** — the edit dialog's date field is the
  browser's, in its language and order; its times are a list in the user's
  clock ([D108](#D108)).
- **A view of starred tasks across lists** — the star is stored from PR 5
  ([D52](#D52)); a place that gathers starred tasks comes later.
- **Search beyond titles** — descriptions, locations, attendees, and the
  server's own search ([D53](#D53)).
- **A full-text index for search** — `LIKE` over the folded titles reads
  every row of the visible calendars; SQLite's FTS5 (on both drivers) when
  a store grows past what that answers at once ([D97](#D97)).
- **Making, renaming and deleting task lists** — "+ New list" and the
  card's menu are disabled: a list is a calendar on the server, made with
  `MKCALENDAR` through the provider and the sync engine ([D95](#D95)).
- **Advancing a series instead of an exception per occurrence** —
  completing a repeating task writes one exception per occurrence
  ([D94](#D94)); Tasks.org moves the series' start instead, which keeps
  the object small. When real data shows the cost.
- **Sorting per list, and "starred recently"** — one order serves every
  list, and the star keeps no time, so starred tasks come first in my
  order rather than by when they were starred ([D95](#D95)).
- **Demo data in the language chosen** — the demo is titled in the
  browser's language, not the one chosen in settings (development only,
  foundation [D57](foundation.md#D57)).
- **A day header opens that day** — as Google does; the headers are not
  buttons yet ([D59](#D59)).
- **A swipe the page follows** — the swipe moves to the next period once
  the finger lifts, with no slide ([D59](#D59)).
- **Week numbers by the locale's own rules** — every locale gets ISO's
  numbers; American numbering differs around the new year ([D59](#D59)).
- **The time grid on a day the clock changes** — the grid is the wall
  clock ([D59](#D59)): the hour a DST change skips is an empty tile, the
  hour it repeats is one tile for two, and the current-time line follows
  the wall clock, so it jumps an hour on the change, or goes back over the
  repeated hour. A grid of the elapsed hours (23 or 25) comes if the drift
  is reported.
- **The Month's chips by Tab on a touch screen with a keyboard** — a
  tablet with a keyboard and no mouse or pen gets the touch Month
  ([D86](#D86)): Tab reaches each day's number, not its chips, so an item
  is opened or moved by keys from the Day view ([D119](#D119)). Telling a
  keyboard user apart (a key pressed in the Month) could bring the
  chips' buttons back there.
- **Forced colours** (Windows' high contrast) — items keep their own fills
  and the rings their accent; the system's colours are not mapped
  ([D120](#D120)).
- **A screen reader's tour of the grid by arrow keys** — each day is a
  list and items are buttons reached by Tab; a grid with arrow keys between
  days and slots (ARIA's `grid`) is not built ([D120](#D120)).
- **Contrast of a calendar's colour against the dark grid** — an item's
  text reaches 4.5:1 on its fill, and on the light grid's white tiles the
  darkened fill reaches 4.57:1 as a shape, but a calendar colour as dark as
  the dark grid stays below 3:1 there; its title says what it is
  ([D120](#D120)). The same holds for the drawer's calendar checkbox on
  the dark drawer (1.4.11): its label names the calendar. A floor on the
  fill's lightness in the dark theme would close both.
- **Syncing one account** — "Sync now" syncs every account (the accounts
  dialog's button); one account alone needs `syncAll` to take an account
  filter, and its joining of runs ([foundation D129](foundation.md#D129):
  a trigger joins the run going) to know each run's scope, so a full
  trigger never joins a one-account run. Thread B's sync engine
  ([D137](#D137)).
- **A calendar's colour and name, changed here** — Settings and the drawer
  show and hide a calendar ([D131](#D131)); changing its colour or name is a
  write to the server (`PROPPATCH` of `calendar-color`, `displayname`)
  through the provider and the sync engine, or a colour kept on this device
  only. Google offers both per calendar. A menu on each calendar's row in
  the drawer comes with it.
- **The tab strip right to left** — the fade and the chosen tab's scroll
  are worked out left to right; AstroTime speaks English and Russian
  (foundation [D17](foundation.md#D17)), so a right-to-left language
  brings their mirror ([D135](#D135)).
- **The `geo:` link proven on an Android device** — "Open in maps" on
  Android is a `geo:` link the WebView hands to the system
  ([D177](#D177)); no device or emulator has opened it yet.
- **A privacy page** — what the place search sends where is said in its
  setting and in the README's self-hosting section ([D175](#D175)); the app
  has no page that gathers what goes where.
- **A dark map** — the place card's map is OpenStreetMap's standard tiles
  in both themes ([D177](#D177)); a dark style needs a tile server that has
  one.
- **Places from the address book** — Nextcloud's Calendar suggests
  contacts' addresses for a location; AstroTime reads no contacts
  ([D175](#D175)).
- **A window over the Agenda** — the days it reads only grow while it is
  open, and every day read stays in the page; dropping far days, or drawing
  only the rows on screen, comes when long scrolls need it ([D87](#D87)).

## PR plan

Foundation's PR 5 builds this plan in two parts:

- **PR 5a** — the app shell (top bar, drawer, floating button), the five
  views on the layout engine, both themes, i18n (D43–D51); in three PRs,
  as [foundation's PR plan](foundation.md#pr-5--calendar-grid) lists them
  (D58, D59 came with 5a-1; D86–D88 with 5a-2).
- **PR 5b** — the tasks screen, the drawer's settings and search (D52,
  D53; D94–D97 came with it).

Foundation's PR 6a (the details and edit dialogs) brought D108 and D109;
PR 6b (dragging and resizing) D111 and D112. Its evidence is screenshots of each view
next to the matching reference, in both themes.

The UI review after v0.2.0 brought D131–D133 (`feat/settings-screen`),
D134 (`feat/ui-consistency`), D135 (`fix/tasks-tab-strip`), D136
(`fix/closing-popups-and-strip`) and D137 (`feat/settings-accounts`,
`fix/review-leftovers-c`);
its evidence is screenshots before and after at the same sizes.

The accessibility pass (`fix/accessibility`) brought D119 and D120; its
evidence is the audit's run and screenshots of the colours before and after.
`fix/touch-targets` closed two of its Deferred items: the Month's day as
the target on a touch screen (D86, D119) and a period drawn once read (D59).
