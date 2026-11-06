// The font and the text size in Settings' "General" group (design D294,
// D295), under the theme, with one live preview above them: today's heading,
// an event and a task, drawn by the Agenda's own components, so they change
// as the choice does. A bundled font is chosen only once its files came: one
// that cannot come (offline, never kept) leaves the font as it was, and the
// row says so.
import { CalendarObject, createItem } from "@astrotime/core";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { addDays } from "../calendar/dates.ts";
import { expand, type Entry } from "../calendar/query.ts";
import { FAMILIES, FONTS, loadFont, useFontFailure, type BundledFont } from "../fonts/index.ts";
import { useNow } from "../hooks.ts";
import { addTypeStrings } from "../i18n/type.ts";
import { TEXT_SIZES, useSettings } from "../settings.ts";
import { useCalendar } from "./context.ts";
import { AgendaCard } from "./items.tsx";
import { Select } from "./select.tsx";
import { DayHeader } from "./time-grid.tsx";

export function TypeSettings({ rowClassName }: { rowClassName: string }) {
  const { t, i18n } = useTranslation();
  addTypeStrings(i18n);
  const { settings, change } = useSettings();
  const failed = useFontFailure();
  // The font being fetched, and the last one asked for.
  const [pending, setPending] = useState<BundledFont | null>(null);
  const [asked, setAsked] = useState<BundledFont | null>(null);
  const sizeId = useId();
  const nameOf = (font: (typeof FONTS)[number]) =>
    font === "system" ? t("settings.font.system") : FAMILIES[font].name;
  // The last pick: a font whose files come after a later pick's is not applied.
  const latest = useRef(0);
  const pick = (value: string) => {
    const font = FONTS.find((name) => name === value) ?? "system";
    const request = ++latest.current;
    if (font === "system") {
      setPending(null);
      change({ font });
      return;
    }
    setPending(font);
    setAsked(font);
    loadFont(font)
      .then(
        () => request === latest.current && change({ font }),
        () => {},
      )
      .finally(() => request === latest.current && setPending(null));
  };
  const hint =
    pending !== null
      ? t("settings.font.loading", { font: FAMILIES[pending].name })
      : failed !== null && (failed === settings.font || failed === asked)
        ? t("settings.font.failed", { font: FAMILIES[failed].name })
        : null;
  const percent = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, {
    style: "percent",
  });
  const index = TEXT_SIZES.indexOf(settings.textSize);
  return (
    <>
      <TypePreview />
      <div className="flex flex-col">
        <div className={rowClassName}>
          <Select
            label={t("settings.font")}
            labelClassName="min-w-0 flex-1"
            value={settings.font}
            onChange={pick}
            options={FONTS.map((font) => ({ value: font, label: nameOf(font) }))}
            className="h-9 max-w-full min-w-40 rounded-lg bg-raised pr-1 pl-2"
          />
        </div>
        <p aria-live="polite" className="px-4 text-note text-ink-muted">
          {hint}
        </p>
      </div>
      <div className="flex flex-col gap-1 px-4 py-2 text-body">
        <div className="flex items-center gap-3">
          <label htmlFor={sizeId} className="min-w-0 flex-1">
            {t("settings.textSize")}
          </label>
          <span aria-hidden="true" className="text-ink-muted tabular-nums">
            {percent.format(settings.textSize / 100)}
          </span>
        </div>
        <input
          id={sizeId}
          type="range"
          min={0}
          max={TEXT_SIZES.length - 1}
          step={1}
          value={index}
          aria-valuetext={percent.format(settings.textSize / 100)}
          onChange={(event) => {
            const size = TEXT_SIZES[Number(event.target.value)];
            if (size !== undefined) change({ textSize: size });
          }}
          className="h-11 w-full cursor-pointer accent-accent"
        />
      </div>
    </>
  );
}

/** Today's event and task of the preview, in the user's words. */
function previewEntries(today: string, timeZone: string, event: string, task: string): Entry[] {
  const at = (time: string) => ({ type: "floating", local: `${today}T${time}:00` }) as const;
  const make = (kind: "event" | "task", ics: string, id: string) =>
    expand(
      CalendarObject.parse(ics),
      { id, calendarId: kind },
      {
        from: today,
        to: addDays(today, 1),
        timeZone,
      },
    );
  return [
    ...make(
      "event",
      createItem(
        "event",
        { summary: event, time: { start: at("10:00"), end: at("11:00") } },
        { now: 0, uid: "preview-event" },
      ),
      "preview-event",
    ),
    ...make(
      "task",
      createItem(
        "task",
        { summary: task, time: { start: null, end: at("15:00") }, color: "seagreen" },
        { now: 0, uid: "preview-task" },
      ),
      "preview-task",
    ),
  ];
}

/** The preview: drawn as the Agenda draws a day, and inert, since nothing in it is the user's. */
function TypePreview() {
  const { t, i18n } = useTranslation();
  addTypeStrings(i18n);
  const { timeZone } = useCalendar();
  const { today } = useNow(timeZone);
  const entries = previewEntries(
    today,
    timeZone,
    t("settings.preview.event"),
    t("settings.preview.task"),
  );
  return (
    <figure
      aria-label={t("settings.preview")}
      className="mx-3 mt-2 mb-1 rounded-xl bg-tile py-1 pr-2"
    >
      <div inert className="flex gap-1">
        <div className="w-14 shrink-0">
          <DayHeader day={today} today={today} level={3} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
          {entries.map((entry) => (
            <AgendaCard key={entry.key} entry={entry} allDay={false} part={null} />
          ))}
        </div>
      </div>
    </figure>
  );
}
