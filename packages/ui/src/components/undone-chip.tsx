// The "N undone tasks" chip on today (design D51): one chip for every undone
// task due before today, which opens the list of them.
import { wallClockOf } from "@astrotime/core";
import type { UndoneTask } from "@astrotime/storage";
import { Popover } from "@base-ui/react/popover";
import { useTranslation } from "react-i18next";

import { addDays } from "../calendar/dates.ts";
import { useCalendar } from "./context.ts";
import { CheckCircleIcon } from "./icons.tsx";

export function UndoneChip({
  tasks,
  colorOf,
  dense = false,
}: {
  tasks: readonly UndoneTask[];
  colorOf: (task: UndoneTask) => string;
  /** The month's smaller chip (design D86). */
  dense?: boolean;
}) {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  const first = tasks[0];
  return (
    <Popover.Root>
      <Popover.Trigger
        className={`flex h-full w-full min-w-0 items-center bg-raised text-left leading-none font-medium text-ink hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent ${
          dense
            ? "gap-0.5 rounded-[4px] px-1 text-[11px]"
            : "gap-1.5 rounded-[5px] px-1.5 text-[13px]"
        }`}
      >
        <span
          aria-hidden="true"
          className={`grid shrink-0 place-items-center rounded-full text-raised ${dense ? "size-3" : "size-3.5"}`}
          style={{ background: first ? colorOf(first) : undefined }}
        >
          <CheckCircleIcon className={dense ? "size-3" : "size-3.5"} strokeWidth={2.5} />
        </span>
        <span
          className={`min-w-0 flex-1 overflow-hidden whitespace-nowrap ${dense ? "" : "text-ellipsis"}`}
        >
          {t("undone", { count: tasks.length })}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className="w-[min(22rem,calc(100vw-1.5rem))] origin-[var(--transform-origin)] rounded-xl bg-raised p-2 text-ink shadow-xl ring-1 ring-line transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Popover.Title className="px-2 pt-1 pb-2 text-sm font-semibold">
              {t("undone.title")}
            </Popover.Title>
            <ul className="flex max-h-[50vh] flex-col overflow-y-auto">
              {tasks.map((task) => {
                const { item, end } = task.occurrence;
                // A due date's end is the day after it (exclusive).
                const due =
                  end.type === "date"
                    ? formats.shortDate(previousDay(end.date))
                    : `${formats.shortDate(localDay(task, timeZone))}, ${formats.time(end, timeZone)}`;
                return (
                  <li
                    key={`${task.object.id}/${JSON.stringify(task.occurrence.recurrenceId)}`}
                    className="flex items-start gap-2 rounded-lg px-2 py-1.5"
                  >
                    <CheckCircleIcon
                      className="mt-px size-4 shrink-0"
                      style={{ color: colorOf(task) }}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[13.5px] break-words">
                        {item.summary?.trim() || t("item.untitled")}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {t("undone.due", { date: due })}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const previousDay = (day: string) => addDays(day, -1);
const localDay = (task: UndoneTask, timeZone: string) =>
  wallClockOf(task.occurrence.end, timeZone).slice(0, 10);
