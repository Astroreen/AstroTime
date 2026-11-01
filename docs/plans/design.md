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
  agent, beyond the owner's answer:_ a manual override in the drawer's
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
- **D47. An item's colour is its calendar's**, as the server gives it
  (Apple's `calendar-color` property, which `CalDavProvider` reads into
  `RemoteCalendar.color`), unless the item has its own RFC 7986 `COLOR`.

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
  in bold-ish text wrapping inside; an item drawn over another (D15) gets a
  thin outline in the background colour, so the edge between them shows.
  In the all-day strip, items are chips one line high. In the time grid a
  task with only a due (or start) time is a chip as D42 sizes it (30
  minutes tall, one line of text); a task with a timed start and due is a
  block like an event.
- **D51. Tasks on the calendar.** A task's chip carries a check-circle icon;
  a completed task stays, struck through, in a muted colour. Undone tasks
  whose due (a date, a time, the end of a start–due block, or the start of
  a task with a start and no due) is before the
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
  it in place.
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
- **D53. Settings in the drawer**: the theme (system, dark, light), the
  week start and the clock (D44, D45), and "hide completed" (D51). Search,
  in the top bar, finds items by title in the local store. _Built in
  PR 5b:_ the settings [D96](#D96), search [D97](#D97).

### Decided while building PR 5a

- **D58. The look is tokens in one stylesheet** (`packages/ui/src/styles.css`).
  Colours are CSS custom properties written with `light-dark()`; the root's
  `color-scheme` follows the system, and `data-theme="light"` or `"dark"` on
  the root element overrides it, so D53's setting only sets that attribute.
  An item's text is black or white by its fill's luminance (CSS relative
  colours), so any calendar colour reads (D47; the rule is [D120](#D120)'s,
  which replaced OKLCH lightness); a done task's fill is its colour mixed
  45% into the grid's. Fonts are the system's and the
  icons AstroTime's own SVG, so nothing loads from another origin (D43). An
  hour is 56 px tall; from 1024 px wide the drawer is a sidebar (D46).
- **D59. Details read from the reference for the time grid:**
  - the top bar names the month, both months across a change of month
    ("October – November"), and the year only when it is not this one; prev
    and next buttons sit in it on a wide screen, a horizontal swipe moves on
    a touch screen, and `n`/`j`, `p`/`k` and `t` move on a keyboard; search,
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
    day;
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
  is squeezed in the sidebar. _Since:_ "Reminders", a switch, last
  ([foundation D101](foundation.md#D101)); after it, on the desktop only
  (the `Platform`'s `shell`), "Keep running when the window is closed",
  on unless turned off, with a line saying how to quit while it is on
  ([desktop D75](desktop.md#D75)).
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
    own); a task's start and due, each with a switch; the zone when it is
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
    location; the description. A new start keeps the event's length; a new
    start date (a task's due without a start) moves its end, and the rule
    with it ([foundation D105](foundation.md#D105)). An end
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
  its status and progress, its priority, its tags, its parent and its
  subtasks' titles, with "Mark completed" (an occurrence of a series in its
  exception, as D94 completes it) and the star. The edit dialog adds the
  status (not started, in progress, completed, cancelled), the priority as
  Nextcloud Tasks offers it (none; high, medium, low written as 1, 5, 9;
  read 1–4, 5, 6–9), the progress in percent and the tags, comma-separated
  (`CATEGORIES`). Each list on the tasks screen has "Add a task" at the top
  of its card, which makes an undated task in that list, as the tasks
  screen's "+" button does on a phone.

### Decided while building PR 6b

- **D111. Dragging and resizing, as Google Calendar's** (foundation
  [D14](foundation.md#D14), [D16](foundation.md#D16); what a drop writes:
  foundation [D113](foundation.md#D113)):
  - **what drags**: every item of a calendar whose rights let it be edited
    (foundation [D37](foundation.md#D37)), in the time grid (a block, a
    task's chip), the all-day strip and the Month; a read-only calendar's
    items, the undone tasks chip and the Agenda's cards do not. A tap still
    opens the details;
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
  elements), each with its reason; there is one: **target size** (2.5.8)
  is not checked on the Month's chips, "+N" and undone chip, one line of
  16 px every 17 px as dense as the reference ([D86](#D86)). The
  criterion's _equivalent_ exception is the reason: the day's number, a
  24 px target, opens the day, where every item is a larger target of its
  own. The spec also proves what axe cannot see ([D120](#D120)).
- **D120. What the pass changed, and the rules it leaves:**
  - **an item's text on its colour** is black or white, whichever has more
    contrast by WCAG's relative luminance, computed in CSS from the fill's
    linear-light channels (`color(from … srgb-linear …)` in `styles.css`).
    The two contrasts are equal at a luminance of 0.1791, where each is
    4.58:1, so every calendar colour gets 4.5:1, small text's contrast,
    with no exception for large text needed. OKLCH lightness (D58) gave
    Nextcloud's own blue `#0082c9` white text at 4.2:1, and the demo's green
    3.3:1. A done task keeps its muted fill (45% into the grid's) and its
    strike-through but no longer fades its text, and an item's time is set
    apart by its weight, not by opacity: faded, both fell below 4.5:1. The
    drawer's checkbox mark on a calendar's colour follows the same rule;
  - **muted text** is `ink-muted` at full strength: the faded variants
    (a day outside the month, the drawer's sync line, placeholders) were
    3.5:1;
  - **targets** are at least 24 × 24 px (2.5.8): the Month's day numbers,
    the strip's rows (24 px, were 22) and so its chips and "+N"; the
    Month's own chips are D119's exemption;
  - **names say what shows** (2.5.3): "Today" names the day its icon shows
    ("Today, Wednesday, November 4"), and a search result's or a task
    list tab's text keeps its words apart as its name says them;
  - **focus**: every focusable element without a ring of its own gets the
    accent's 2 px outline (the stylesheet's `:focus-visible`), the tasks
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
    the accounts dialog each account's sync line is a status, so Sync now
    is heard to run and end, and a sync that comes to need the user is
    said once, as the account button's dot shows it;
  - **less motion**: with `prefers-reduced-motion: reduce` nothing slides,
    fades or scales (transitions take no time); the sync spinner turns on,
    as it says that sync runs;
  - **reflow**: at 320 px wide (1280 px at 400% zoom) every view needs no
    sideways scroll and the top bar's buttons and "+" stay on screen;
  - **language**: the document's `lang` is the UI's language (D53), so a
    screen reader reads Russian as Russian.

## Deferred

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
- **Larger targets in the Month on a touch screen** — its chips are 16 px
  high and exempt from WCAG 2.5.8 through the day's number ([D119](#D119));
  Google's Android app opens the day on any tap of a tile instead.
- **Forced colours** (Windows' high contrast) — items keep their own fills
  and the rings their accent; the system's colours are not mapped
  ([D120](#D120)).
- **A screen reader's tour of the grid by arrow keys** — each day is a
  list and items are buttons reached by Tab; a grid with arrow keys between
  days and slots (ARIA's `grid`) is not built ([D120](#D120)).
- **Contrast of a calendar's colour against the grid** — an item's text
  reaches 4.5:1 on its fill, but a pale fill on the light grid's white
  tiles can fall below 3:1 as a shape; its title says what it is
  ([D120](#D120)).
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

The accessibility pass (`fix/accessibility`) brought D119 and D120; its
evidence is the audit's run and screenshots of the colours before and after.
