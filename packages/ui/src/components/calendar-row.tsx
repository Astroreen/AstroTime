// A calendar's row, the same in the drawer and in Settings (design D131,
// D137): a checkbox in the calendar's colour, its fill the colour its items
// are drawn in (D120), and its name. Checked, the views show the calendar.
import type { Calendar } from "@astrotime/storage";
import { Checkbox } from "@base-ui/react/checkbox";
import type { CSSProperties } from "react";

import { CheckIcon } from "./icons.tsx";

export function CalendarRow({
  calendar,
  color,
  shown,
  onToggle,
  className,
}: {
  calendar: Calendar;
  color: string;
  shown: boolean;
  onToggle: (calendarId: string, shown: boolean) => void;
  /** The row's size and hover, as the place it sits in draws its rows. */
  className: string;
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-4 px-4 text-body ${className}`}>
      <Checkbox.Root
        checked={shown}
        onCheckedChange={(checked) => onToggle(calendar.id, checked)}
        className="item-color grid size-[18px] shrink-0 place-items-center rounded-[4px] border-2 border-[var(--item-fill)] data-checked:bg-[var(--item-fill)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{ "--item": color } as CSSProperties}
      >
        <Checkbox.Indicator className="flex text-white data-unchecked:hidden">
          <CheckIcon className="size-3.5" strokeWidth="2.6" />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
    </label>
  );
}
