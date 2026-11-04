// A task's list is a list (design D236): every save problem the edit dialog
// shows a task, in both languages, says list where an event's says calendar.
import { expect, test } from "vite-plus/test";

import { problemKey, type SaveProblem } from "../src/calendar/problems.ts";
import { catalogs as app } from "../src/i18n/index.ts";
import { taskStrings } from "../src/i18n/tasks.ts";

// The app's strings and the task's, which load with the edit dialog.
const catalogs = {
  en: { ...app.en, ...taskStrings.en },
  ru: { ...app.ru, ...taskStrings.ru },
};

const PROBLEMS: readonly SaveProblem[] = [
  "endBeforeStart",
  "dueBeforeStart",
  "untilBeforeStart",
  "noDate",
  "failed",
  "gone",
  "refused",
  "nowhere",
  "inDoubt",
  "noSplit",
];

test("no problem a task can meet speaks of a calendar; an event's still do where they name one", () => {
  for (const problem of PROBLEMS) {
    const task = problemKey(problem, "task");
    expect([problem, catalogs.en[task]]).not.toEqual([problem, expect.stringMatching(/calendar/i)]);
    expect([problem, catalogs.ru[task]]).not.toEqual([problem, expect.stringMatching(/календар/i)]);
    expect(catalogs.en, task).toHaveProperty(task);
    expect(catalogs.ru, task).toHaveProperty(task);
  }
  for (const problem of ["refused", "nowhere", "noSplit"] as const) {
    expect(catalogs.en[problemKey(problem, "event")]).toMatch(/calendar/);
    expect(catalogs.en[problemKey(problem, "task")]).toMatch(/list/);
    expect(catalogs.ru[problemKey(problem, "task")]).toMatch(/список/);
  }
});
