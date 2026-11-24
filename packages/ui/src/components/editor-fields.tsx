// The fields quick create and the edit dialog share (design D296, D297): a
// row's looks, its date and its time, and the second press of a double click
// on an empty slot (D190). Here, not in the editor's chunk, so quick create
// loads them without the editor (foundation D145).
import type { Account, Calendar } from "@astrotime/storage";
import { Popover } from "@base-ui/react/popover";
import { useRef, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { Form } from "../calendar/editing.ts";
import { accountName, Avatar } from "./accounts.tsx";
import { CalendarRow } from "./calendar-row.tsx";
import { Dot } from "./color-select.tsx";
import { useCalendar } from "./context.ts";
import { ChevronIcon } from "./icons.tsx";
import { popup, row, Select as Dropdown } from "./select.tsx";

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

/**
 * An account as the dialogs name it (design D313): its name, without the
 * server's address AstroTime put after the user name ("astro@cloud…" is
 * "astro"); a user name that is an address itself stays whole.
 */
function shortName(account: Account, t: TFunction): string {
  const name = accountName(account, t);
  const user = account.username;
  return user && !user.includes("@") && name.startsWith(`${user}@`) ? user : name;
}

/**
 * An account the item may go to (design D313), and the calendar choosing it
 * puts the item in: its first one offered, visible before hidden.
 */
export interface AccountChoice {
  readonly account: Account;
  readonly calendarId: string;
}

/**
 * Where an item goes (design D313), one row as Google Calendar's: the
 * account (its avatar and name) and, small under it, its calendars (a
 * task's lists). Pressed, it opens the accounts, then the chosen account's
 * calendars; a new item may be ticked into several (`multiple`), a copy in
 * each. One account offered: its calendars at once.
 */
export function CalendarFields({
  form,
  calendars,
  accounts,
  multiple,
  onChange,
}: {
  form: Form;
  calendars: readonly Calendar[];
  accounts: readonly AccountChoice[];
  multiple: boolean;
  onChange: (calendarId: string, alsoIn: readonly string[]) => void;
}) {
  const { t } = useTranslation();
  const event = form.kind === "event";
  const label = t(event ? "edit.calendar" : "edit.list");
  const chosen = calendars.find((c) => c.id === form.calendarId);
  const account = accounts.find((one) => one.account.id === chosen?.accountId)?.account;
  const alsoIn = multiple ? (form.alsoIn ?? []) : [];
  const ticked = [form.calendarId, ...alsoIn];
  const names = ticked.flatMap((id) => calendars.find((c) => c.id === id)?.name ?? []);
  const [open, setOpen] = useState(false);
  // The accounts first, unless one alone is offered.
  const [step, setStep] = useState<string | null>(null);
  const single = accounts.length < 2;
  const shownAccount = single ? (accounts[0]?.account.id ?? null) : step;
  if (calendars.length === 0)
    return (
      <p className="px-2 text-small text-danger">{t(event ? "edit.noCalendar" : "edit.noList")}</p>
    );
  const own = calendars.filter((c) => c.accountId === shownAccount);
  const toggle = (id: string) => {
    if (!multiple || chosen?.accountId !== shownAccount) {
      // Another account's calendar, or one calendar only: it alone.
      onChange(id, []);
      if (!multiple) setOpen(false);
      return;
    }
    if (!ticked.includes(id)) {
      onChange(form.calendarId, [...alsoIn, id]);
      return;
    }
    // The last one ticked stays: an item goes somewhere.
    if (ticked.length === 1) return;
    const rest = ticked.filter((one) => one !== id);
    onChange(rest[0]!, rest.slice(1));
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setStep(null);
      }}
    >
      <Popover.Trigger className="flex min-h-10 w-full min-w-0 items-center gap-3 rounded-lg px-2 py-0.5 text-left hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent">
        {/* Its name is what it shows, after the field's: "Calendar: Work account, Personal". */}
        <span className="sr-only">{label}: </span>
        {account && <Avatar account={account} size="size-7" />}
        <span className="flex min-w-0 flex-1 flex-col">
          {account && (
            <span className="truncate text-body leading-5 text-ink">
              {shortName(account, t)}
              <span className="sr-only">, </span>
            </span>
          )}
          <span className="flex min-w-0 items-center gap-1.5 text-small leading-4 text-ink-muted">
            <Dot color={chosen?.color ?? null} className="size-2.5" />
            <span className="truncate">{names.join(", ")}</span>
          </span>
        </span>
        <ChevronIcon direction="down" className="size-5 shrink-0 text-ink-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="start" className="z-[140]">
          <Popover.Popup className={`${popup} w-72`}>
            {shownAccount === null ? (
              <>
                <Popover.Title className="px-2 py-1.5 text-small text-ink-muted">
                  {t("edit.account")}
                </Popover.Title>
                {accounts.map(({ account: one }) => (
                  <button
                    key={one.id}
                    type="button"
                    onClick={() => setStep(one.id)}
                    className={`${row} w-full text-left`}
                  >
                    <Avatar account={one} size="size-7" />
                    <span className="min-w-0 flex-1 truncate">{shortName(one, t)}</span>
                    <ChevronIcon direction="right" className="size-4 shrink-0 text-ink-muted" />
                  </button>
                ))}
              </>
            ) : (
              <>
                <div className="flex items-center gap-1 px-1 py-1">
                  {!single && (
                    <button
                      type="button"
                      aria-label={t("edit.accounts")}
                      onClick={() => setStep(null)}
                      className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-raised-hover"
                    >
                      <ChevronIcon direction="left" className="size-5" />
                    </button>
                  )}
                  <Popover.Title className="min-w-0 truncate px-1 text-small text-ink-muted">
                    {shortName(accounts.find((one) => one.account.id === shownAccount)!.account, t)}
                  </Popover.Title>
                </div>
                <div role="group" aria-label={label}>
                  {own.map((calendar) => (
                    <CalendarRow
                      key={calendar.id}
                      calendar={calendar}
                      color={calendar.color ?? "var(--color-ink-muted)"}
                      shown={chosen?.accountId === shownAccount && ticked.includes(calendar.id)}
                      onToggle={(id) => toggle(id)}
                      className="min-h-10 rounded-lg hover:bg-raised-hover pointer-coarse:min-h-12"
                    />
                  ))}
                </div>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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
