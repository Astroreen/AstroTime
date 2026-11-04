// "Export to a file" (docs/plans/import.md#D274): a calendar or list, as
// stored on this device (changes not yet uploaded too), written as one
// `.ics` the way Nextcloud's export writes one, saved where the platform
// saves files or downloaded. Loaded with its first opening, its strings
// with it.
import { joinCalendar } from "@astrotime/core/split";
import type { Calendar, Store } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { addImportStrings } from "../i18n/import.ts";
import type { Platform } from "../platform.ts";
import { useAccounts } from "./accounts-context.tsx";
import { primaryButton, textButton } from "./buttons.ts";
import { Dot } from "./color-select.tsx";
import { CloseIcon } from "./icons.tsx";
import { saveFile, type Saved } from "./save-file.ts";
import { Select } from "./select.tsx";
import { DialogBackdrop, DialogPopup, dialogIcon } from "./dialog-parts.tsx";

/** Every day a stored object can start on. */
const EVER = { from: "0001-01-01", to: "9999-12-31", timeZone: "UTC" };

type Outcome =
  | { readonly name: "idle" }
  | { readonly name: "saving" }
  | {
      readonly name: "saved";
      readonly file: string;
      readonly count: number;
      readonly left: number;
      /** Written, turned away, or a download begun: only the first is "saved". */
      readonly how: Saved;
    }
  | { readonly name: "failed"; readonly message: string };

export function ExportDialog({
  open,
  onClose,
  calendars,
  colorOf,
}: {
  open: boolean;
  onClose: () => void;
  calendars: readonly Calendar[];
  colorOf: (calendar: Calendar) => string;
}) {
  const { t, i18n } = useTranslation();
  addImportStrings(i18n);
  const { store, platform } = useAccounts();
  const [chosen, setChosen] = useState(calendars[0]?.id ?? "");
  const [outcome, setOutcome] = useState<Outcome>({ name: "idle" });
  const links = useRef<string[]>([]);
  const titleId = useId();
  // The download links' URLs, let go when the dialog goes.
  useEffect(() => () => links.current.forEach((url) => URL.revokeObjectURL(url)), []);
  const calendar = calendars.find((one) => one.id === chosen) ?? calendars[0];

  const save = () => {
    if (!calendar || outcome.name === "saving") return;
    // The last export's download link, long begun: let go.
    for (const url of links.current.splice(0)) URL.revokeObjectURL(url);
    setOutcome({ name: "saving" });
    exportCalendar(store, platform, calendar, colorOf(calendar), links.current).then(
      (saved) => setOutcome({ name: "saved", ...saved }),
      (error: unknown) =>
        setOutcome({
          name: "failed",
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setOutcome({ name: "idle" });
        onClose();
      }}
    >
      <Dialog.Portal>
        {/* Over Settings: its own backdrop, which Base UI leaves out of a nested dialog by default. */}
        <DialogBackdrop
          forceRender
          className="fixed inset-0 z-[120] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"
        />
        <DialogPopup
          aria-labelledby={titleId}
          className="centred fixed z-[130] flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-4 rounded-3xl bg-raised p-5 text-ink shadow-2xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
        >
          <div className="flex items-center gap-2">
            <Dialog.Title id={titleId} className="min-w-0 flex-1 text-title">
              {t("export.title")}
            </Dialog.Title>
            <Dialog.Close className={dialogIcon} aria-label={t("import.close")}>
              <CloseIcon className="size-5" />
            </Dialog.Close>
          </div>
          <div className="flex flex-col gap-1">
            <Select
              label={t("export.calendar")}
              labelClassName="text-body"
              value={calendar?.id ?? ""}
              onChange={(id) => {
                setChosen(id);
                setOutcome({ name: "idle" });
              }}
              options={calendars.map((one) => ({
                value: one.id,
                label: one.name,
                leading: <Dot color={colorOf(one)} />,
              }))}
              className="h-10 w-full min-w-0 rounded-lg bg-canvas pr-1 pl-2"
            />
            <p className="text-note text-ink-muted">{t("export.hint")}</p>
          </div>
          {outcome.name === "saved" ? (
            <p role="status" className="text-body">
              {outcome.how === "cancelled"
                ? t("export.cancelled")
                : t(outcome.how === "saved" ? "export.saved" : "export.downloading", {
                    count: outcome.count,
                    file: outcome.file,
                  })}
              {outcome.left > 0 && outcome.how !== "cancelled"
                ? ` ${t("export.left", { count: outcome.left })}`
                : ""}
            </p>
          ) : outcome.name === "failed" ? (
            <p role="alert" className="rounded-2xl bg-danger-soft p-3 text-note">
              {t("export.failed", { message: outcome.message })}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Dialog.Close className={textButton}>{t("import.close")}</Dialog.Close>
            <button
              type="button"
              className={primaryButton}
              disabled={!calendar || outcome.name === "saving"}
              onClick={save}
            >
              {t("export.save")}
            </button>
          </div>
        </DialogPopup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The calendar's objects as stored, as one `.ics`, saved; how many, and how many could not be read. */
async function exportCalendar(
  store: Store,
  platform: Platform,
  calendar: Calendar,
  color: string,
  links: string[],
): Promise<{ file: string; count: number; left: number; how: Saved }> {
  const objects = [
    ...(await store.objectsBetween([calendar.id], EVER)),
    ...(await store.undated([calendar.id])),
  ];
  const { ics, left } = joinCalendar(
    objects.map((object) => object.ics),
    { name: calendar.name, color },
  );
  const file = fileNameOf(calendar.name);
  const how = await saveFile(
    { name: file, type: "text/calendar", bytes: new TextEncoder().encode(ics) },
    platform,
    links,
  );
  return { file, count: objects.length - left, left, how };
}

/** Names Windows keeps for its devices, whatever their extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const NAME_AT_MOST = 100;
/** Characters no file name may hold on one system or another. */
const FORBIDDEN = '\\/:*?"<>|';

/**
 * A file name every system takes, from a calendar's name: no control
 * character, none of `\\ / : * ? " < > |`, no dot or space at its end, no
 * name Windows keeps for a device (`CON`, `NUL`, `COM1`…), at most 100
 * characters before `.ics`; "calendar" where nothing is left.
 */
export function fileNameOf(name: string): string {
  const plain = [...name]
    .map((c) =>
      c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f || FORBIDDEN.includes(c) ? " " : c,
    )
    .join("")
    .replaceAll(/\s+/g, " ")
    .trim();
  const base = [...plain]
    .slice(0, NAME_AT_MOST)
    .join("")
    .replace(/[. ]+$/, "");
  if (base === "") return "calendar.ics";
  return RESERVED.test(base) ? `${base} calendar.ics` : `${base}.ics`;
}
