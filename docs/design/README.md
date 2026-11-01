# Design references

The owner's reference for AstroTime's look and layout is Google Calendar and
Google Tasks on Android, dark theme (seen 2026-10-31). The screenshots are of
the owner's own accounts, so they are not in this public repository; this
page describes what each showed, and the decisions read from them are in
[`../plans/design.md`](../plans/design.md).

| View   | What the reference showed                                                                                                                                                                                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Week   | top bar (menu, "October ▾", search, today, tasks, account); the week number left of the day headers; the all-day strip with event chips and task chips (completed ones struck through); the hour grid as rounded tiles; timed events as filled rounded blocks; the "+" button          |
| 3 days | the same with three wider columns                                                                                                                                                                                                                                                      |
| Day    | completed tasks in the strip, struck through; a later event drawn over an earlier one, shifted right, with an outline                                                                                                                                                                  |
| Today  | the date in an accent circle; the strip collapsed to its first rows, an "N undone tasks" chip and "+3", with a chevron to expand; a white current-time line with a dot                                                                                                                 |
| Month  | week numbers in a pill column; each day a tile with stacked one-line chips; today's number highlighted                                                                                                                                                                                 |
| Tasks  | a back arrow and "Tasks"; list tabs with counts of undone tasks (none on the open one) and "+ New list"; a card per list with its name, sort and menu buttons, tasks with a circle and a star, long titles wrapping; "Completed (N)" folded below in a card of its own; the "+" button |
