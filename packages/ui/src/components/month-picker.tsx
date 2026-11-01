// The month and year in the top bar, a button that opens a month to pick a
// day from (design D46).
import { Popover } from "@base-ui/react/popover";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { addMonths, firstOfMonth, monthDays } from "../calendar/dates.ts";
import { useCalendar } from "./context.ts";
import { CaretIcon, ChevronIcon } from "./icons.tsx";

export function MonthPicker({
  title,
  anchor,
  today,
  weekStart,
  onPick,
}: {
  title: string;
  anchor: string;
  today: string;
  weekStart: number;
  onPick: (day: string) => void;
}) {
  const { t } = useTranslation();
  const { formats } = useCalendar();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => firstOfMonth(anchor));
  const days = monthDays(month, weekStart);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(firstOfMonth(anchor));
        setOpen(next);
      }}
    >
      <Popover.Trigger
        aria-label={t("topBar.period", { period: title })}
        className="flex min-w-0 items-center gap-0.5 rounded-lg py-1 pr-1 pl-2 text-headline leading-tight hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="truncate">{title}</span>
        <CaretIcon className="size-5 shrink-0" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="start" className="z-50">
          <Popover.Popup className="w-72 origin-[var(--transform-origin)] rounded-xl bg-raised p-3 text-ink shadow-xl ring-1 ring-line transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label={t("picker.previousMonth")}
                onClick={() => setMonth(addMonths(month, -1))}
                className="grid size-8 place-items-center rounded-full hover:bg-raised-hover"
              >
                <ChevronIcon direction="left" className="size-5" />
              </button>
              <Popover.Title className="text-body font-semibold" aria-live="polite">
                {formats.monthYear(month)}
              </Popover.Title>
              <button
                type="button"
                aria-label={t("picker.nextMonth")}
                onClick={() => setMonth(addMonths(month, 1))}
                className="grid size-8 place-items-center rounded-full hover:bg-raised-hover"
              >
                <ChevronIcon direction="right" className="size-5" />
              </button>
            </div>
            <div
              className="grid grid-cols-7 text-center text-tiny text-ink-muted"
              aria-hidden="true"
            >
              {formats.weekdayInitials().map((initial, i) => (
                <span key={i} className="py-1">
                  {initial}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5">
              {days.map((day) => {
                const outside = day.slice(0, 7) !== month.slice(0, 7);
                const isToday = day === today;
                const selected = day === anchor;
                return (
                  <button
                    key={day}
                    type="button"
                    aria-label={formats.fullDate(day)}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => {
                      onPick(day);
                      setOpen(false);
                    }}
                    className={[
                      "mx-auto grid size-8 place-items-center rounded-full text-small",
                      isToday
                        ? "bg-accent font-semibold text-on-accent"
                        : selected
                          ? "bg-accent-soft font-medium"
                          : "hover:bg-raised-hover",
                      outside && !isToday ? "text-ink-muted" : "",
                    ].join(" ")}
                  >
                    {formats.dayNumber(day)}
                  </button>
                );
              })}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
