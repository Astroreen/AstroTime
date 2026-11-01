// What the user may do in a calendar, as its server grants it
// (docs/plans/foundation.md#D37). Every check of whether an item can be
// created, changed or deleted asks here, so a share that lets one edit but
// not add or delete shows only what it allows.
import { NO_RIGHTS, type CalendarRights } from "@astrotime/core";
import type { Calendar } from "@astrotime/storage";

/**
 * A calendar's rights: `create` a new item in it, `edit` one it holds (a
 * task's completion and star too), `delete` one. A calendar the UI does not
 * know, or no longer, grants none.
 */
export function rightsOf(calendar: Pick<Calendar, "rights"> | null | undefined): CalendarRights {
  return calendar?.rights ?? NO_RIGHTS;
}
