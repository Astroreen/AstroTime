// An item's details (docs/plans/foundation.md#D14, D9, D10), as Google
// Calendar shows them when an item is tapped: its colour, title, when it is
// and how it repeats, where, its description with its links, its reminders,
// its guests (shown, never invited: no iTIP), its calendar; a task's due,
// status, priority and subtasks, with complete and star. Edit and delete
// show only where the calendar can be written.
import {
  isDone,
  repeatOf,
  timesOf,
  wallClockOf,
  type ItemTime,
  type Participant,
  type Task,
} from "@astrotime/core";
import type { Calendar } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import type { TFunction } from "i18next";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { addDays } from "../calendar/dates.ts";
import { deleteScopes, type Target } from "../calendar/editing.ts";
import type { Formats } from "../calendar/format.ts";
import { rightsOf } from "../calendar/rights.ts";
import { alarmOptions, alarmWords, repeatWords } from "../calendar/words.ts";
import { useCalendar } from "./context.ts";
import {
  BellIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  EditIcon,
  NotesIcon,
  PeopleIcon,
  PlaceIcon,
  RepeatIcon,
  StarIcon,
  SubtasksIcon,
  TrashIcon,
} from "./icons.tsx";
import { primaryButton } from "./sign-in-dialog.tsx";

export const dialogIcon =
  "grid size-10 shrink-0 place-items-center rounded-full text-ink hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent";

/** The popup of the details and edit dialogs: the whole screen on a phone, a card on a wide one. */
export const sheet =
  "fixed inset-0 flex flex-col overflow-hidden bg-raised text-ink shadow-2xl transition-[scale,opacity] duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[min(44rem,calc(100dvh-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl data-ending-style:sm:scale-95 data-starting-style:sm:scale-95";

export function ItemDetails({
  target,
  calendar,
  color,
  related,
  onClose,
  onEdit,
  onDelete,
  onComplete,
  onStar,
}: {
  target: Target | null;
  calendar: Calendar | undefined;
  color: string;
  /** A task's parent's title and its subtasks' titles, from its list. */
  related: { readonly parent: string | null; readonly subtasks: readonly string[] };
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onComplete: () => void;
  onStar: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[100] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className={`${sheet} z-[110] sm:w-[min(28rem,calc(100vw-2rem))]`}>
          {target && (
            <Body
              target={target}
              calendar={calendar}
              color={color}
              related={related}
              onEdit={onEdit}
              onDelete={onDelete}
              onComplete={onComplete}
              onStar={onStar}
            />
          )}
          <Dialog.Close
            className={`${dialogIcon} absolute top-2 left-2`}
            aria-label={t("details.close")}
          >
            <CloseIcon className="size-5" />
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Body({
  target,
  calendar,
  color,
  related,
  onEdit,
  onDelete,
  onComplete,
  onStar,
}: {
  target: Target;
  calendar: Calendar | undefined;
  color: string;
  related: { readonly parent: string | null; readonly subtasks: readonly string[] };
  onEdit: () => void;
  onDelete: () => void;
  onComplete: () => void;
  onStar: () => void;
}) {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  const { item, object } = target;
  // Each action only where the calendar's rights allow it (D37).
  const rights = rightsOf(calendar);
  const canDelete = deleteScopes(target, rights).length > 0;
  const title = item.summary?.trim() || t("item.untitled");
  const times = timesOf(object, target.recurrenceId);
  const rule = repeatOf(object);
  const task = item.kind === "task" ? item : null;
  const seriesDone = object.master !== null && isDone(object.master);
  const done = task !== null && (seriesDone || isDone(task));
  const starred = object.master?.kind === "task" && object.master.starred;
  const allDay = (times.start ?? times.end)?.type === "date";
  const zone = zoneNote(times.start ?? times.end, timeZone);
  const attendees = item.kind === "event" ? item.attendees : [];
  const organizer = item.kind === "event" ? item.organizer : null;

  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-end gap-1 px-2 pl-14">
        {rights.edit && (
          <button
            type="button"
            className={dialogIcon}
            aria-label={t("details.edit")}
            title={t("details.edit")}
            onClick={onEdit}
          >
            <EditIcon className="size-5" />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className={dialogIcon}
            aria-label={t("details.delete")}
            title={t("details.delete")}
            onClick={onDelete}
          >
            <TrashIcon className="size-5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="item-color mt-1.5 size-4 shrink-0 rounded-[5px] bg-[var(--item-fill)]"
            style={{ "--item": color } as CSSProperties}
          />
          <div className="min-w-0 flex-1">
            <Dialog.Title
              className={`text-headline leading-tight break-words ${done ? "text-ink-muted line-through" : ""}`}
            >
              {title}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-body text-ink-muted">
              {whenText(task, times, allDay, { t, formats, timeZone })}
            </Dialog.Description>
            {zone && <p className="text-small text-ink-muted">{t("details.zone", { zone })}</p>}
          </div>
        </div>
        <dl className="mt-4 flex flex-col gap-3 text-body">
          {rule && (
            <Row icon={<RepeatIcon className="size-5" />}>
              {rule.exact
                ? repeatWords(rule.repeat, times.start ?? times.end, t, formats)
                : t("repeat.kept", {
                    rule: repeatWords(rule.repeat, times.start ?? times.end, t, formats),
                  })}
            </Row>
          )}
          {task && (
            <Row icon={<ClockIcon className="size-5" />}>
              <span className="flex flex-col">
                <span>{t(`status.${statusOf(task)}`)}</span>
                {task.percentComplete !== null && task.percentComplete > 0 && !done && (
                  <span className="text-ink-muted">
                    {t("details.progress", { percent: task.percentComplete })}
                  </span>
                )}
                {task.priority !== null && (
                  <span className="text-ink-muted">
                    {t("details.priority", {
                      priority: t(`priority.${priorityOf(task.priority)}`),
                    })}
                  </span>
                )}
              </span>
            </Row>
          )}
          {item.location && (
            <Row icon={<PlaceIcon className="size-5" />}>
              <span className="break-words whitespace-pre-wrap">{item.location}</span>
            </Row>
          )}
          {item.description && (
            <Row icon={<NotesIcon className="size-5" />}>
              <span className="break-words whitespace-pre-wrap">{linkify(item.description)}</span>
            </Row>
          )}
          {item.alarms.length > 0 && (
            <Row icon={<BellIcon className="size-5" />} label={t("details.reminders")}>
              <ul>
                {item.alarms.map((alarm, index) => (
                  <li key={index}>
                    {alarmWords(alarm, alarmOptions(item, alarm), t, formats, timeZone)}
                  </li>
                ))}
              </ul>
            </Row>
          )}
          {(organizer || attendees.length > 0) && (
            <Row icon={<PeopleIcon className="size-5" />} label={t("details.guests")}>
              <ul className="flex flex-col gap-1">
                {organizer && (
                  <li>
                    <Person person={organizer} />{" "}
                    <span className="text-ink-muted">· {t("details.organizer")}</span>
                  </li>
                )}
                {attendees
                  .filter((person) => person.address !== organizer?.address)
                  .map((person) => (
                    <li key={person.address}>
                      <Person person={person} />
                      {person.status && partstat(person.status) && (
                        <span className="text-ink-muted">
                          {" "}
                          · {t(`partstat.${partstat(person.status)!}`)}
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
              <p className="mt-1 text-note text-ink-muted">{t("details.guestsNote")}</p>
            </Row>
          )}
          {item.categories.length > 0 && (
            <Row icon={<NotesIcon className="size-5" />}>
              {t("details.categories", { categories: item.categories.join(", ") })}
            </Row>
          )}
          {task && (related.parent || related.subtasks.length > 0) && (
            <Row icon={<SubtasksIcon className="size-5" />}>
              {related.parent && <p>{t("details.parent", { title: related.parent })}</p>}
              {related.subtasks.length > 0 && (
                <div>
                  <p className="text-ink-muted">{t("details.subtasks")}</p>
                  <ul className="list-disc pl-5">
                    {related.subtasks.map((subtask, index) => (
                      <li key={index}>{subtask}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Row>
          )}
          {calendar && (
            <Row icon={<CalendarIcon className="size-5" />}>
              {t(task ? "details.list" : "details.calendar", { calendar: calendar.name })}
            </Row>
          )}
        </dl>
        {!rights.edit && !canDelete && calendar && (
          <p role="note" className="mt-4 rounded-2xl bg-canvas p-3 text-small text-ink-muted">
            {t("details.readOnly", { calendar: calendar.name })}
          </p>
        )}
        {task && rights.edit && (
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className={`${primaryButton} flex items-center gap-2`}
              onClick={onComplete}
            >
              <CheckIcon className="size-4" />
              {t(done ? "details.uncomplete" : "details.complete")}
            </button>
            <button
              type="button"
              aria-pressed={starred}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-body font-medium text-accent ring-1 ring-line hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent"
              onClick={onStar}
            >
              <StarIcon filled={starred} className="size-4" />
              {t(starred ? "details.unstar" : "details.star")}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label?: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="mt-px shrink-0 text-ink-muted">
        {icon}
        {label && <span className="sr-only">{label}</span>}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function Person({ person }: { person: Participant }) {
  const address = person.address.replace(/^mailto:/i, "");
  return <span className="break-words">{person.name ?? address}</span>;
}

const PARTSTATS = ["ACCEPTED", "DECLINED", "TENTATIVE", "NEEDS-ACTION", "DELEGATED"] as const;
const partstat = (status: string) => PARTSTATS.find((s) => s === status.toUpperCase());

const STATUSES = ["NEEDS-ACTION", "IN-PROCESS", "COMPLETED", "CANCELLED"] as const;
function statusOf(task: Task): (typeof STATUSES)[number] {
  if (task.completed && !task.status) return "COMPLETED";
  return STATUSES.find((s) => s === task.status?.toUpperCase()) ?? "NEEDS-ACTION";
}

/** RFC 5545 §3.8.1.9 by thirds, as Nextcloud Tasks shows it: 1–4 high, 5 medium, 6–9 low. */
export function priorityOf(priority: number): "high" | "medium" | "low" {
  return priority <= 4 ? "high" : priority === 5 ? "medium" : "low";
}

/** The item's own zone, when it is not the user's (or UTC). */
function zoneNote(time: ItemTime | null, timeZone: string): string | null {
  if (time?.type !== "zoned" || time.timeZone === "UTC" || time.timeZone === timeZone) return null;
  return time.timeZone;
}

const dayIn = (time: ItemTime, timeZone: string) =>
  time.type === "date" ? time.date : wallClockOf(time, timeZone).slice(0, 10);

/**
 * "Wednesday, November 4 · 10:00 – 11:30", "November 4 – 6", "Due Thursday,
 * November 5, 15:00": the details' line, and what a move announces (design D112).
 */
export function whenText(
  task: Task | null,
  times: { start: ItemTime | null; end: ItemTime | null },
  allDay: boolean,
  { t, formats, timeZone }: { t: TFunction; formats: Formats; timeZone: string },
): string {
  const year = new Date().getFullYear().toString();
  // A task's dates follow "Due", "Starts": not capitalized.
  const at = (time: ItemTime) =>
    time.type === "date"
      ? formats.longDate(time.date, year, false)
      : `${formats.longDate(dayIn(time, timeZone), year, false)}, ${formats.time(time, timeZone)}`;
  if (task) {
    const parts = [];
    if (times.start) parts.push(t("details.starts", { time: at(times.start) }));
    if (times.end) parts.push(t("details.due", { time: at(times.end) }));
    return parts.join(" · ");
  }
  const { start, end } = times;
  if (!start) return "";
  if (allDay) {
    const last = end?.type === "date" ? addDays(end.date, -1) : dayIn(start, timeZone);
    const first = dayIn(start, timeZone);
    return last <= first ? formats.longDate(first, year) : formats.dateRange(first, last);
  }
  if (!end || dayIn(start, timeZone) !== dayIn(end, timeZone)) {
    return end
      ? formats.timeRange(start, end, timeZone)
      : `${formats.longDate(dayIn(start, timeZone), year)}, ${formats.time(start, timeZone)}`;
  }
  return `${formats.longDate(dayIn(start, timeZone), year)} · ${formats.timeRange(start, end, timeZone)}`;
}

const LINK = /(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+)/g;

/**
 * A link as found in text, without what ends the sentence after it: a full
 * stop, a comma, or a closing bracket the link did not open
 * (`https://en.wikipedia.org/wiki/Foo_(bar)` keeps its own).
 */
export function linkOf(found: string): string {
  let url = found;
  for (;;) {
    url = url.replace(/[.,;:!?]+$/, "");
    const last = url.at(-1);
    const open = last === ")" ? "(" : last === "]" ? "[" : null;
    if (!last || !open || count(url, open) >= count(url, last)) return url;
    url = url.slice(0, -1);
  }
}

const count = (text: string, char: string) => text.split(char).length - 1;

/** The text with its web and mail links as links that open elsewhere; nothing else is markup. */
function linkify(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const url = linkOf(match[0]);
    const start = match.index;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a
        key={start}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline underline-offset-2"
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
