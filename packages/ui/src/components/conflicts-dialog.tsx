// The Conflicts list (docs/plans/foundation.md#D6), opened from the accounts
// dialog: each refused change of ours with the server's version, the fields
// that differ in words, and "Keep the server's" or "Apply mine again".
import { repeatOf, timesOf, type CalendarObject, type Item } from "@astrotime/core";
import type { Store } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { applyMine, conflictViews, keepServer, type ConflictView } from "../calendar/conflicts.ts";
import { addDays } from "../calendar/dates.ts";
import type { Formats } from "../calendar/format.ts";
import { liveQuery } from "../calendar/live.ts";
import { rightsOf } from "../calendar/rights.ts";
import { alarmOptions, alarmWords, repeatWords } from "../calendar/words.ts";
import { useCalendar } from "./context.ts";
import { CloseIcon } from "./icons.tsx";
import { dialogIcon, sheet } from "./item-details.tsx";
import { primaryButton, textButton } from "./sign-in-dialog.tsx";

/** The fields worded in the list; any other is "other details". */
const NAMED = new Set([
  "summary",
  "time",
  "location",
  "description",
  "rrule",
  "exdate",
  "alarms",
  "status",
  "occurrences",
  "color",
  "priority",
  "categories",
  "percent-complete",
  "completed",
  "attendee",
]);

export function ConflictsDialog({
  store,
  open,
  onClose,
  onChanged,
}: {
  store: Store;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [views, setViews] = useState<ConflictView[]>([]);
  useEffect(
    () =>
      open
        ? liveQuery(store, () => conflictViews(store, t("local.calendar")), setViews)
        : undefined,
    [store, open, t],
  );
  const act = (work: Promise<void>, changed: boolean) =>
    work.then(
      () => changed && onChanged(),
      (error: unknown) => console.error(error),
    );
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[100] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:pointer-events-none" />
        <Dialog.Popup className={`${sheet} z-[110] sm:w-[min(40rem,calc(100vw-2rem))]`}>
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2">
            <Dialog.Close className={dialogIcon} aria-label={t("details.close")}>
              <CloseIcon className="size-5" />
            </Dialog.Close>
            <Dialog.Title className="min-w-0 flex-1 truncate text-title">
              {t("conflicts.title")}
            </Dialog.Title>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6">
            <Dialog.Description className="text-body text-ink-muted">
              {views.length > 0 ? t("conflicts.intro") : t("conflicts.none")}
            </Dialog.Description>
            <ul className="mt-3 flex flex-col gap-3">
              {views.map((view) => (
                <ConflictCard
                  key={view.conflict.id}
                  view={view}
                  onKeep={() => void act(keepServer(store, view), false)}
                  onApply={() => void act(applyMine(store, view), true)}
                />
              ))}
            </ul>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ConflictCard({
  view,
  onKeep,
  onApply,
}: {
  view: ConflictView;
  onKeep: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  const ours = itemOf(view.ours);
  const theirs = itemOf(view.theirs);
  const title = ours?.summary?.trim() || theirs?.summary?.trim() || t("item.untitled");
  const named = view.fields.filter((field) => NAMED.has(field));
  const words = [
    ...named.map((field) => t(`field.${field}` as "field.summary")),
    ...(named.length < view.fields.length ? [t("field.other")] : []),
  ];
  // Applying ours again is an edit of what the calendar holds (D37, D107).
  const readOnly = view.calendar !== undefined && !rightsOf(view.calendar).edit;
  const shown = named.filter((field) => VALUED.has(field));
  return (
    <li aria-label={title} className="rounded-2xl bg-canvas p-3">
      <p className="text-row font-medium break-words">
        {t("conflicts.item", { title, calendar: view.calendar?.name ?? "" })}
      </p>
      <p className="mt-0.5 text-small text-ink-muted">
        {t("conflicts.differs", { fields: words.join(", ") })}
      </p>
      {shown.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-small">
          {(
            [
              ["conflicts.yours", view.ours],
              ["conflicts.server", view.theirs],
            ] as const
          ).map(([label, object]) => (
            <section key={label} aria-label={t(label)} className="rounded-xl bg-raised p-2.5">
              <h3 className="text-note font-medium tracking-wide text-ink-muted uppercase">
                {t(label)}
              </h3>
              <dl className="mt-1 flex flex-col gap-1">
                {shown.map((field) => (
                  <div key={field}>
                    <dt className="sr-only">{t(`field.${field}` as "field.summary")}</dt>
                    <dd className="break-words whitespace-pre-wrap">
                      {valueOf(object, field, { t, formats, timeZone }) || t("conflicts.empty")}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
      {readOnly && <p className="mt-2 text-small text-ink-muted">{t("conflicts.readOnly")}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" className={textButton} onClick={onKeep}>
          {t("conflicts.keepServer")}
        </button>
        {!readOnly && (
          <button type="button" className={primaryButton} onClick={onApply}>
            {t("conflicts.applyMine")}
          </button>
        )}
      </div>
    </li>
  );
}

/** The fields whose values are shown side by side. */
const VALUED = new Set(["summary", "time", "location", "description", "rrule", "alarms", "status"]);

function itemOf(object: CalendarObject): Item | null {
  return object.master ?? object.exceptions[0] ?? null;
}

/** A field's value as the Conflicts list shows it, in words. */
export function valueOf(
  object: CalendarObject,
  field: string,
  { t, formats, timeZone }: { t: TFunction; formats: Formats; timeZone: string },
): string {
  const item = itemOf(object);
  if (!item) return "";
  switch (field) {
    case "summary":
      return item.summary ?? "";
    case "location":
      return item.location ?? "";
    case "description":
      return item.description ?? "";
    case "status":
      return item.status ?? "";
    case "rrule": {
      const rule = repeatOf(object);
      const { start, end } = timesOf(object, null);
      return rule ? repeatWords(rule.repeat, start ?? end, t, formats) : t("repeat.none");
    }
    case "alarms":
      return item.alarms
        .map((alarm) => alarmWords(alarm, alarmOptions(item, alarm), t, formats, timeZone))
        .join("\n");
    case "time": {
      const { start, end } = timesOf(object, null);
      if (start?.type === "date") {
        const last =
          end?.type === "date" && item.kind === "event" ? addDays(end.date, -1) : start.date;
        return last > start.date ? formats.dateRange(start.date, last) : formats.date(start.date);
      }
      if (start && end) return formats.timeRange(start, end, timeZone);
      const time = start ?? end;
      return time ? formats.time(time, timeZone) : "";
    }
    default:
      return "";
  }
}
