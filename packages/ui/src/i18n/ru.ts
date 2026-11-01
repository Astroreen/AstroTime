// The Russian catalog. Its keys are the English ones, except that a plural
// has the categories Russian needs (`_one`, `_few`, `_many`, `_other`);
// `index.ts` checks both at compile time and `catalogs.test.ts` at run time.
export const ru = {
  "app.name": "AstroTime",

  "store.opening": "Открываем календарь…",
  "store.inUse.title": "AstroTime открыт в другой вкладке",
  "store.inUse.body": "Закройте его там и обновите эту вкладку.",
  "store.insecure.title": "Этот адрес не защищён",
  "store.insecure.body":
    "Браузер хранит данные AstroTime только для страниц, открытых по https (или на localhost). Откройте AstroTime по его https-адресу.",
  "store.failed.title": "Не удалось открыть календарь",
  "store.failed.body": "Обновите страницу, чтобы попробовать ещё раз.",
  "store.reload": "Обновить",

  "topBar.menu": "Главное меню",
  "topBar.today": "Сегодня",
  "topBar.period": "{{period}}, выбрать дату",

  "nav.previous.day": "Предыдущий день",
  "nav.previous.3days": "Предыдущие 3 дня",
  "nav.previous.week": "Предыдущая неделя",
  "nav.next.day": "Следующий день",
  "nav.next.3days": "Следующие 3 дня",
  "nav.next.week": "Следующая неделя",
  "nav.previous.month": "Предыдущий месяц",
  "nav.next.month": "Следующий месяц",
  "nav.previous.agenda": "Предыдущий месяц",
  "nav.next.agenda": "Следующий месяц",

  "picker.previousMonth": "Предыдущий месяц",
  "picker.nextMonth": "Следующий месяц",

  "view.day": "День",
  "view.3days": "3 дня",
  "view.week": "Неделя",
  "view.month": "Месяц",
  "view.agenda": "Расписание",

  "drawer.views": "Вид",
  "drawer.calendars": "Календари",
  "drawer.noCalendars": "Календарей пока нет",

  "fab.create": "Создать",

  "grid.week": "Неделя {{number}}",
  "grid.allDay": "Весь день",
  "grid.more": "+{{count}}",
  "grid.moreLabel": "Ещё {{count}}, {{day}}",
  "grid.expand": "Показать все записи на весь день",
  "grid.collapse": "Свернуть записи на весь день",

  "month.more_one": "Ещё {{count}} запись, {{day}}",
  "month.more_few": "Ещё {{count}} записи, {{day}}",
  "month.more_many": "Ещё {{count}} записей, {{day}}",
  "month.more_other": "Ещё {{count}} записи, {{day}}",

  "agenda.dayOf": "День {{index}} из {{total}}",
  "agenda.nothingToday": "На сегодня ничего не запланировано",
  "agenda.earlier": "Показать раньше",
  "agenda.later": "Показать позже",

  "item.untitled": "(Без названия)",
  "item.event": "{{title}}, {{time}}",
  "item.task": "Задача: {{title}}, {{time}}",
  "item.taskDone": "Выполненная задача: {{title}}, {{time}}",

  undone_one: "{{count}} невыполненная задача",
  undone_few: "{{count}} невыполненные задачи",
  undone_many: "{{count}} невыполненных задач",
  undone_other: "{{count}} невыполненной задачи",
  "undone.title": "Невыполненные задачи",
  "undone.due": "Срок: {{date}}",
};
