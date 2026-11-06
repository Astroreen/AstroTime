// Quick create (design D296), as Google Calendar's: what a tap on a slot,
// the floating button or "Create" opens. On a phone a sheet from the bottom,
// on a wide screen a popover by the item it makes, which the views draw
// behind it (D155). The title, "Event | Task", the time, the place and the
// calendar, and "Save" at its foot. There is no "More options": the sheet
// dragged up, or its handle pressed ("Expand"), becomes the edit dialog
// with everything filled carried over; the popover has an expand icon in
// its corner, beside its ✕. Enter saves, Escape closes. Loaded with its first opening,
// without the editor's chunk (foundation D145).
import type { Calendar } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";

import {
  switchKind,
  withStartDate,
  withStartTime,
  type Form,
  type Target,
} from "../calendar/editing.ts";
import { problemKey } from "../calendar/problems.ts";
import type { DrawnDraft } from "../calendar/query.ts";
import { useMediaQuery } from "../hooks.ts";
import { addTaskStrings } from "../i18n/tasks.ts";
import { defaultColorOf, useSettings } from "../settings.ts";
import { primaryButton } from "./buttons.ts";
import { DialogBackdrop, DialogPopup, dialogIcon } from "./dialog-parts.tsx";
import { FLOATS_REM, shownDraft, useDraft } from "./draft-aside.ts";
import {
  CalendarSelect,
  DateTime,
  field,
  KindSwitch,
  Section,
  TimeSelect,
  titleField,
  useSecondPress,
} from "./editor-fields.tsx";
import { CalendarIcon, ClockIcon, CloseIcon, PlaceIcon } from "./icons.tsx";
import type { EditorState } from "./item-editor.tsx";
import { PlaceField } from "./place-field.tsx";

/** How far, in px, the sheet is dragged up to expand, or down to close. */
const EXPAND_PX = 40;
const CLOSE_PX = 96;
/** The popover's margin from the screen's edges, and its gap from the draft. */
const MARGIN = 16;
const GAP = 8;

export function QuickCreate({
  state,
  calendars,
  onChange,
  onSave,
  onClose,
  onExpand,
  onDraft,
}: {
  state: EditorState | null;
  /** The calendars the item may be saved in. */
  calendars: readonly Calendar[];
  onChange: (form: Form) => void;
  onSave: () => void;
  onClose: () => void;
  /** Turns it into the edit dialog, the form as it is (design D296). */
  onExpand: () => void;
  /** The item as the form says now, for the views to draw (design D155). */
  onDraft: (draft: DrawnDraft | null) => void;
}) {
  const { t, i18n } = useTranslation();
  // A task's words (the list, its problems), as the editor loads them (design D236).
  addTaskStrings(i18n);
  const formId = useId();
  const form = state?.form ?? null;
  useDraft(null as Target | null, form, onDraft);
  const secondPress = useSecondPress(state?.opener);
  const floating = useMediaQuery(`(min-width: ${FLOATS_REM}rem)`);
  // Its node in state: it mounts after the dialog's first render, which renders again to place it.
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  const placed = usePopoverPlace(state !== null && floating, popup);
  const pull = useSheetPull(onExpand, onClose);
  const pulled = !floating && pull.offset !== 0;
  const style: CSSProperties | undefined = floating
    ? (placed ?? { opacity: 0 })
    : pulled
      ? { translate: `0 ${Math.max(pull.offset, -EXPAND_PX)}px`, transition: "none" }
      : undefined;
  return (
    <Dialog.Root
      open={state !== null}
      onOpenChange={(open, details) => {
        // A double click on an empty slot opens it with its first click; its
        // second press is no "close" (design D190).
        if (!open && details.reason === "outside-press" && secondPress(details.event)) {
          details.cancel();
          return;
        }
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <DialogBackdrop className="fixed inset-0 z-[120] bg-black/20 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 sm:bg-transparent" />
        <DialogPopup
          ref={setPopup}
          data-quick-create=""
          style={style}
          className="fixed inset-x-0 bottom-0 z-[130] flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-3xl bg-raised pr-(--inset-right) pb-[calc(0.75rem+var(--inset-bottom))] pl-(--inset-left) text-ink shadow-2xl transition-[translate,opacity,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] data-ending-style:translate-y-full data-starting-style:translate-y-full sm:inset-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[min(26rem,calc(100vw-2rem))] sm:rounded-3xl sm:p-0 sm:pb-3 sm:ring-1 sm:ring-line sm:duration-150 data-ending-style:sm:translate-y-0 data-ending-style:sm:scale-95 data-ending-style:sm:opacity-0 data-starting-style:sm:translate-y-0 data-starting-style:sm:scale-95 data-starting-style:sm:opacity-0"
        >
          <Dialog.Title className="sr-only">{t("quick.label")}</Dialog.Title>
          {floating ? (
            <div className="flex h-12 shrink-0 items-center justify-end px-2">
              <button
                type="button"
                aria-label={t("quick.expand")}
                title={t("quick.expand")}
                onClick={onExpand}
                className={dialogIcon}
              >
                <ExpandIcon className="size-5" />
              </button>
              <Dialog.Close
                className={dialogIcon}
                aria-label={t("edit.close")}
                title={t("edit.close")}
              >
                <CloseIcon className="size-5" />
              </Dialog.Close>
            </div>
          ) : (
            <button
              type="button"
              aria-label={t("quick.expand")}
              {...pull.handlers}
              className="grid h-7 w-full shrink-0 cursor-grab touch-none place-items-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              <span aria-hidden="true" className="h-1 w-8 rounded-full bg-ink-muted/60" />
            </button>
          )}
          {state && form && (
            <form
              id={formId}
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                onSave();
              }}
              className="flex flex-col gap-2 px-4"
            >
              <Fields form={form} calendars={calendars} onChange={onChange} />
              {state.problem && (
                <p role="alert" className="rounded-xl bg-danger-soft p-3 text-body text-danger">
                  {t(problemKey(state.problem, state.problemKind ?? form.kind))}
                </p>
              )}
              {/* The microphone stands left of "Save" when voice is on (assistant D302). */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={state.saving || calendars.length === 0}
                  className={`${primaryButton} flex-1`}
                >
                  {t("edit.save")}
                </button>
              </div>
            </form>
          )}
        </DialogPopup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Fields({
  form,
  calendars,
  onChange,
}: {
  form: Form;
  calendars: readonly Calendar[];
  onChange: (form: Form) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const set = (changes: Partial<Form>) => onChange({ ...form, ...changes });
  const event = form.kind === "event";
  // An event over more than a day keeps its end's date in sight.
  const days = event && form.endDate !== form.startDate;
  return (
    <>
      <KindSwitch
        value={form.kind}
        // The new kind's default colour (design D172): no colour is chosen here.
        onChange={(kind) =>
          onChange({ ...switchKind(form, kind), color: defaultColorOf(settings, kind) })
        }
      />
      <input
        aria-label={t("edit.title")}
        placeholder={t("edit.titlePlaceholder")}
        value={form.summary}
        autoFocus
        onChange={(e) => set({ summary: e.target.value })}
        className={titleField}
      />
      <Section icon={<ClockIcon className="size-5" />}>
        {days ? (
          <>
            <DateTime
              form={form}
              dateLabel={t("edit.startDate")}
              timeLabel={t("edit.startTime")}
              date={form.startDate}
              time={form.startTime}
              onDate={(date) => onChange(withStartDate(form, date))}
              onTime={(time) => onChange(withStartTime(form, time))}
            />
            <DateTime
              form={form}
              dateLabel={t("edit.endDate")}
              timeLabel={t("edit.endTime")}
              date={form.endDate}
              time={form.endTime}
              onDate={(endDate) => set({ endDate })}
              onTime={(endTime) => set({ endTime })}
            />
          </>
        ) : (
          <>
            <input
              type="date"
              aria-label={t("edit.startDate")}
              value={form.startDate}
              required
              onChange={(e) => e.target.value && onChange(withStartDate(form, e.target.value))}
              className={field}
            />
            {!form.allDay && (
              <div className="flex items-center gap-1">
                <TimeSelect
                  label={t("edit.startTime")}
                  value={form.startTime}
                  onChange={(time) => onChange(withStartTime(form, time))}
                  className="flex-1"
                />
                {event && (
                  <>
                    <span aria-hidden="true" className="text-ink-muted">
                      –
                    </span>
                    <TimeSelect
                      label={t("edit.endTime")}
                      value={form.endTime}
                      onChange={(endTime) => set({ endTime })}
                      className="flex-1"
                    />
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Section>
      <Section icon={<PlaceIcon className="size-5" />}>
        <PlaceField
          value={form.location}
          geo={form.place?.geo ?? null}
          onChange={(location, picked) => set({ location, place: picked ?? form.place })}
          className={field}
        />
      </Section>
      <Section icon={<CalendarIcon className="size-5" />}>
        <CalendarSelect
          label={t(event ? "edit.calendar" : "edit.list")}
          value={form.calendarId}
          onChange={(calendarId) => set({ calendarId })}
          calendars={calendars}
        />
        {calendars.length === 0 && (
          <p className="px-2 text-small text-danger">
            {t(event ? "edit.noCalendar" : "edit.noList")}
          </p>
        )}
      </Section>
    </>
  );
}

/**
 * Where the popover stands on a wide screen: beside the draft, on the side
 * with room, its top level with the draft's and inside the screen; in the
 * middle with no draft in sight. Measured after each render, as the draft
 * moves with the form.
 */
function usePopoverPlace(open: boolean, popup: HTMLElement | null): CSSProperties | null {
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    // Closing, it fades where it stood.
    if (!open) return;
    const box = popup?.getBoundingClientRect();
    if (!box) return;
    const draft = shownDraft()?.getBoundingClientRect();
    const [width, height] = [box.width, box.height];
    const fit = (at: number, size: number, room: number) =>
      Math.round(Math.max(MARGIN, Math.min(at, room - size - MARGIN)));
    let next;
    if (draft) {
      const right = draft.right + GAP;
      const left = right + width + MARGIN <= window.innerWidth ? right : draft.left - GAP - width;
      next = {
        left: fit(left, width, window.innerWidth),
        top: fit(draft.top, height, window.innerHeight),
      };
    } else {
      next = {
        left: fit((window.innerWidth - width) / 2, width, window.innerWidth),
        top: fit((window.innerHeight - height) / 2, height, window.innerHeight),
      };
    }
    setPlace((known) => (known?.left === next.left && known.top === next.top ? known : next));
  });
  return open || place ? place : null;
}

/**
 * The sheet's handle dragged (design D296): up by `EXPAND_PX` expands it,
 * down by `CLOSE_PX` closes it, less springs back; a press with no drag
 * expands it too, as its "Expand" says.
 */
function useSheetPull(onExpand: () => void, onClose: () => void) {
  const [offset, setOffset] = useState(0);
  const from = useRef<{ id: number; y: number } | null>(null);
  /** The press was a drag: its click does nothing more. */
  const dragged = useRef(false);
  const end = (event: PointerEvent, done: boolean) => {
    const start = from.current;
    if (!start || start.id !== event.pointerId) return;
    from.current = null;
    setOffset(0);
    const moved = event.clientY - start.y;
    dragged.current = Math.abs(moved) > 4;
    if (!done) return;
    if (moved <= -EXPAND_PX) onExpand();
    else if (moved >= CLOSE_PX) onClose();
  };
  return {
    offset,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        dragged.current = false;
        from.current = { id: event.pointerId, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: PointerEvent) => {
        const start = from.current;
        if (start?.id === event.pointerId) setOffset(event.clientY - start.y);
      },
      onPointerUp: (event: PointerEvent) => end(event, true),
      onPointerCancel: (event: PointerEvent) => end(event, false),
      onClick: () => {
        if (!dragged.current) onExpand();
        dragged.current = false;
      },
    },
  };
}

/** Two arrows apart, corner to corner: open in full. */
function ExpandIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
    </svg>
  );
}
