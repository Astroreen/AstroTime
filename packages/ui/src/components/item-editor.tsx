// The edit dialog (docs/plans/foundation.md#D9, D10), as Google Calendar's:
// the whole screen on a phone, a dialog on a wide screen. Event or task when
// creating; title; all day; start and end (a task's start and its optional
// due, design D159); the zone when it is not the user's; repeat presets and a
// custom rule; reminders; the calendar; colour; location; description;
// attachments (design D233) (a task
// has no status, priority, progress or tags here, design D162). Enter in a
// field saves, Escape closes. A new item reaches it from quick create's
// "Expand" (design D296). Its rows have no boxes: an icon and the value on
// the dialog's ground, an empty one a pale hint, groups parted by a
// hairline (design D297).
import {
  nthWeekdayOf,
  WEEKDAYS,
  weekdayOf,
  type ItemTime,
  type Repeat,
  type RepeatEnd,
  type Weekday,
} from "@astrotime/core";
import type { Calendar } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import { Switch } from "@base-ui/react/switch";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  dueIsDate,
  switchKind,
  withAlarms,
  withAllDay,
  withDue,
  withDueAt,
  withStartTime,
  withStartDate,
  type AlarmChoice,
  type Form,
  type RepeatChoice,
  type Target,
} from "../calendar/editing.ts";
import type { DrawnDraft } from "../calendar/query.ts";
import {
  countAlarms,
  customOffset,
  MOST,
  offeredAlarms,
  readTally,
  UNITS,
  type AlarmUnit,
} from "../calendar/alarms.ts";
import { alarmWords, repeatWords } from "../calendar/words.ts";
import { KEYS } from "../preferences.ts";
import { defaultColorOf, useSettings } from "../settings.ts";
import { AttachmentsField } from "./attachments-field.tsx";
import { AttachmentsIcon } from "./attachments.tsx";
import { useCalendar } from "./context.ts";
import {
  BellIcon,
  CalendarIcon,
  ClockIcon,
  CloseIcon,
  NotesIcon,
  PaletteIcon,
  PlaceIcon,
  RepeatIcon,
} from "./icons.tsx";
import { ColorSelect } from "./color-select.tsx";
import { MentionField } from "./mention-field.tsx";
import { PlaceField } from "./place-field.tsx";
import { MenuButton, Select as Dropdown } from "./select.tsx";
import { problemKey, type SaveProblem } from "../calendar/problems.ts";
import { addTaskStrings } from "../i18n/tasks.ts";
import { useAccounts } from "./accounts-context.tsx";
import { primaryButton, textButton } from "./buttons.ts";
import { DialogBackdrop, DialogPopup, dialogIcon, sheet } from "./dialog-parts.tsx";
import { asideStyle, useDraft, useDraftAside } from "./draft-aside.ts";
import {
  CalendarSelect,
  DateTime,
  field,
  fieldButton,
  hint,
  KindSwitch,
  Section,
  TimeSelect,
  titleField,
  useSecondPress,
  type Press,
} from "./editor-fields.tsx";

/** A label above a field of a panel inside a row: the custom repeat's. */
const fieldLabel = "text-small leading-5 text-ink-muted";

export interface EditorState {
  /** `false`: a new item, whose kind can still switch. */
  readonly existing: boolean;
  /** The click that opened it, on an empty slot; none for a key, a button or a copy (design D190). */
  readonly opener?: Press;
  /** A new item filled from another ("Copy to", design D164): its kind stays. */
  readonly copy?: boolean;
  readonly form: Form;
  /** Why the form cannot be saved, or why saving it did not work. */
  readonly problem: SaveProblem | null;
  /** The kind the problem was met with, its words kept if the kind switches meanwhile (design D236). */
  readonly problemKind?: Form["kind"];
  readonly saving: boolean;
}

export function ItemEditor({
  state,
  calendars,
  onChange,
  onSave,
  onClose,
  target,
  onDraft,
}: {
  state: EditorState | null;
  /** The calendars the item may be saved in. */
  calendars: readonly Calendar[];
  onChange: (form: Form) => void;
  onSave: () => void;
  onClose: () => void;
  /** The item edited; `null` for a new one. */
  target: Target | null;
  /** The item as the form says now, for the views to draw (design D155). */
  onDraft: (draft: DrawnDraft | null) => void;
}) {
  const { t, i18n } = useTranslation();
  // A task's words, loaded with the dialog (design D236).
  addTaskStrings(i18n);
  const formId = useId();
  const form = state?.form;
  useDraft(target, form ?? null, onDraft);
  const secondPress = useSecondPress(state?.opener);
  useAlarmCount(state);
  // Beside the item it makes, where there is room (design D155, D187).
  const aside = useDraftAside(state !== null);
  const title = form
    ? t(
        state.existing
          ? form.kind === "event"
            ? "edit.editEvent"
            : "edit.editTask"
          : form.kind === "event"
            ? "edit.newEvent"
            : "edit.newTask",
      )
    : "";
  return (
    <Dialog.Root
      open={state !== null}
      onOpenChange={(open, details) => {
        // A double click on an empty slot opens the dialog with its first
        // click; its second press lands on the backdrop and is no "close"
        // (design D190).
        if (!open && details.reason === "outside-press" && secondPress(details.event)) {
          details.cancel();
          return;
        }
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <DialogBackdrop
          className={`fixed inset-0 z-[120] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 ${aside ? "sm:bg-black/20" : ""}`}
        />
        <DialogPopup
          className={`${sheet} z-[130] sm:w-[min(36rem,calc(100vw-2rem))]`}
          style={aside ? asideStyle(aside) : undefined}
          data-aside={aside?.side}
          data-aside-for={aside?.draft}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2">
            <Dialog.Close className={dialogIcon} aria-label={t("edit.close")}>
              <CloseIcon className="size-5" />
            </Dialog.Close>
            <Dialog.Title className="min-w-0 flex-1 truncate text-title">{title}</Dialog.Title>
            <button
              type="submit"
              form={formId}
              disabled={state?.saving || calendars.length === 0}
              className={primaryButton}
            >
              {t("edit.save")}
            </button>
          </div>
          {state && form && (
            <form
              id={formId}
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                onSave();
              }}
              className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-8"
            >
              <Fields
                form={form}
                existing={state.existing}
                copy={state.copy ?? false}
                calendars={calendars}
                onChange={onChange}
              />
              {state.problem && (
                <p
                  role="alert"
                  className="mt-4 rounded-xl bg-danger-soft p-3 text-body text-danger"
                >
                  {t(problemKey(state.problem, state.problemKind ?? form?.kind ?? "event"))}
                </p>
              )}
            </form>
          )}
        </DialogPopup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Whether the item was all day when each reminder was added to it: the
 * kind it counts under (design D206), even if "All day" switched since.
 */
const addedAllDay = new WeakMap<AlarmChoice, boolean>();

/**
 * Counts the reminders added to an item once it is saved (design D206): the
 * dialog closes from saving, not from a refusal, which leaves it open.
 */
function useAlarmCount(state: EditorState | null) {
  const { platform } = useAccounts();
  const saving = useRef<Form | null>(null);
  useEffect(() => {
    if (state?.saving) {
      saving.current = state.form;
      return;
    }
    const saved = saving.current;
    saving.current = null;
    if (state === null && saved) {
      const added = saved.alarms.flatMap((a) =>
        a.kind === "new"
          ? [{ allDay: addedAllDay.get(a) ?? saved.allDay, offset: a.offsetSeconds }]
          : [],
      );
      countAlarms(platform.preferences, added);
    }
  }, [state, platform]);
}

function Fields({
  form,
  existing,
  copy,
  calendars,
  onChange,
}: {
  form: Form;
  existing: boolean;
  copy: boolean;
  calendars: readonly Calendar[];
  onChange: (form: Form) => void;
}) {
  const { t } = useTranslation();
  const { timeZone } = useCalendar();
  const { settings } = useSettings();
  const defaults = {
    event: defaultColorOf(settings, "event"),
    task: defaultColorOf(settings, "task"),
  };
  // Whether the user chose the colour here: then a switch of kind keeps it,
  // even when it is the default's (design D172).
  const [colorChosen, setColorChosen] = useState(false);
  const set = (changes: Partial<Form>) => onChange({ ...form, ...changes });
  const event = form.kind === "event";
  const calendar = calendars.find((c) => c.id === form.calendarId);
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 pb-3">
        {!existing && !copy && (
          <KindSwitch
            value={form.kind}
            onChange={(kind) => {
              const next = switchKind(form, kind);
              onChange(colorChosen ? next : { ...next, color: defaults[kind] });
            }}
          />
        )}
        <input
          aria-label={t("edit.title")}
          placeholder={t("edit.titlePlaceholder")}
          value={form.summary}
          autoFocus={!existing}
          onChange={(e) => set({ summary: e.target.value })}
          className={titleField}
        />
      </div>

      <Group>
        <Section icon={<ClockIcon className="size-5" />}>
          <Toggle
            label={t("edit.allDay")}
            checked={form.allDay}
            onChange={(allDay) => onChange(withAllDay(form, allDay))}
          />
          <DateTime
            form={form}
            dateLabel={t("edit.startDate")}
            timeLabel={t("edit.startTime")}
            date={form.startDate}
            time={form.startTime}
            onDate={(date) => onChange(withStartDate(form, date))}
            onTime={(startTime) => onChange(withStartTime(form, startTime))}
          />
          {event ? (
            <DateTime
              form={form}
              dateLabel={t("edit.endDate")}
              timeLabel={t("edit.endTime")}
              date={form.endDate}
              time={form.endTime}
              onDate={(endDate) => set({ endDate })}
              onTime={(endTime) => set({ endTime })}
            />
          ) : form.endDate === "" ? (
            <button type="button" onClick={() => onChange(withDue(form, true))} className={hint}>
              {t("edit.addDue")}
            </button>
          ) : (
            <div role="group" aria-label={t("edit.due")} className="flex flex-col gap-1">
              <span className="px-2 text-small text-ink-muted">{t("edit.due")}</span>
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <DateTime
                    form={form}
                    allDay={dueIsDate(form)}
                    dateLabel={t("edit.dueDate")}
                    timeLabel={t("edit.dueTime")}
                    date={form.endDate}
                    time={form.endTime}
                    onDate={(endDate) => onChange(withDueAt(form, { endDate }))}
                    onTime={(endTime) => onChange(withDueAt(form, { endTime }))}
                  />
                </div>
                <button
                  type="button"
                  aria-label={t("edit.removeDue")}
                  title={t("edit.removeDue")}
                  onClick={() => onChange(withDue(form, false))}
                  className={dialogIcon}
                >
                  <CloseIcon className="size-4" />
                </button>
              </div>
            </div>
          )}
          {!form.allDay && form.zone === null && (
            <p className="px-2 text-small text-ink-muted">{t("edit.floating")}</p>
          )}
          {!form.allDay && form.zone !== null && form.zone !== timeZone && (
            <p className="px-2 text-small text-ink-muted">{t("edit.zone", { zone: form.zone })}</p>
          )}
        </Section>

        <Section icon={<RepeatIcon className="size-5" />}>
          <RepeatField form={form} onChange={(repeat) => set({ repeat })} />
        </Section>
      </Group>

      <Group>
        <Section icon={<BellIcon className="size-5" />}>
          <Reminders form={form} onChange={(alarms) => onChange(withAlarms(form, alarms))} />
        </Section>
      </Group>

      <Group>
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

        <Section icon={<PaletteIcon className="size-5" />}>
          <ColorSelect
            label={t("edit.color")}
            value={form.color}
            calendarColor={calendar?.color ?? null}
            task={!event}
            onChange={(color) => {
              setColorChosen(true);
              set({ color });
            }}
            className={fieldButton}
          />
        </Section>
      </Group>

      <Group>
        <Section icon={<PlaceIcon className="size-5" />}>
          <PlaceField
            value={form.location}
            geo={form.place?.geo ?? null}
            onChange={(location, picked) => set({ location, place: picked ?? form.place })}
            className={field}
          />
        </Section>

        <Section icon={<NotesIcon className="size-5" />}>
          <MentionField
            label={t("edit.description")}
            placeholder={t("edit.addDescription")}
            value={form.description}
            accountId={calendar?.accountId ?? null}
            onChange={(description) => set({ description })}
            className={`${field} field-sizing-content h-auto min-h-10 resize-none py-2`}
          />
        </Section>

        <Section icon={<AttachmentsIcon className="size-5" />}>
          <AttachmentsField
            value={form.attachments ?? []}
            calendar={calendar}
            onChange={(attachments) => set({ attachments })}
            field={field}
            task={!event}
          />
        </Section>
      </Group>
    </div>
  );
}

/** A group of rows, parted from the one above by a hairline (design D297). */
function Group({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 border-t border-line py-3">{children}</div>;
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-3 px-2 text-row">
      <span className="min-w-0 flex-1">{label}</span>
      <Switch.Root
        checked={checked}
        onCheckedChange={onChange}
        className="flex h-6 w-10 shrink-0 items-center rounded-full bg-pill p-0.5 shadow-[inset_0_0_0_2px_var(--color-ink-muted)] transition-colors duration-150 data-checked:bg-accent data-checked:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Switch.Thumb className="size-5 rounded-full bg-ink-muted transition-[translate,background-color] duration-150 data-checked:translate-x-4 data-checked:bg-on-accent" />
      </Switch.Root>
    </label>
  );
}

function Labelled({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small text-ink-muted">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <Dropdown
        label={label}
        labelClassName={fieldLabel}
        value={value}
        onChange={onChange}
        options={options.map(([option, name]) => ({ value: option, label: name }))}
        className={fieldButton}
      />
    </div>
  );
}

// Repeat

type Preset = "none" | "daily" | "weekly" | "weekdays" | "monthly" | "monthlyWeekday" | "yearly";
const PRESETS: readonly Preset[] = [
  "none",
  "daily",
  "weekly",
  "weekdays",
  "monthly",
  "monthlyWeekday",
  "yearly",
];
const NEVER: RepeatEnd = { type: "never" };

function presetRepeat(preset: Preset, day: string): Repeat | null {
  const base: Repeat = {
    frequency: "DAILY",
    interval: 1,
    weekdays: [],
    monthlyWeekday: null,
    end: NEVER,
  };
  const weekday = weekdayOf({ type: "date", date: day });
  switch (preset) {
    case "none":
      return null;
    case "daily":
      return base;
    case "weekly":
      return { ...base, frequency: "WEEKLY", weekdays: [weekday] };
    case "weekdays":
      return { ...base, frequency: "WEEKLY", weekdays: ["MO", "TU", "WE", "TH", "FR"] };
    case "monthly":
      return { ...base, frequency: "MONTHLY" };
    case "monthlyWeekday":
      return { ...base, frequency: "MONTHLY", monthlyWeekday: { nth: nthWeekdayOf(day), weekday } };
    case "yearly":
      return { ...base, frequency: "YEARLY" };
  }
}

const same = (a: RepeatChoice, b: RepeatChoice) => JSON.stringify(a) === JSON.stringify(b);

function RepeatField({ form, onChange }: { form: Form; onChange: (repeat: RepeatChoice) => void }) {
  const { t } = useTranslation();
  const { formats } = useCalendar();
  const [kept] = useState(form.repeat === "kept");
  const [custom, setCustom] = useState(false);
  const day = form.startDate;
  const start: ItemTime = { type: "date", date: day };
  const repeat = form.repeat;
  const preset = PRESETS.find((p) => same(presetRepeat(p, day), repeat));
  const current = repeat === "kept" ? "kept" : preset && !custom ? preset : "current";
  const words = (r: Repeat | null) => (r ? repeatWords(r, start, t, formats) : t("repeat.none"));
  return (
    <>
      <div className="flex flex-col gap-1">
        <Dropdown
          label={t("edit.repeat")}
          value={current}
          onChange={(value) => {
            if (value === "custom") {
              setCustom(true);
              if (!repeat || repeat === "kept") onChange(presetRepeat("weekly", day));
            } else if (value === "kept") {
              setCustom(false);
              onChange("kept");
            } else if (value !== "current") {
              setCustom(false);
              onChange(presetRepeat(value as Preset, day));
            }
          }}
          options={[
            ...PRESETS.map((p) => ({ value: p, label: words(presetRepeat(p, day)) })),
            ...(kept
              ? [{ value: "kept", label: t("repeat.kept", { rule: t("repeat.custom") }) }]
              : []),
            ...(current === "current" && repeat !== "kept" && repeat !== null
              ? [{ value: "current", label: words(repeat) }]
              : []),
            { value: "custom", label: t("repeat.custom") },
          ]}
          className={fieldButton}
        />
      </div>
      {current === "current" && repeat && repeat !== "kept" && (
        <CustomRepeat repeat={repeat} day={day} onChange={onChange} />
      )}
    </>
  );
}

function CustomRepeat({
  repeat,
  day,
  onChange,
}: {
  repeat: Repeat;
  day: string;
  onChange: (repeat: Repeat) => void;
}) {
  const { t } = useTranslation();
  const { formats } = useCalendar();
  const set = (changes: Partial<Repeat>) => onChange({ ...repeat, ...changes });
  const weekday = weekdayOf({ type: "date", date: day });
  const days = repeat.weekdays.length > 0 ? repeat.weekdays : [weekday];
  const toggle = (d: Weekday) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    set({ weekdays: WEEKDAYS.filter((x) => next.includes(x)) });
  };
  const endKind = repeat.end.type;
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-canvas p-3">
      <div className="flex items-end gap-2">
        <Labelled label={t("repeat.interval")}>
          {(id) => (
            <input
              id={id}
              type="number"
              min={1}
              max={999}
              value={repeat.interval}
              onChange={(e) =>
                set({ interval: Math.max(1, Math.round(Number(e.target.value) || 1)) })
              }
              className={`${field} w-20`}
            />
          )}
        </Labelled>
        <div className="flex-1">
          <Select
            label={t("repeat.frequency")}
            value={repeat.frequency}
            onChange={(frequency) =>
              set({
                frequency: frequency as Repeat["frequency"],
                weekdays: frequency === "WEEKLY" ? [weekday] : [],
                monthlyWeekday: null,
              })
            }
            options={(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const).map((f) => [
              f,
              t(`repeat.unit.${f}`, { count: repeat.interval }),
            ])}
          />
        </div>
      </div>
      {repeat.frequency === "WEEKLY" && (
        <div role="group" aria-label={t("repeat.on")} className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days.includes(d)}
              aria-label={formats.weekdayName(WEEKDAYS.indexOf(d) + 1)}
              onClick={() => toggle(d)}
              className="grid size-9 place-items-center rounded-full text-small ring-1 ring-line aria-pressed:bg-accent aria-pressed:text-on-accent aria-pressed:ring-transparent focus-visible:outline-2 focus-visible:outline-accent"
            >
              {/* 2024-01-01 was a Monday. */}
              <span aria-hidden="true">
                {formats.weekday(`2024-01-0${WEEKDAYS.indexOf(d) + 1}`)}
              </span>
            </button>
          ))}
        </div>
      )}
      {repeat.frequency === "MONTHLY" && (
        <Select
          label={t("repeat.monthlyOn")}
          value={repeat.monthlyWeekday ? "weekday" : "day"}
          onChange={(value) =>
            set({
              monthlyWeekday: value === "weekday" ? { nth: nthWeekdayOf(day), weekday } : null,
            })
          }
          options={[
            ["day", t("repeat.onDay", { day: Number(day.slice(8, 10)) })],
            [
              "weekday",
              t("repeat.onWeekday", {
                nth: t(`nth.${nthWeekdayOf(day)}.${t(`weekday.gender.${weekday}`)}` as "nth.1.m"),
                weekday: t(`weekday.on.${weekday}`),
              }),
            ],
          ]}
        />
      )}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-small text-ink-muted">{t("repeat.ends")}</legend>
        {(["never", "until", "count"] as const).map((kind) => (
          <label key={kind} className="flex min-h-9 items-center gap-2 text-body">
            <input
              type="radio"
              name="repeat-end"
              checked={endKind === kind}
              onChange={() =>
                set({
                  end:
                    kind === "never"
                      ? NEVER
                      : kind === "count"
                        ? { type: "count", count: 10 }
                        : { type: "until", until: addMonth(day) },
                })
              }
              className="size-4 accent-[var(--color-accent)]"
            />
            {t(`repeat.ends.${kind}`)}
          </label>
        ))}
        {repeat.end.type === "until" && (
          <input
            type="date"
            aria-label={t("repeat.endsOn")}
            value={repeat.end.until}
            onChange={(e) =>
              e.target.value && set({ end: { type: "until", until: e.target.value } })
            }
            className={field}
          />
        )}
        {repeat.end.type === "count" && (
          <input
            type="number"
            min={1}
            max={999}
            aria-label={t("repeat.endsAfter")}
            value={repeat.end.count}
            onChange={(e) =>
              set({
                end: { type: "count", count: Math.max(1, Math.round(Number(e.target.value) || 1)) },
              })
            }
            className={field}
          />
        )}
      </fieldset>
    </div>
  );
}

function addMonth(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

// Reminders

/** The offsets of an item's reminders that count from it, as the menu compares them. */
const offsetsOf = (alarms: readonly AlarmChoice[]) =>
  alarms.flatMap((choice) =>
    choice.kind === "new"
      ? [choice.offsetSeconds]
      : choice.alarm.trigger.type === "relative"
        ? [choice.alarm.trigger.offsetSeconds]
        : [],
  );

function Reminders({
  form,
  onChange,
}: {
  form: Form;
  onChange: (alarms: readonly AlarmChoice[]) => void;
}) {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  const { platform } = useAccounts();
  const [custom, setCustom] = useState(false);
  // What this device added, read as the dialog opens: it does not change while open.
  const [tally] = useState(() => readTally(platform.preferences.get(KEYS.alarmTally)));
  const task = form.kind === "task";
  // A task is at its start, as the calendar shows it: its reminders count from
  // there (design D159); one with only a due, from its due (RFC 5545 §3.6.6).
  const relatedTo = task && form.startless && form.endDate ? "end" : "start";
  const options = { allDay: form.allDay, task };
  const wordsOf = (choice: AlarmChoice) =>
    alarmWords(
      choice.kind === "existing"
        ? choice.alarm
        : {
            trigger: {
              type: "relative",
              relatedTo: choice.relatedTo,
              offsetSeconds: choice.offsetSeconds,
            },
          },
      options,
      t,
      formats,
      timeZone,
    );
  const add = (offsetSeconds: number) => {
    const choice = { kind: "new", relatedTo, offsetSeconds } as const;
    addedAllDay.set(choice, form.allDay);
    onChange([...form.alarms, choice]);
  };
  const taken = offsetsOf(form.alarms);
  // The four most added on this device, then the defaults (design D206).
  const offered = offeredAlarms(tally, form.allDay, taken);
  return (
    <>
      {form.alarms.length > 0 && (
        <ul aria-label={t("edit.reminders")} className="flex flex-col gap-1">
          {form.alarms.map((choice, index) => (
            <li key={index} className="flex min-h-10 items-center gap-2 pl-2 text-body">
              <span className="min-w-0 flex-1">{wordsOf(choice)}</span>
              <button
                type="button"
                className={dialogIcon}
                aria-label={t("edit.removeReminder", { alarm: wordsOf(choice) })}
                onClick={() => onChange(form.alarms.filter((_, i) => i !== index))}
              >
                <CloseIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <MenuButton
        label={t("edit.addReminder")}
        options={[
          ...offered.map((offset) => ({
            value: String(offset),
            label: wordsOf({ kind: "new", relatedTo, offsetSeconds: offset }),
          })),
          { value: "custom", label: t("alarm.custom") },
        ]}
        onChoose={(value) => (value === "custom" ? setCustom(true) : add(Number(value)))}
        className={fieldButton}
      />
      {custom && (
        <CustomReminder
          allDay={form.allDay}
          wordsOf={(offsetSeconds) => wordsOf({ kind: "new", relatedTo, offsetSeconds })}
          taken={taken}
          onAdd={(offset) => {
            setCustom(false);
            add(offset);
          }}
          onCancel={() => setCustom(false)}
        />
      )}
    </>
  );
}

/**
 * A reminder of the user's own, as Google's custom notification: an amount
 * of minutes, hours, days or weeks before a timed item, or of days or weeks
 * before an all-day one at a time of the day (design D206).
 */
function CustomReminder({
  allDay,
  wordsOf,
  taken,
  onAdd,
  onCancel,
}: {
  allDay: boolean;
  wordsOf: (offsetSeconds: number) => string;
  /** The item's reminders: one of them is not added twice, and says so. */
  taken: readonly number[];
  onAdd: (offsetSeconds: number) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // As typed, so it can be emptied to type another; read as a number to add.
  const [typed, setTyped] = useState(allDay ? "1" : "10");
  const amount =
    typed.trim() === "" ? null : Math.min(MOST, Math.max(0, Math.round(Number(typed))));
  const [unit, setUnit] = useState<AlarmUnit>(allDay ? "days" : "minutes");
  const [time, setTime] = useState("09:00");
  const units = UNITS[allDay ? "allDay" : "timed"];
  // A switch of "All day" meanwhile leaves a unit it has not: its first.
  const shown = (units as readonly AlarmUnit[]).includes(unit) ? unit : units[0];
  const offset =
    amount === null || Number.isNaN(amount) ? null : customOffset(amount, shown, allDay, time);
  const had = offset !== null && taken.includes(offset);
  const submit = () => offset !== null && !had && onAdd(offset);
  return (
    <div
      role="group"
      aria-label={t("alarm.custom.title")}
      className="flex flex-col gap-3 rounded-2xl bg-canvas p-3"
    >
      <span className="text-small text-ink-muted">{t("alarm.custom.before")}</span>
      <div className="flex gap-2">
        <div className="w-24 shrink-0">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={MOST}
            aria-label={t("alarm.custom.amount")}
            value={typed}
            autoFocus
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds the reminder, not saves the item; not one that
              // ends an input method's composition.
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className={field}
          />
        </div>
        <div className="min-w-0 flex-1">
          <Dropdown
            label={t("alarm.custom.unit")}
            value={shown}
            onChange={(next) => setUnit(next as AlarmUnit)}
            options={units.map((u) => ({
              value: u,
              label: t(`alarm.unit.${u}`, { count: amount ?? 0 }),
            }))}
            className={fieldButton}
          />
        </div>
      </div>
      {allDay && (
        <div className="flex items-center gap-2">
          <span className="text-body text-ink-muted">{t("alarm.custom.at")}</span>
          <TimeSelect label={t("alarm.custom.time")} value={time} onChange={setTime} />
        </div>
      )}
      <p aria-live="polite" className="text-body">
        {offset === null ? t("alarm.custom.empty") : wordsOf(offset)}
        {had && <span className="block text-small text-ink-muted">{t("alarm.custom.had")}</span>}
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={textButton}>
          {t("alarm.custom.cancel")}
        </button>
        <button
          type="button"
          disabled={offset === null || had}
          onClick={submit}
          className={primaryButton}
        >
          {t("alarm.custom.add")}
        </button>
      </div>
    </div>
  );
}
