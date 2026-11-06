// The fields quick create and the edit dialog share (design D296, D297): a
// row's looks, its date and its time, and the second press of a double click
// on an empty slot (D190). Here, not in the editor's chunk, so quick create
// loads them without the editor (foundation D145).
import type { Calendar } from "@astrotime/storage";
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Form } from "../calendar/editing.ts";
import { Dot } from "./color-select.tsx";
import { useCalendar } from "./context.ts";
import { Select as Dropdown } from "./select.tsx";

/** The click on an empty slot that opened a new item's dialog (design D190). */
export interface Press {
  readonly x: number;
  readonly y: number;
  /** The click's count: 1 for a single click, 2 for a double click's second. */
  readonly detail: number;
  /** Its `timeStamp`. */
  readonly at: number;
}

/**
 * A text field of a row: no box, its value on the dialog's ground (design
 * D297); a pale fill under the pointer, the accent's line under it while it
 * is typed in.
 */
export const field =
  "h-10 w-full min-w-0 rounded-lg bg-transparent px-2 text-input text-ink outline-none placeholder:text-ink-muted hover:bg-raised-hover focus:bg-raised-hover focus:shadow-[inset_0_-2px_0_var(--color-accent)] [color-scheme:inherit]";
/** A dropdown's button in a row, as a field (design D167, D297). */
export const fieldButton =
  "h-10 w-full min-w-0 rounded-lg bg-transparent pr-2 pl-2 hover:bg-raised-hover";

/**
 * A row of the form: its icon, then its value on the dialog's ground (design
 * D297), the icon level with the middle of its first control, a 40 px field
 * or row (design D205; `editing.spec.ts` measures it).
 */
export function Section({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-2.5 shrink-0 text-ink-muted">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    </div>
  );
}

/** An empty field's pale hint that is a button: "Add due" (design D297). */
export const hint =
  "flex min-h-10 items-center self-start rounded-lg px-2 text-row text-ink-muted hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent";

/** The title, large, a plain `<input>` (assistant D301 draws its marks behind it). */
export const titleField =
  "h-12 w-full min-w-0 rounded-lg bg-transparent px-2 text-headline text-ink outline-none placeholder:text-ink-muted hover:bg-raised-hover focus:shadow-[inset_0_-2px_0_var(--color-accent)]";

/** "Event | Task", a new item's kind (design D296). */
export function KindSwitch({
  value,
  onChange,
}: {
  value: Form["kind"];
  onChange: (kind: Form["kind"]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-label={t("edit.kind")} className="flex gap-2 px-2">
      {(["event", "task"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          role="radio"
          aria-checked={value === kind}
          onClick={() => value !== kind && onChange(kind)}
          className="rounded-full px-4 py-1.5 text-body font-medium ring-1 ring-line aria-checked:bg-accent-soft aria-checked:text-ink aria-checked:ring-transparent focus-visible:outline-2 focus-visible:outline-accent"
        >
          {t(`edit.kind.${kind}`)}
        </button>
      ))}
    </div>
  );
}

/** The calendar (a task's list) an item goes in, each with its colour's dot (design D297). */
export function CalendarSelect({
  label,
  value,
  onChange,
  calendars,
}: {
  label: string;
  value: string;
  onChange: (calendarId: string) => void;
  calendars: readonly Calendar[];
}) {
  return (
    <Dropdown
      label={label}
      value={value}
      onChange={onChange}
      options={calendars.map((c) => ({
        value: c.id,
        label: c.name,
        leading: <Dot color={c.color} />,
      }))}
      className={fieldButton}
    />
  );
}

export function DateTime({
  form,
  dateLabel,
  timeLabel,
  date,
  time,
  onDate,
  onTime,
  allDay,
}: {
  form: Form;
  /** A date alone, or a date and a time; the form's "All day" by default. */
  allDay?: boolean;
  dateLabel: string;
  timeLabel: string;
  date: string;
  time: string;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
}) {
  return (
    <div className="flex gap-2">
      <input
        type="date"
        aria-label={dateLabel}
        value={date}
        required
        onChange={(e) => e.target.value && onDate(e.target.value)}
        className={`${field} flex-[3]`}
      />
      {!(allDay ?? form.allDay) && <TimeSelect label={timeLabel} value={time} onChange={onTime} />}
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Every quarter of an hour, as Google's time list offers them. */
const QUARTERS = Array.from(
  { length: 96 },
  (_, i) => `${pad2(Math.floor(i / 4))}:${pad2((i % 4) * 15)}`,
);

/**
 * A time from a list in the user's clock (12 or 24 hours, design D96), which
 * the browser's own time field does not follow; a time between the quarters
 * the item already has stays in the list.
 */
export function TimeSelect({
  label,
  value,
  onChange,
  className = "flex-[2]",
}: {
  label: string;
  value: string;
  onChange: (time: string) => void;
  /** Its share of the row. */
  className?: string;
}) {
  const { formats } = useCalendar();
  const times = QUARTERS.includes(value) ? QUARTERS : [...QUARTERS, value].toSorted();
  return (
    <Dropdown
      label={label}
      value={value}
      onChange={onChange}
      options={times.map((time) => ({ value: time, label: formats.clock(time) }))}
      className={`${fieldButton} ${className}`}
    />
  );
}

/** How far apart, in px and ms, two presses are still one double click's. */
const SAME_SPOT = 8;
const DOUBLE_CLICK_MS = 500;

/**
 * Whether a click outside the dialog (its backdrop's, as Base UI closes a
 * dialog with a backdrop on a `click`, by mouse or touch) is the second of
 * the double click whose first click opened it (design D190): the first
 * click outside since it opened, one more in the click count, at about the
 * same spot, soon after. Any other is a click of its own.
 */
export function useSecondPress(opener: Press | undefined): (event: Event) => boolean {
  // Each opening's first click outside is the only one that may be its second.
  const asked = useRef<Press | undefined>(undefined);
  return (event) => {
    const first = opener && asked.current !== opener ? opener : undefined;
    asked.current = opener;
    return (
      first !== undefined &&
      // Base UI hands the `click` that closes a dialog with a backdrop, a
      // MouseEvent by mouse and by touch alike (drag.spec.ts tests both);
      // anything else closes it, as before D190.
      event instanceof MouseEvent &&
      event.detail === first.detail + 1 &&
      Math.abs(event.clientX - first.x) < SAME_SPOT &&
      Math.abs(event.clientY - first.y) < SAME_SPOT &&
      event.timeStamp - first.at < DOUBLE_CLICK_MS
    );
  };
}
