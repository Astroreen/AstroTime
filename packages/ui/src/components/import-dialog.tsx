// The import dialog (docs/plans/import.md#D265–#D271), opened from
// Settings with the file picked: it reads the file on the device, shows each
// source with what it holds and where it goes, asks once about items
// already there that differ, writes through the store in batches with a
// count and "Stop", and says what came of it. Loaded with its first opening
// (D273), its strings with it.
import type { Calendar } from "@astrotime/storage";
import type { SplitProblem } from "@astrotime/core/split";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { addImportStrings } from "../i18n/import.ts";
import {
  destinationOf,
  duplicatesOf,
  NEW,
  runImport,
  targetsFor,
  type Choice,
  type Destination,
  type Duplicates,
  type Imported,
} from "../import/plan.ts";
import {
  MAX_FILE_BYTES,
  NotImportableError,
  readImport,
  type ReadFile,
  type Source,
} from "../import/read.ts";
import { useAccounts } from "./accounts-context.tsx";
import { Dot } from "./color-select.tsx";
import { CheckCircleIcon, CloseIcon, PlusIcon } from "./icons.tsx";
import { Select } from "./select.tsx";
import { primaryButton, textButton } from "./buttons.ts";
import { DialogBackdrop, DialogPopup, dialogIcon, sheet } from "./dialog-parts.tsx";

type Step =
  | { readonly name: "reading" }
  | { readonly name: "failed"; readonly message: string }
  | { readonly name: "preview"; readonly read: ReadFile }
  | { readonly name: "asking"; readonly read: ReadFile; readonly duplicates: Duplicates }
  | { readonly name: "importing"; readonly done: number; readonly total: number }
  | { readonly name: "done"; readonly result: Imported };

export function ImportDialog({
  file,
  onClose,
  calendars,
  hidden,
  colorOf,
}: {
  /** The file picked; none while closed. */
  file: File | null;
  onClose: () => void;
  calendars: readonly Calendar[];
  hidden: ReadonlySet<string>;
  colorOf: (calendar: Calendar) => string;
}) {
  const { t, i18n } = useTranslation();
  addImportStrings(i18n);
  const { store, timeZone, scheduler } = useAccounts();
  const [step, setStep] = useState<Step>({ name: "reading" });
  const [destinations, setDestinations] = useState<ReadonlyMap<string, Destination>>(new Map());
  const stop = useRef(false);
  /**
   * Where the import stands, kept apart from what is drawn: a second tap on
   * "Import" or on an answer, before the first's await came back, finds it
   * taken and does nothing, so one file is never written twice.
   */
  const phase = useRef<"idle" | "checking" | "asked" | "running">("idle");
  const [checking, setChecking] = useState(false);
  const titleId = useId();

  // The file read once it is picked; a closing leaves what a late read brings.
  useEffect(() => {
    if (!file) return;
    let current = true;
    phase.current = "idle";
    setStep({ name: "reading" });
    void readPicked(file, {
      language: i18n.resolvedLanguage ?? i18n.language,
      timeZone,
      newUid: () => crypto.randomUUID(),
    }).then((read) => {
      if (!current) return;
      if (read instanceof Error) {
        setStep({
          name: "failed",
          message:
            read instanceof NotImportableError && read.tooBig
              ? t("import.tooBig", { file: file.name, size: MAX_FILE_BYTES / 1024 / 1024 })
              : read instanceof NotImportableError
                ? t("import.notCalendar", { file: file.name })
                : t("import.unreadable", { file: file.name, message: read.message }),
        });
        return;
      }
      setDestinations(
        new Map(
          read.sources.map((source) => [source.id, destinationOf(source, calendars, hidden)]),
        ),
      );
      setStep({ name: "preview", read });
    });
    return () => {
      current = false;
    };
    // Read once per file: the calendars offered later do not read it again.
  }, [file]);

  const start = (read: ReadFile, duplicates: Duplicates, choice: Choice) => {
    if (phase.current !== "checking" && phase.current !== "asked") return;
    phase.current = "running";
    stop.current = false;
    setStep({ name: "importing", done: 0, total: 0 });
    runImport({
      store,
      sources: read.sources,
      destinations,
      duplicates,
      choice,
      accountName: t("local.account"),
      newUid: () => crypto.randomUUID(),
      onProgress: (done, total) => setStep({ name: "importing", done, total }),
      stopped: () => stop.current,
    }).then(
      (result) => {
        setStep({ name: "done", result });
        // Uploaded as any change made here is (D5).
        void scheduler.requested();
      },
      (error: unknown) =>
        setStep({ name: "failed", message: t("import.failed", { message: String(error) }) }),
    );
  };

  const proceed = (read: ReadFile) => {
    if (phase.current !== "idle") return;
    phase.current = "checking";
    setChecking(true);
    duplicatesOf(store, read.sources, destinations).then(
      (duplicates) => {
        setChecking(false);
        if (duplicates.changed > 0) {
          phase.current = "asked";
          setStep({ name: "asking", read, duplicates });
        } else start(read, duplicates, "skip");
      },
      (error: unknown) => {
        setChecking(false);
        setStep({ name: "failed", message: t("import.failed", { message: String(error) }) });
      },
    );
  };

  // Closing waits for the import's own end: a check under way goes on into writes.
  const busy = step.name === "importing" || checking;
  return (
    <Dialog.Root open={file !== null} onOpenChange={(next) => !next && !busy && onClose()}>
      <Dialog.Portal>
        {/* Over Settings: its own backdrop, which Base UI leaves out of a nested dialog by default. */}
        <DialogBackdrop
          forceRender
          className="fixed inset-0 z-[120] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"
        />
        <DialogPopup
          aria-labelledby={titleId}
          className={`${sheet} z-[130] sm:w-[min(36rem,calc(100vw-2rem))]`}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2">
            <Dialog.Close className={dialogIcon} aria-label={t("import.close")} disabled={busy}>
              <CloseIcon className="size-5" />
            </Dialog.Close>
            <Dialog.Title id={titleId} className="min-w-0 flex-1 truncate text-title">
              {t("import.title")}
            </Dialog.Title>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pt-4 pb-6 sm:px-5">
            {file ? (
              <p className="truncate px-1 text-note text-ink-muted" title={file.name}>
                {file.name}
              </p>
            ) : null}
            {step.name === "reading" && file ? (
              <p role="status" className="px-1 text-body">
                {t("import.reading", { file: file.name })}
              </p>
            ) : null}
            {step.name === "failed" ? (
              <p role="alert" className="rounded-2xl bg-danger-soft p-4 text-body">
                {step.message}
              </p>
            ) : null}
            {step.name === "preview" ? (
              <Preview
                read={step.read}
                calendars={calendars}
                colorOf={colorOf}
                destinations={destinations}
                onChange={(id, destination) =>
                  setDestinations(new Map([...destinations, [id, destination]]))
                }
              />
            ) : null}
            {step.name === "asking" ? <Asking duplicates={step.duplicates} /> : null}
            {step.name === "importing" ? <Progress done={step.done} total={step.total} /> : null}
            {step.name === "done" ? <Done result={step.result} /> : null}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-3 py-3 sm:px-5">
            {step.name === "preview" ? (
              <>
                <Dialog.Close className={textButton}>{t("import.cancel")}</Dialog.Close>
                <button
                  type="button"
                  className={primaryButton}
                  disabled={
                    checking || step.read.sources.every((source) => source.items.length === 0)
                  }
                  onClick={() => proceed(step.read)}
                >
                  {t("import.start")}
                </button>
              </>
            ) : step.name === "asking" ? (
              <>
                <button
                  type="button"
                  className={textButton}
                  onClick={() => {
                    phase.current = "idle";
                    setStep({ name: "preview", read: step.read });
                  }}
                >
                  {t("import.back")}
                </button>
                {(["skip", "copy", "update"] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className={choice === "update" ? primaryButton : textButton}
                    onClick={() => start(step.read, step.duplicates, choice)}
                  >
                    {t(`import.${choice}`)}
                  </button>
                ))}
              </>
            ) : step.name === "importing" ? (
              <button type="button" className={textButton} onClick={() => (stop.current = true)}>
                {t("import.stop")}
              </button>
            ) : step.name === "reading" ? (
              <Dialog.Close className={textButton}>{t("import.cancel")}</Dialog.Close>
            ) : (
              <Dialog.Close className={primaryButton}>{t("import.close")}</Dialog.Close>
            )}
          </div>
        </DialogPopup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The file picked, read on the device; what went wrong as an error, not thrown. */
async function readPicked(
  file: File,
  options: { language: string; timeZone: string; newUid: () => string },
): Promise<ReadFile | Error> {
  // Not even read into memory past the limit.
  if (file.size > MAX_FILE_BYTES)
    return new NotImportableError(`${file.name} is too big.`, { tooBig: true });
  try {
    return await readImport(
      { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
      options,
    );
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function Preview({
  read,
  calendars,
  colorOf,
  destinations,
  onChange,
}: {
  read: ReadFile;
  calendars: readonly Calendar[];
  colorOf: (calendar: Calendar) => string;
  destinations: ReadonlyMap<string, Destination>;
  onChange: (id: string, destination: Destination) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {read.guessed ? (
        <p className="px-1 text-note text-ink-muted">
          {t("import.guessed", { encoding: read.guessed })}
        </p>
      ) : null}
      {read.unread.length > 0 ? (
        <p className="px-1 text-note text-ink-muted">
          {t("import.unread", { count: read.unread.length, names: read.unread.join(", ") })}
        </p>
      ) : null}
      {read.sources.map((source) => (
        <SourceCard
          key={source.id}
          source={source}
          calendars={calendars}
          colorOf={colorOf}
          destination={destinations.get(source.id) ?? { events: null, tasks: null }}
          onChange={(destination) => onChange(source.id, destination)}
        />
      ))}
    </>
  );
}

/** A source: its name and colour, what it holds, its problems, where it goes (D268, D269). */
function SourceCard({
  source,
  calendars,
  colorOf,
  destination,
  onChange,
}: {
  source: Source;
  calendars: readonly Calendar[];
  colorOf: (calendar: Calendar) => string;
  destination: Destination;
  onChange: (destination: Destination) => void;
}) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const eventCount = source.items.filter((item) => item.kind === "event").length;
  const taskCount = source.items.length - eventCount;
  const days = source.items.flatMap((item) => [item.first, item.last]).filter((d) => d !== null);
  const first = days.reduce<string | null>((a, b) => (a === null || b < a ? b : a), null);
  const last = days.reduce<string | null>((a, b) => (a === null || b > a ? b : a), null);
  const range =
    first && last
      ? new Intl.DateTimeFormat(i18n.resolvedLanguage, {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }).formatRange(new Date(`${first}T00:00:00Z`), new Date(`${last}T00:00:00Z`))
      : null;
  const counts = [
    eventCount > 0 ? t("import.events", { count: eventCount }) : null,
    taskCount > 0 ? t("import.tasks", { count: taskCount }) : null,
  ].filter((part) => part !== null);
  const lost = source.problems.filter((problem) => !problem.kept);
  const mended = source.problems.filter((problem) => problem.kept);
  const options = (kind: "event" | "task") => [
    ...targetsFor(calendars, kind).map((calendar) => ({
      value: calendar.id,
      label: calendar.name,
      leading: <Dot color={colorOf(calendar)} />,
    })),
    {
      value: NEW,
      label: `${t(kind === "event" ? "import.new" : "import.newList")}: ${source.name}`,
      leading: <PlusIcon className="size-4 shrink-0 text-ink-muted" />,
    },
  ];
  const select = "h-10 w-full min-w-0 rounded-lg bg-raised pr-1 pl-2 sm:w-64";
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-2xl bg-canvas p-4">
      <div className="flex min-w-0 items-start gap-3">
        {source.color ? (
          <span className="pt-1">
            <Dot color={source.color} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="truncate text-body font-medium">
            {source.name}
          </h2>
          <p className="text-note text-ink-muted">
            {[counts.length > 0 ? counts.join(" · ") : t("import.nothing"), range]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      {source.dates?.guessed ? (
        <p className="text-note text-ink-muted">
          {t("import.datesGuessed", {
            example: exampleDate(source.dates.order, i18n.resolvedLanguage ?? "en"),
          })}
        </p>
      ) : null}
      {source.notImported.length > 0 ? (
        <p className="text-note text-ink-muted">
          {t("import.notImported", { names: source.notImported.join(", ") })}
        </p>
      ) : null}
      {source.others > 0 ? (
        <p className="text-note text-ink-muted">{t("import.others", { count: source.others })}</p>
      ) : null}
      {lost.length > 0 || mended.length > 0 ? (
        <details className="text-note">
          <summary className="cursor-pointer rounded text-ink focus-visible:outline-2 focus-visible:outline-accent">
            {[
              lost.length > 0 ? t("import.lost", { count: lost.length }) : null,
              mended.length > 0 ? t("import.mended", { count: mended.length }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-ink-muted">
            {source.problems.map((problem, n) => (
              <li key={n}>
                <Problem problem={problem} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {destination.events !== null ? (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <Select
            label={t("import.eventsTo")}
            labelClassName="text-body sm:min-w-0 sm:flex-1"
            value={destination.events}
            onChange={(events) => onChange({ ...destination, events })}
            options={options("event")}
            className={select}
          />
        </div>
      ) : null}
      {destination.tasks !== null ? (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <Select
            label={t("import.tasksTo")}
            labelClassName="text-body sm:min-w-0 sm:flex-1"
            value={destination.tasks}
            onChange={(tasks) => onChange({ ...destination, tasks })}
            options={options("task")}
            className={select}
          />
        </div>
      ) : null}
    </section>
  );
}

/** How 5 November 2026 reads in a CSV's order: "11/05/2026", "05.11.2026". */
function exampleDate(order: "dmy" | "mdy" | "ymd", language: string): string {
  const day = new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, 10, 5)),
  );
  const written = order === "ymd" ? "2026-11-05" : order === "dmy" ? "05.11.2026" : "11/05/2026";
  return `${written} = ${day}`;
}

function Problem({ problem }: { problem: SplitProblem }) {
  const { t } = useTranslation();
  const where =
    problem.index < 0
      ? t("import.header")
      : ((problem.component === "VTIMEZONE" ? null : problem.uid) ??
        t("import.item", { n: problem.index + 1 }));
  return (
    <>
      {problem.component === "VTIMEZONE" ? null : (
        <span className="break-all text-ink">{where}: </span>
      )}
      {t(`import.why.${problem.reason}`, { uid: problem.uid ?? "" })}
    </>
  );
}

function Asking({ duplicates }: { duplicates: Duplicates }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-2xl bg-canvas p-4 text-body">
      <p>{t("import.duplicates", { count: duplicates.changed })}</p>
      <p className="text-note text-ink-muted">{t("import.updateMeans")}</p>
      {duplicates.identical > 0 ? (
        <p className="text-note text-ink-muted">
          {t("import.identical", { count: duplicates.identical })}
        </p>
      ) : null}
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation();
  const label = t("import.progress", { done, total });
  return (
    <div className="flex flex-col gap-3 px-1">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-2 overflow-hidden rounded-full bg-pill"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none"
          style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
        />
      </div>
      <p role="status" className="text-body tabular-nums">
        {label}
      </p>
    </div>
  );
}

function Done({ result }: { result: Imported }) {
  const { t } = useTranslation();
  const lines = [
    [
      result.events > 0 ? t("import.events", { count: result.events }) : null,
      result.tasks > 0 ? t("import.tasks", { count: result.tasks }) : null,
    ]
      .filter(Boolean)
      .join(" · ") || t("import.nothing"),
    result.updated > 0 ? t("import.updated", { count: result.updated }) : null,
    result.copies > 0 ? t("import.copies", { count: result.copies }) : null,
    result.identical > 0 ? t("import.sameSkipped", { count: result.identical }) : null,
    result.skipped > 0 ? t("import.differentSkipped", { count: result.skipped }) : null,
    result.again > 0 ? t("import.again", { count: result.again }) : null,
  ].filter((line) => line !== null);
  return (
    <div role="status" className="flex flex-col items-center gap-2 py-6 text-center">
      {result.stopped || result.error ? null : <CheckCircleIcon className="size-10 text-accent" />}
      <p className="text-title">
        {t(
          result.error
            ? "import.endedOnError"
            : result.stopped
              ? "import.endedStopped"
              : "import.done",
        )}
      </p>
      {lines.map((line, n) => (
        <p key={n} className="text-body text-ink-muted">
          {line}
        </p>
      ))}
      {result.stopped ? <p className="text-note text-ink-muted">{t("import.stopped")}</p> : null}
      {result.cleanup ? (
        <p className="text-note text-ink-muted">
          {t("import.cleanupFailed", { message: result.cleanup })}
        </p>
      ) : null}
      {result.error ? (
        <p role="alert" className="rounded-2xl bg-danger-soft p-3 text-note">
          {t("import.failedPart", { message: result.error })}
        </p>
      ) : null}
    </div>
  );
}
