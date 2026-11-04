// The strings that put a task's list in a task's words in the edit dialog
// and Settings (design D236), in a catalog of their own (`later.ts`) that
// loads with them, not with the app.
import { laterStrings } from "./later.ts";

export const taskStrings = {
  en: {
    "edit.colorList": "The list's colour",
    "edit.noList": "No list here can hold this task.",
    "edit.problem.task.noSplit":
      "This list takes no new tasks, so the series cannot be split here: change the date or the repeat, not both.",
    "edit.problem.task.refused":
      "This list no longer takes this task. Pick another list; nothing was saved.",
    "edit.problem.task.nowhere": "No list takes this task now. Nothing was saved.",
  },
  ru: {
    "edit.colorList": "Цвет списка",
    "edit.noList": "Здесь нет списка, в котором можно сохранить задачу.",
    "edit.problem.task.noSplit":
      "В этот список нельзя добавлять, поэтому серию здесь не разделить: измените дату или повтор, но не то и другое.",
    "edit.problem.task.refused":
      "Этот список больше не принимает эту задачу. Выберите другой список; ничего не сохранено.",
    "edit.problem.task.nowhere":
      "Сейчас ни один список не принимает эту задачу. Ничего не сохранено.",
  },
} as const satisfies Record<"en" | "ru", Record<string, string>>;

/** Adds the strings to an i18next instance in every language, once. */
export const addTaskStrings = laterStrings(taskStrings);
