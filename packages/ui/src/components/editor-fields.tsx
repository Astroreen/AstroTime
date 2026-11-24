// The fields quick create and the edit dialog share (design D296, D297): a
// row's looks, its date and its time, and the second press of a double click
// on an empty slot (D190). Here, not in the editor's chunk, so quick create
// loads them without the editor (foundation D145).
import type { Account, Calendar } from "@astrotime/storage";
import { Popover } from "@base-ui/react/popover";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { nowIn } from "../calendar/dates.ts";
import type { Form } from "../calendar/editing.ts";
import { accountName, Avatar } from "./accounts.tsx";
import { CalendarRow } from "./calendar-row.tsx";
import { Dot } from "./color-select.tsx";
import { useCalendar } from "./context.ts";
import { ChevronIcon } from "./icons.tsx";
import { popup, Select as Dropdown } from "./select.tsx";

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

/** A time in a row: as wide as its words (design D317). */
const timeButton =
  "h-10 shrink-0 rounded-lg bg-transparent px-2 whitespace-nowrap hover:bg-raised-hover";

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
  tight = false,
}: {
  value: Form["kind"];
  onChange: (kind: Form["kind"]) => void;
  /** Narrower chips, beside "Save" on a phone (design D315). */
  tight?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={t("edit.kind")}
      className={`flex gap-2 ${tight ? "" : "px-2"}`}
    >
      {(["event", "task"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          role="radio"
          aria-checked={value === kind}
          onClick={() => value !== kind && onChange(kind)}
          className={`rounded-full ${tight ? "px-2.5" : "px-4"} py-1.5 text-body font-medium whitespace-nowrap ring-1 ring-line aria-checked:bg-accent-soft aria-checked:text-ink aria-checked:ring-transparent focus-visible:outline-2 focus-visible:outline-accent`}
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
  end,
}: {
  form: Form;
  calendars: readonly Calendar[];
  accounts: readonly AccountChoice[];
  multiple: boolean;
  onChange: (calendarId: string, alsoIn: readonly string[]) => void;
  /** At the row's end, in place of the calendar's dot and the arrow: the edit dialog's colour (design D317). */
  end?: ReactNode;
}) {
  const { t } = useTranslation();
  const event = form.kind === "event";
  const label = t(event ? "edit.calendar" : "edit.list");
  const chosen = calendars.find((c) => c.id === form.calendarId);
  const account = accounts.find((one) => one.account.id === chosen?.accountId)?.account;
  // The other ticks as they stand: once each, in the chosen one's account,
  // still offered (a sync may have changed the calendars meanwhile).
  const alsoIn = multiple
    ? [...new Set(form.alsoIn ?? [])].filter(
        (id) =>
          id !== form.calendarId &&
          calendars.some((c) => c.id === id && c.accountId === chosen?.accountId),
      )
    : [];
  const ticked = [form.calendarId, ...alsoIn];
  const names = ticked.flatMap((id) => calendars.find((c) => c.id === id)?.name ?? []);
  const [open, setOpen] = useState(false);
  // The accounts first, unless one alone is offered; an account gone
  // meanwhile leads back to them.
  const [step, setStep] = useState<string | null>(null);
  const single = accounts.length < 2;
  const shown =
    accounts.find((one) => one.account.id === (single ? accounts[0]?.account.id : step)) ?? null;
  const shownAccount = shown?.account.id ?? null;
  // A new step keeps the focus in the list: on its first control.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, [open, shownAccount]);
  if (calendars.length === 0)
    return (
      <p className="px-2 text-small text-danger">{t(event ? "edit.noCalendar" : "edit.noList")}</p>
    );
  const own = calendars.filter((c) => c.accountId === shownAccount);
  const pickAccount = (choice: AccountChoice) => {
    // Another account: the item goes to its first calendar (its own, for an item that exists).
    if (choice.account.id !== chosen?.accountId) onChange(choice.calendarId, []);
    setStep(choice.account.id);
  };
  const toggle = (id: string) => {
    if (!multiple) {
      onChange(id, []);
      setOpen(false);
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
    <div className="flex min-w-0 items-center gap-1">
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setStep(null);
        }}
      >
        <Popover.Trigger className="flex min-h-10 w-full min-w-0 items-center gap-3 rounded-lg px-2 py-0.5 text-left hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent">
          {/* Its name is what it shows, after the field's: "Calendar: astro, Personal". */}
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
              {end === undefined && <Dot color={chosen?.color ?? null} className="size-2.5" />}
              <span className="truncate">{names.join(", ")}</span>
            </span>
          </span>
          {end === undefined && (
            <ChevronIcon direction="down" className="size-5 shrink-0 text-ink-muted" />
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={4} align="start" collisionPadding={8} className="z-[140]">
            <Popover.Popup className={`${popup} w-72`}>
              <div ref={listRef}>
                {shown === null ? (
                  <>
                    <Popover.Title className="px-2 py-1.5 text-small text-ink-muted">
                      {t("edit.account")}
                    </Popover.Title>
                    {accounts.map((choice) => {
                      const current = choice.account.id === chosen?.accountId;
                      // Its calendars, small: two accounts of one user name differ by them.
                      const its = calendars.filter((c) => c.accountId === choice.account.id);
                      return (
                        <button
                          key={choice.account.id}
                          type="button"
                          aria-current={current ? "true" : undefined}
                          onClick={() => pickAccount(choice)}
                          className="flex min-h-12 w-full items-center gap-3 rounded-lg py-1 pr-3 pl-2 text-left text-body hover:bg-raised-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent aria-[current=true]:bg-accent-soft"
                        >
                          <Avatar account={choice.account} size="size-7" />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate leading-5">
                              {shortName(choice.account, t)}
                            </span>
                            <span className="truncate text-small leading-4 text-ink-muted">
                              {its.map((c) => c.name).join(", ")}
                            </span>
                          </span>
                          <ChevronIcon
                            direction="right"
                            className="size-4 shrink-0 text-ink-muted"
                          />
                        </button>
                      );
                    })}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1 px-1 py-1">
                      {!single && (
                        <button
                          type="button"
                          aria-label={t("edit.accounts")}
                          onClick={() => setStep(null)}
                          className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          <ChevronIcon direction="left" className="size-5" />
                        </button>
                      )}
                      <Popover.Title className="min-w-0 truncate px-1 text-small text-ink-muted">
                        {shortName(shown.account, t)}
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
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {end}
    </div>
  );
}

/**
 * A date in words ("Wed, Nov 4", design D317) over the browser's date field,
 * which still takes the press (its picker), the keys and a screen reader: the
 * words give way to the field's own digits while a key is typed in it.
 */
export function DateField({
  label,
  value,
  onChange,
  className = "",
  muted = false,
}: {
  label: string;
  value: string;
  onChange: (date: string) => void;
  /** Its share of the row. */
  className?: string;
  /** Paler: an end on its start's day, which says nothing new. */
  muted?: boolean;
}) {
  const { formats, timeZone } = useCalendar();
  // The year the words leave out: this one, as the dialog opened.
  const [today] = useState(() => nowIn(Date.now(), timeZone).today);
  // Typed in: its own digits show in place of the words.
  const [typing, setTyping] = useState(false);
  // Room for the digits, from the key that starts typing until the press or
  // key that left the field is over: nothing changes size under a press.
  const [wide, setWide] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  // As the listeners below read them: whether it is typed in now, whether a
  // press is down, and whether Tab went down inside it.
  const typed = useRef(false);
  const pressing = useRef(false);
  const tabbed = useRef(false);
  const type = () => {
    typed.current = true;
    setTyping(true);
    setWide(true);
  };
  useEffect(() => {
    if (!wide) return;
    // There from the key that made the room, so no leaving is missed. A key
    // let go while a press is still down is not the leaving's end: the press's is.
    const press = () => {
      pressing.current = true;
    };
    const narrow = (event: Event) => {
      if (event.type !== "keyup") pressing.current = false;
      else if (pressing.current) return;
      if (!typed.current) setWide(false);
    };
    const ends = ["click", "auxclick", "keyup", "pointercancel", "contextmenu"] as const;
    window.addEventListener("pointerdown", press, true);
    for (const end of ends) window.addEventListener(end, narrow, true);
    window.addEventListener("blur", narrow);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      for (const end of ends) window.removeEventListener(end, narrow, true);
      window.removeEventListener("blur", narrow);
    };
  }, [wide]);
  return (
    // The row's look, and the press that opens the picker, are the wrapper's:
    // the field itself is not drawn under the words.
    <span
      onClick={(e) => {
        const own = input.current;
        // Typed in, a press is the field's own: on one of its digits.
        if (!own || typing) return;
        // A press anywhere on the words opens the picker, in every browser
        // and by a finger too; one that cannot is left to the browser.
        try {
          own.focus();
          own.showPicker();
          e.preventDefault();
        } catch {
          // The field is still typed in.
        }
      }}
      className={`relative inline-flex h-10 items-center rounded-lg text-input hover:bg-raised-hover has-[:focus]:bg-raised-hover has-[:focus]:shadow-[inset_0_-2px_0_var(--color-accent)] forced-colors:has-[:focus]:outline-2 ${wide ? "min-w-[10.5em]" : ""} ${className}`}
    >
      <input
        ref={input}
        type="date"
        aria-label={label}
        value={value}
        required
        max="9999-12-31"
        // A year of four digits: one of five has no words (`Intl` refuses it).
        onChange={(e) => DAY.test(e.target.value) && onChange(e.target.value)}
        // Only a key that changes the date: not Tab coming in, Escape or
        // Enter from its picker, or a shortcut (Alt and the arrow opens it).
        onKeyDown={(e) => {
          const plain = !e.altKey && !e.ctrlKey && !e.metaKey;
          // Shift held for Tab backwards is no other key.
          if (e.key === "Tab") tabbed.current = plain;
          else if (e.key !== "Shift") tabbed.current = false;
          if (plain && EDITS.test(e.key)) type();
        }}
        // Tab that stayed inside went on to the date's next part, which is
        // seen only in the digits.
        onKeyUp={(e) => {
          if (e.key !== "Tab") return;
          if (tabbed.current && document.activeElement === e.currentTarget) type();
          tabbed.current = false;
        }}
        onBlur={() => {
          typed.current = false;
          // Tab that left: its keyup is another field's.
          tabbed.current = false;
          setTyping(false);
        }}
        data-words={typing ? undefined : ""}
        className={`date-field absolute inset-0 size-full rounded-lg bg-transparent px-2 text-input text-ink outline-none [color-scheme:inherit] ${typing ? "" : "cursor-pointer opacity-0"}`}
      />
      {/* What the row shows, and its width. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none relative px-2 whitespace-nowrap ${muted ? "text-ink-muted" : "text-ink"} ${typing ? "invisible" : ""}`}
      >
        {DAY.test(value) ? formats.shortDay(value, today) : ""}
      </span>
    </span>
  );
}

/** The keys that change a date field's date. */
const EDITS = /^(\d|Arrow(Up|Down|Left|Right)|Backspace|Delete)$/;

/** A day as a date field gives it, its year of four digits. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function DateTime({
  form,
  dateLabel,
  timeLabel,
  date,
  time,
  onDate,
  onTime,
  allDay,
  muted,
  end,
}: {
  form: Form;
  /** A date alone, or a date and a time; the form's "All day" by default. */
  allDay?: boolean;
  /** As `DateField`'s. */
  muted?: boolean;
  /** After the time, on its line: the dash before an end. */
  end?: ReactNode;
  dateLabel: string;
  timeLabel: string;
  date: string;
  time: string;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center">
      <DateField label={dateLabel} value={date} onChange={onDate} muted={muted ?? false} />
      {!(allDay ?? form.allDay) && <TimeSelect label={timeLabel} value={time} onChange={onTime} />}
      {end}
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
  className = "",
  caret = false,
}: {
  label: string;
  value: string;
  onChange: (time: string) => void;
  /** Its share of the row. */
  className?: string;
  /** The arrow at its end: in a panel, a field among fields (design D317). */
  caret?: boolean;
}) {
  const { formats } = useCalendar();
  const times = QUARTERS.includes(value) ? QUARTERS : [...QUARTERS, value].toSorted();
  return (
    <Dropdown
      label={label}
      value={value}
      onChange={onChange}
      options={times.map((time) => ({ value: time, label: formats.clock(time) }))}
      caret={caret}
      className={`${timeButton} ${className}`}
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
