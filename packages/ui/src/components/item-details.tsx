// An item's details (docs/plans/foundation.md#D14, D9, D10), as Google
// Calendar shows them when an item is tapped: its colour, title, when it is
// and how it repeats, where, its description as Markdown (design D207), its
// attachments (design D230), its reminders,
// its guests (shown, never invited: no iTIP), its calendar; a task's due and
// subtasks, with complete and, beside Edit, star (no status, priority,
// progress or tags, design D162). Edit shows only where the calendar can be
// written; Delete, "Make a copy" and "Copy to" are in a "⋯" menu (design
// D163).
import { isDone, repeatOf, timesOf, type ItemTime, type Participant } from "@astrotime/core";
import type { Calendar } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { deleteScopes, type Target } from "../calendar/editing.ts";
import { whenText } from "../calendar/when.ts";
import { rightsOf } from "../calendar/rights.ts";
import { alarmOptions, alarmWords, repeatWords } from "../calendar/words.ts";
import { useCalendar } from "./context.ts";
import { Description } from "./description.tsx";
import {
  BellIcon,
  CalendarIcon,
  CheckIcon,
  CloseIcon,
  EditIcon,
  NotesIcon,
  PeopleIcon,
  MoreIcon,
  PlaceIcon,
  RepeatIcon,
  StarIcon,
  SubtasksIcon,
} from "./icons.tsx";
import { AttachmentList, AttachmentsIcon } from "./attachments.tsx";
import { DetailsPicture } from "./item-picture.tsx";
import { PlaceCard } from "./place-card.tsx";
import { MenuButton } from "./select.tsx";
import { primaryButton } from "./sign-in-dialog.tsx";
import { DialogBackdrop, DialogPopup, dialogIcon, sheet } from "./dialog-parts.tsx";

/**
 * Where the last press was, so the details grow out of it (design D200);
 * a key's press has no place, and they grow from their middle. Heard from
 * when this code is loaded, with the first opening's press or before it.
 */
let pressed: { readonly x: number; readonly y: number } | null = null;
addEventListener("pointerdown", (event) => (pressed = { x: event.clientX, y: event.clientY }), {
  capture: true,
  passive: true,
});
addEventListener("keydown", () => (pressed = null), { capture: true, passive: true });

/** The popup grows out of the press that opened it: its scale's origin set there before it shows. */
const growFromPress = (popup: HTMLElement | null) => {
  if (!popup || !pressed) return;
  const { left, top } = popup.getBoundingClientRect();
  popup.style.transformOrigin = `${pressed.x - left}px ${pressed.y - top}px`;
  pressed = null;
};

export function ItemDetails({
  target,
  calendar,
  color,
  related,
  onClose,
  onEdit,
  onDelete,
  onCopy,
  onCopyTo,
  canCopyTo,
  onComplete,
  onStar,
  onCopyFailed,
}: {
  target: Target | null;
  calendar: Calendar | undefined;
  color: string;
  /** A task's parent's title and its subtasks' titles, from its list. */
  related: { readonly parent: string | null; readonly subtasks: readonly string[] };
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** "Make a copy": a copy saved at once in the item's calendar (design D164). */
  onCopy: () => void;
  /** "Copy to": the edit dialog with a new item filled from this one. */
  onCopyTo: () => void;
  /** Whether any calendar takes a new item of this kind, for "Copy to" (D37). */
  canCopyTo: boolean;
  /** From the button pressed, where a completion's burst starts (design D198). */
  onComplete: (from: Element) => void;
  onStar: () => void;
  /** A place's address could not be copied: the notice says so (design D177). */
  onCopyFailed: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <DialogBackdrop className="fixed inset-0 z-[100] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        {/* On a phone it grows too, not only fades (design D200). */}
        <DialogPopup
          ref={growFromPress}
          className={`${sheet} z-[110] data-ending-style:scale-[0.96] data-starting-style:scale-[0.9] sm:w-[min(28rem,calc(100vw-2rem))]`}
        >
          {target && (
            <Body
              target={target}
              calendar={calendar}
              color={color}
              related={related}
              onEdit={onEdit}
              onDelete={onDelete}
              onCopy={onCopy}
              onCopyTo={onCopyTo}
              canCopyTo={canCopyTo}
              onComplete={onComplete}
              onStar={onStar}
              onCopyFailed={onCopyFailed}
            />
          )}
          <Dialog.Close
            className={`${dialogIcon} absolute top-2 left-2`}
            aria-label={t("details.close")}
          >
            <CloseIcon className="size-5" />
          </Dialog.Close>
        </DialogPopup>
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
  onCopy,
  onCopyTo,
  canCopyTo,
  onComplete,
  onStar,
  onCopyFailed,
}: {
  target: Target;
  calendar: Calendar | undefined;
  color: string;
  related: { readonly parent: string | null; readonly subtasks: readonly string[] };
  onEdit: () => void;
  onDelete: () => void;
  /** "Make a copy": a copy saved at once in the item's calendar (design D164). */
  onCopy: () => void;
  /** "Copy to": the edit dialog with a new item filled from this one. */
  onCopyTo: () => void;
  /** Whether any calendar takes a new item of this kind, for "Copy to" (D37). */
  canCopyTo: boolean;
  onComplete: (from: Element) => void;
  onStar: () => void;
  onCopyFailed: () => void;
}) {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  const { item, object } = target;
  // Each action only where the calendar's rights allow it (D37).
  const rights = rightsOf(calendar);
  const canDelete = deleteScopes(target, rights).length > 0;
  // The actions menu (design D163): each where the rights allow it (D37).
  const actions = [
    ...(canDelete ? [{ value: "delete", label: t("details.delete") }] : []),
    ...(rights.create ? [{ value: "copy", label: t("details.copy") }] : []),
    ...(canCopyTo ? [{ value: "copyTo", label: t("details.copyTo") }] : []),
  ];
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
      {/* Over the item's picture, when its title or its place gives one (design D216, D221). */}
      <DetailsPicture item={item}>
        <div className="flex h-14 shrink-0 items-center justify-end gap-1 px-2 pl-14">
          {/* A task's star beside the pencil, as an icon toggle (design D196). */}
          {task && rights.edit && (
            <button
              type="button"
              className={dialogIcon}
              // One name, its state pressed or not (a toggle's name does not
              // change); the tooltip, for a pointer, says what a press does.
              aria-label={t("details.star")}
              aria-pressed={starred}
              title={t(starred ? "details.unstar" : "details.star")}
              onClick={(event) => {
                // Its star pops when it lights, after this press (design D200).
                event.currentTarget.dataset["pop"] = "";
                onStar();
              }}
            >
              <StarIcon filled={starred} className={`size-5 ${starred ? "text-accent" : ""}`} />
            </button>
          )}
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
          {actions.length > 0 && (
            <MenuButton
              label={t("details.more")}
              icon={<MoreIcon className="size-5" />}
              className={dialogIcon}
              options={actions}
              onChoose={(action) =>
                action === "delete" ? onDelete() : action === "copy" ? onCopy() : onCopyTo()
              }
            />
          )}
        </div>
      </DetailsPicture>
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
            <Row icon={<RepeatIcon className="size-5" />} label={t("edit.repeat")}>
              {rule.exact
                ? repeatWords(rule.repeat, times.start ?? times.end, t, formats)
                : t("repeat.kept", {
                    rule: repeatWords(rule.repeat, times.start ?? times.end, t, formats),
                  })}
            </Row>
          )}
          {item.location && (
            <Row icon={<PlaceIcon className="size-5" />} label={t("edit.location")}>
              <PlaceCard
                location={item.location}
                geo={item.geo}
                label={item.placeLabel}
                onCopyFailed={onCopyFailed}
              />
            </Row>
          )}
          {item.description && (
            <Row icon={<NotesIcon className="size-5" />} label={t("edit.description")}>
              <Description text={item.description} />
            </Row>
          )}
          {item.attachments.length > 0 && (
            <Row icon={<AttachmentsIcon className="size-5" />} label={t("attachments.title")}>
              <AttachmentList target={target} calendar={calendar} />
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
          {!task && item.categories.length > 0 && (
            <Row icon={<NotesIcon className="size-5" />} label={t("details.tags")}>
              {item.categories.join(", ")}
            </Row>
          )}
          {task && (related.parent || related.subtasks.length > 0) && (
            <Row icon={<SubtasksIcon className="size-5" />} label={t("details.subtasks")}>
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
          {/* Its list or calendar by name alone, the icon saying which (design D196). */}
          {calendar && (
            <Row
              icon={<CalendarIcon className="size-5" />}
              label={t(task ? "edit.list" : "edit.calendar")}
            >
              {calendar.name}
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
              onClick={(event) => onComplete(event.currentTarget)}
            >
              <CheckIcon className="size-4" />
              {t(done ? "details.uncomplete" : "details.complete")}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** A row of the details: its icon, and its name for a screen reader as the term (design D196). */
function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="mt-px shrink-0 text-ink-muted">
        {icon}
        <span className="sr-only">{label}</span>
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

/** The item's own zone, when it is not the user's (or UTC). */
function zoneNote(time: ItemTime | null, timeZone: string): string | null {
  if (time?.type !== "zoned" || time.timeZone === "UTC" || time.timeZone === timeZone) return null;
  return time.timeZone;
}
