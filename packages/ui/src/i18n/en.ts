// The English catalog: the source of the message keys (`t()` is typed by it).
// Keys are flat; a plural key ends in its CLDR category (`_one`, `_other`).
export const en = {
  "app.name": "AstroTime",

  "store.opening": "Opening your calendar…",
  "store.inUse.title": "AstroTime is open in another tab",
  "store.inUse.body": "Close it there, then reload this tab.",
  "store.insecure.title": "This address is not secure",
  "store.insecure.body":
    "Your browser keeps AstroTime's data only for pages opened over https (or on localhost). Open AstroTime at its https address.",
  "store.failed.title": "Your calendar could not be opened",
  "store.failed.body": "Reload the page to try again.",
  "store.reload": "Reload",

  "topBar.menu": "Main menu",
  "topBar.today": "Today",
  "topBar.period": "{{period}}, choose a date",

  "nav.previous.day": "Previous day",
  "nav.previous.3days": "Previous 3 days",
  "nav.previous.week": "Previous week",
  "nav.next.day": "Next day",
  "nav.next.3days": "Next 3 days",
  "nav.next.week": "Next week",
  "nav.previous.month": "Previous month",
  "nav.next.month": "Next month",
  "nav.previous.agenda": "Previous month",
  "nav.next.agenda": "Next month",

  "picker.previousMonth": "Previous month",
  "picker.nextMonth": "Next month",

  "view.day": "Day",
  "view.3days": "3 days",
  "view.week": "Week",
  "view.month": "Month",
  "view.agenda": "Agenda",

  "drawer.views": "Views",
  "drawer.calendars": "Calendars",
  "drawer.noCalendars": "No calendars yet",

  "fab.create": "Create",

  "grid.week": "Week {{number}}",
  "grid.allDay": "All day",
  "grid.more": "+{{count}}",
  "grid.moreLabel": "{{count}} more on {{day}}",
  "grid.expand": "Show all all-day items",
  "grid.collapse": "Show fewer all-day items",

  "month.more_one": "{{count}} more item on {{day}}",
  "month.more_other": "{{count}} more items on {{day}}",

  "agenda.dayOf": "Day {{index}} of {{total}}",
  "agenda.nothingToday": "Nothing planned today",
  "agenda.earlier": "Show earlier",
  "agenda.later": "Show later",

  "item.untitled": "(No title)",
  "item.event": "{{title}}, {{time}}",
  "item.task": "Task: {{title}}, {{time}}",
  "item.taskDone": "Completed task: {{title}}, {{time}}",

  undone_one: "{{count}} undone task",
  undone_other: "{{count}} undone tasks",
  "undone.title": "Undone tasks",
  "undone.due": "Due {{date}}",
};

export type Catalog = typeof en;
