// The edit dialog's problems in words (design D236): a module of its own,
// loaded with the dialog, not with the app (foundation D145).
import type { Problem } from "./editing.ts";

/** Why the edit dialog's form cannot be saved, or why saving it did not work. */
export type SaveProblem =
  | Problem
  | "failed"
  | "gone"
  | "refused"
  | "nowhere"
  | "inDoubt"
  | "noSplit";

/** The problems that name the item's calendar, which for a task is its list (design D236). */
const LISTED = new Set<SaveProblem>(["noSplit", "refused", "nowhere"]);

/** A save problem's catalog key, in a task's words for a task (design D236). */
export function problemKey(problem: SaveProblem, kind: "event" | "task") {
  if (problem === "failed") return "edit.failed" as const;
  if (kind === "task" && LISTED.has(problem))
    return `edit.problem.task.${problem as "noSplit" | "refused" | "nowhere"}` as const;
  return `edit.problem.${problem}` as const;
}
