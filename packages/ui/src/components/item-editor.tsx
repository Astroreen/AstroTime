// The edit dialog (docs/plans/foundation.md#D9, D10), as Google Calendar's:
// the whole screen on a phone, a dialog on a wide screen. Event or task when
// creating; title; all day; start and end (a task's optional start and due);
// the zone when it is not the user's; repeat presets and a custom rule;
// reminders; the calendar; colour; location; description; a task's status,
// priority, progress and tags. Enter in a field saves, Escape closes.
import {
  nthWeekdayOf,
  WEEKDAYS,
  weekdayOf,
  type ItemTime,
  type Repeat,
  type RepeatEnd,
  type TaskStatus,
  type Weekday,
} from "@astrotime/core";
import type { Calendar } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import { Switch } from "@base-ui/react/switch";
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  switchKind,
  withStartDate,
  type AlarmChoice,
  type Form,
  type Problem,
  type RepeatChoice,
} from "../calendar/editing.ts";
import { alarmPresets, alarmWords, repeatWords } from "../calendar/words.ts";
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
import { dialogIcon, priorityOf, sheet } from "./item-details.tsx";
import { primaryButton } from "./sign-in-dialog.tsx";

/** RFC 7986 `COLOR`s to pick from: CSS names, as Nextcloud writes them. */
const COLORS = [
  "tomato",
  "orange",
  "gold",
  "mediumseagreen",
  "lightseagreen",
  "steelblue",
  "slateblue",
  "palevioletred",
  "slategray",
] as const;

export interface EditorState {
  /** `false`: a new item, whose kind can still switch. */
  readonly existing: boolean;
  readonly form: Form;
  /** Why the form cannot be saved, or why saving it did not work. */
  readonly problem: Problem | "failed" | "gone" | "inDoubt" | "noSplit" | null;
  readonly saving: boolean;
}

const field =
  "h-10 w-full min-w-0 rounded-lg bg-canvas px-3 text-input text-ink ring-1 ring-line outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-accent [color-scheme:inherit]";

export function ItemEditor({
  state,
  calendars,
  onChange,
  onSave,
  onClose,
}: {
  state: EditorState | null;
  /** The calendars the item may be saved in. */
  calendars: readonly Calendar[];
  onChange: (form: Form) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const form = state?.form;
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
    <Dialog.Root open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[120] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className={`${sheet} z-[130] sm:w-[min(36rem,calc(100vw-2rem))]`}>
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
                calendars={calendars}
                onChange={onChange}
              />
              {state.problem && (
                <p
                  role="alert"
                  className="mt-4 rounded-xl bg-danger-soft p-3 text-body text-danger"
                >
                  {t(state.problem === "failed" ? "edit.failed" : `edit.problem.${state.problem}`)}
                </p>
              )}
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Fields({
  form,
  existing,
  calendars,
  onChange,
}: {
  form: Form;
  existing: boolean;
  calendars: readonly Calendar[];
  onChange: (form: Form) => void;
}) {
  const { t } = useTranslation();
  const { timeZone } = useCalendar();
  const set = (changes: Partial<Form>) => onChange({ ...form, ...changes });
  const event = form.kind === "event";
  return (
    <div className="flex flex-col gap-4">
      {!existing && (
        <div role="radiogroup" aria-label={t("edit.kind")} className="flex gap-2">
          {(["event", "task"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={form.kind === kind}
              onClick={() => onChange(switchKind(form, kind))}
              className="rounded-full px-4 py-1.5 text-body font-medium ring-1 ring-line aria-checked:bg-accent-soft aria-checked:text-accent aria-checked:ring-transparent focus-visible:outline-2 focus-visible:outline-accent"
            >
              {t(`edit.kind.${kind}`)}
            </button>
          ))}
        </div>
      )}
      <input
        aria-label={t("edit.title")}
        placeholder={t("edit.titlePlaceholder")}
        value={form.summary}
        autoFocus={!existing}
        onChange={(e) => set({ summary: e.target.value })}
        className="h-12 w-full border-b border-line bg-transparent px-1 text-headline text-ink outline-none placeholder:text-ink-muted focus:border-accent"
      />

      <Section icon={<ClockIcon className="size-5" />}>
        <Toggle
          label={t("edit.allDay")}
          checked={form.allDay}
          onChange={(allDay) => set({ allDay })}
        />
        {event ? (
          <>
            <DateTime
              form={form}
              dateLabel={t("edit.startDate")}
              timeLabel={t("edit.startTime")}
              date={form.startDate}
              time={form.startTime}
              onDate={(date) => onChange(withStartDate(form, date))}
              onTime={(startTime) => set(keepLength(form, startTime))}
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
            <Toggle
              label={t("edit.hasStart")}
              checked={form.startDate !== ""}
              onChange={(on) => set({ startDate: on ? form.endDate || todayOf(timeZone) : "" })}
            />
            {form.startDate !== "" && (
              <DateTime
                form={form}
                dateLabel={t("edit.startDate")}
                timeLabel={t("edit.startTime")}
                date={form.startDate}
                time={form.startTime}
                onDate={(date) => onChange(withStartDate(form, date))}
                onTime={(startTime) => set({ startTime })}
              />
            )}
            <Toggle
              label={t("edit.hasDue")}
              checked={form.endDate !== ""}
              onChange={(on) => set({ endDate: on ? form.startDate || todayOf(timeZone) : "" })}
            />
            {form.endDate !== "" && (
              <DateTime
                form={form}
                dateLabel={t("edit.dueDate")}
                timeLabel={t("edit.dueTime")}
                date={form.endDate}
                time={form.endTime}
                onDate={(endDate) => set({ endDate })}
                onTime={(endTime) => set({ endTime })}
              />
            )}
          </>
        )}
        {!form.allDay && form.zone === null && (
          <p className="text-small text-ink-muted">{t("edit.floating")}</p>
        )}
        {!form.allDay && form.zone !== null && form.zone !== timeZone && (
          <p className="text-small text-ink-muted">{t("edit.zone", { zone: form.zone })}</p>
        )}
      </Section>

      <Section icon={<RepeatIcon className="size-5" />}>
        <RepeatField form={form} onChange={(repeat) => set({ repeat })} />
      </Section>

      <Section icon={<BellIcon className="size-5" />}>
        <Reminders form={form} onChange={(alarms) => set({ alarms })} />
      </Section>

      <Section icon={<CalendarIcon className="size-5" />}>
        <Select
          label={t(event ? "edit.calendar" : "edit.list")}
          value={form.calendarId}
          onChange={(calendarId) => set({ calendarId })}
          options={calendars.map((c) => [c.id, c.name])}
        />
        {calendars.length === 0 && <p className="text-small text-danger">{t("edit.noCalendar")}</p>}
      </Section>

      <Section icon={<PaletteIcon className="size-5" />}>
        <Colors
          value={form.color}
          calendarColor={calendars.find((c) => c.id === form.calendarId)?.color ?? null}
          onChange={(color) => set({ color })}
        />
      </Section>

      <Section icon={<PlaceIcon className="size-5" />}>
        <input
          aria-label={t("edit.location")}
          placeholder={t("edit.location")}
          value={form.location}
          onChange={(e) => set({ location: e.target.value })}
          className={field}
        />
      </Section>

      <Section icon={<NotesIcon className="size-5" />}>
        <textarea
          aria-label={t("edit.description")}
          placeholder={t("edit.description")}
          value={form.description}
          rows={4}
          onChange={(e) => set({ description: e.target.value })}
          className={`${field} h-auto py-2`}
        />
      </Section>

      {!event && (
        <Section icon={<NotesIcon className="size-5" />}>
          <Select
            label={t("edit.status")}
            value={form.status}
            onChange={(status) => set({ status: status as TaskStatus })}
            options={(["NEEDS-ACTION", "IN-PROCESS", "COMPLETED", "CANCELLED"] as const).map(
              (s) => [s, t(`status.${s}`)],
            )}
          />
          <Select
            label={t("edit.priority")}
            value={form.priority === null ? "" : priorityOf(form.priority)}
            onChange={(value) =>
              set({
                priority: value === "" ? null : value === "high" ? 1 : value === "medium" ? 5 : 9,
              })
            }
            options={[
              ["", t("priority.none")],
              ["high", t("priority.high")],
              ["medium", t("priority.medium")],
              ["low", t("priority.low")],
            ]}
          />
          <Labelled label={t("edit.percent")}>
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                max={100}
                step={5}
                value={form.percent ?? ""}
                onChange={(e) =>
                  set({
                    percent:
                      e.target.value === ""
                        ? null
                        : Math.max(0, Math.min(100, Math.round(Number(e.target.value)))),
                  })
                }
                className={field}
              />
            )}
          </Labelled>
          <Labelled label={t("edit.categories")}>
            {(id) => (
              <input
                id={id}
                value={form.categories}
                onChange={(e) => set({ categories: e.target.value })}
                className={field}
              />
            )}
          </Labelled>
        </Section>
      )}
    </div>
  );
}

function todayOf(timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone }).format(Date.now());
}

/** A new start keeps the event's length, as Google moves its end with it. */
function keepLength(form: Form, startTime: string): Partial<Form> {
  if (form.kind !== "event" || form.startDate !== form.endDate) return { startTime };
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const length = minutes(form.endTime) - minutes(form.startTime);
  const end = minutes(startTime) + Math.max(length, 0);
  if (length <= 0 || end >= 1440) return { startTime };
  const pad = (n: number) => String(n).padStart(2, "0");
  return { startTime, endTime: `${pad(Math.floor(end / 60))}:${pad(end % 60)}` };
}

function Section({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-2.5 shrink-0 text-ink-muted">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </div>
  );
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
    <label className="flex min-h-10 cursor-pointer items-center gap-3 text-row">
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

function DateTime({
  form,
  dateLabel,
  timeLabel,
  date,
  time,
  onDate,
  onTime,
}: {
  form: Form;
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
      {!form.allDay && <TimeSelect label={timeLabel} value={time} onChange={onTime} />}
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
function TimeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (time: string) => void;
}) {
  const { formats } = useCalendar();
  const times = QUARTERS.includes(value) ? QUARTERS : [...QUARTERS, value].toSorted();
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${field} flex-[2]`}
    >
      {times.map((time) => (
        <option key={time} value={time}>
          {formats.clock(time)}
        </option>
      ))}
    </select>
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
    <Labelled label={label}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={field}>
          {options.map(([option, name]) => (
            <option key={option} value={option}>
              {name}
            </option>
          ))}
        </select>
      )}
    </Labelled>
  );
}

function Colors({
  value,
  calendarColor,
  onChange,
}: {
  value: string | null;
  /** The calendar's own colour, the first choice (design D47). */
  calendarColor: string | null;
  onChange: (color: string | null) => void;
}) {
  const { t } = useTranslation();
  const choices: ((typeof COLORS)[number] | null)[] = [null, ...COLORS];
  return (
    <div
      role="radiogroup"
      aria-label={t("edit.color")}
      className="flex flex-wrap items-center gap-2 py-1.5"
    >
      {choices.map((color) => (
        <button
          key={color ?? "calendar"}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color ? t(`color.${color}`) : t("edit.colorDefault")}
          title={color ? t(`color.${color}`) : t("edit.colorDefault")}
          onClick={() => onChange(color)}
          className="item-color grid size-8 place-items-center rounded-full bg-[var(--item-fill)] ring-1 ring-line aria-checked:ring-2 aria-checked:ring-accent aria-checked:ring-offset-2 aria-checked:ring-offset-raised focus-visible:outline-2 focus-visible:outline-accent"
          style={{ "--item": color ?? calendarColor ?? undefined } as CSSProperties}
        ></button>
      ))}
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
  const day = form.startDate || form.endDate || todayOf("UTC");
  const start: ItemTime = { type: "date", date: day };
  const repeat = form.repeat;
  const preset = PRESETS.find((p) => same(presetRepeat(p, day), repeat));
  const current = repeat === "kept" ? "kept" : preset && !custom ? preset : "current";
  const words = (r: Repeat | null) => (r ? repeatWords(r, start, t, formats) : t("repeat.none"));
  return (
    <>
      <Labelled label={t("edit.repeat")}>
        {(id) => (
          <select
            id={id}
            value={current}
            onChange={(e) => {
              const value = e.target.value;
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
            className={field}
          >
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {words(presetRepeat(p, day))}
              </option>
            ))}
            {kept && <option value="kept">{t("repeat.kept", { rule: t("repeat.custom") })}</option>}
            {current === "current" && repeat !== "kept" && repeat !== null && (
              <option value="current">{words(repeat)}</option>
            )}
            <option value="custom">{t("repeat.custom")}</option>
          </select>
        )}
      </Labelled>
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

function Reminders({
  form,
  onChange,
}: {
  form: Form;
  onChange: (alarms: readonly AlarmChoice[]) => void;
}) {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  const task = form.kind === "task";
  // A task's reminder is before its due when it has one (RFC 5545 §3.8.6.3: RELATED=END).
  const relatedTo = task && form.endDate ? "end" : "start";
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
  const presets = alarmPresets(form.allDay);
  return (
    <>
      {form.alarms.length > 0 && (
        <ul aria-label={t("edit.reminders")} className="flex flex-col gap-1">
          {form.alarms.map((choice, index) => (
            <li key={index} className="flex min-h-9 items-center gap-2 text-body">
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
      <select
        aria-label={t("edit.addReminder")}
        value=""
        onChange={(e) => {
          if (e.target.value === "") return;
          onChange([
            ...form.alarms,
            { kind: "new", relatedTo, offsetSeconds: Number(e.target.value) },
          ]);
        }}
        className={field}
      >
        <option value="">{t("edit.addReminder")}</option>
        {presets.map((offset) => (
          <option key={offset} value={offset}>
            {wordsOf({ kind: "new", relatedTo, offsetSeconds: offset })}
          </option>
        ))}
      </select>
    </>
  );
}
