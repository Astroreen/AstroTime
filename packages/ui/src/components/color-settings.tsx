// The colours in Settings (design D172, D173): what a new event and a new
// task start with, and the user's own colours, each made, renamed,
// recoloured or deleted in a dialog of its own: a palette, a hex code, and
// a name generated from the colour until the user writes one (D170).
import { Dialog } from "@base-ui/react/dialog";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { colorName } from "../calendar/color-names.ts";
import { OWN, useSettings, type OwnColor } from "../settings.ts";
import { ColorSelect, Dot, useColorLanguage, useOwnColorName } from "./color-select.tsx";
import { CloseIcon, PlusIcon, RepeatIcon } from "./icons.tsx";
import { primaryButton, textButton } from "./sign-in-dialog.tsx";
import { DialogBackdrop, DialogPopup, dialogIcon } from "./dialog-parts.tsx";

const pad = (n: number) =>
  Math.round(n * 255)
    .toString(16)
    .padStart(2, "0");

/** HSL (degrees, 0–1, 0–1) as `#rrggbb`. */
function hexOf(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${pad(channel(0))}${pad(channel(8))}${pad(channel(4))}`;
}

/** The palette: a column per hue, deep to light, then the greys. */
const SWATCHES = [
  ...[0, 18, 36, 50, 90, 140, 170, 195, 215, 240, 265, 290, 330].flatMap((h) =>
    [
      [0.62, 0.38],
      [0.6, 0.52],
      [0.7, 0.7],
    ].map(([s, l]) => hexOf(h, s!, l!)),
  ),
  "#3c4043",
  "#80868b",
  "#bdc1c6",
];

const HEX = /^#?([0-9a-f]{6})$/i;

/** The defaults' and own colours' rows, in Settings' "Colours" group. */
export function ColorSettings({ rowClassName }: { rowClassName: string }) {
  const { t } = useTranslation();
  const { settings, change } = useSettings();
  const nameOf = useOwnColorName();
  const [editing, setEditing] = useState<OwnColor | "new" | null>(null);
  const ownId = useId();
  const select = "h-9 max-w-full min-w-40 rounded-lg bg-raised pr-1 pl-2";
  return (
    <>
      {(["event", "task"] as const).map((kind) => (
        <div key={kind} className={rowClassName}>
          <ColorSelect
            label={t(kind === "event" ? "settings.defaultEventColor" : "settings.defaultTaskColor")}
            labelClassName="min-w-0 flex-1"
            value={settings.defaultColors[kind]}
            calendarColor={null}
            ownById
            onChange={(color) =>
              change({ defaultColors: { ...settings.defaultColors, [kind]: color } })
            }
            className={select}
          />
        </div>
      ))}
      <h3 id={ownId} className="px-4 pt-3 pb-1 text-note text-ink-muted">
        {t("settings.ownColors")}
      </h3>
      <ul aria-labelledby={ownId} className="flex flex-col">
        {settings.colors.map((color) => (
          <li key={color.id}>
            <button
              type="button"
              onClick={() => setEditing(color)}
              className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-body hover:bg-raised-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              <Dot color={color.hex} className="size-5" />
              <span className="min-w-0 flex-1 truncate">{nameOf(color)}</span>
              {/* Seen, not said: the name says the colour (WCAG 2.5.3). */}
              <span aria-hidden="true" className="text-note text-ink-muted tabular-nums">
                {color.hex}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setEditing("new")}
        className="flex min-h-11 items-center gap-3 px-4 text-left text-body text-accent hover:bg-raised-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <PlusIcon className="size-5" />
        {t("settings.addColor")}
      </button>
      <ColorEditor
        editing={editing}
        onClose={() => setEditing(null)}
        onSave={(color) => {
          const others = settings.colors.filter((c) => c.id !== color.id);
          const at = settings.colors.findIndex((c) => c.id === color.id);
          change({
            colors:
              at < 0 ? [...others, color] : settings.colors.map((c, i) => (i === at ? color : c)),
          });
          setEditing(null);
        }}
        onDelete={(color) => {
          // A default that was this colour goes back to the calendars' own.
          const reset = (value: string | null) => (value === `${OWN}${color.id}` ? null : value);
          change({
            colors: settings.colors.filter((c) => c.id !== color.id),
            defaultColors: {
              event: reset(settings.defaultColors.event),
              task: reset(settings.defaultColors.task),
            },
          });
          setEditing(null);
        }}
      />
    </>
  );
}

function ColorEditor({
  editing,
  onClose,
  onSave,
  onDelete,
}: {
  editing: OwnColor | "new" | null;
  onClose: () => void;
  onSave: (color: OwnColor) => void;
  onDelete: (color: OwnColor) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <DialogBackdrop className="fixed inset-0 z-[140] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPopup className="fixed top-1/2 left-1/2 z-[150] max-h-[calc(100dvh-2rem)] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl bg-raised p-4 text-ink shadow-2xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          {editing !== null && (
            <ColorForm
              key={editing === "new" ? "new" : editing.id}
              color={editing === "new" ? null : editing}
              onSave={onSave}
              onDelete={onDelete}
            />
          )}
          <Dialog.Close
            className={`${dialogIcon} absolute top-3 right-3`}
            aria-label={t("colorEditor.close")}
          >
            <CloseIcon className="size-5" />
          </Dialog.Close>
        </DialogPopup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The colour's form. Its name is the generated one, following every change
 * of the colour, until the user writes one; then it stays until they ask
 * for a generated one again, or save it blank (design D170).
 */
function ColorForm({
  color,
  onSave,
  onDelete,
}: {
  color: OwnColor | null;
  onSave: (color: OwnColor) => void;
  onDelete: (color: OwnColor) => void;
}) {
  const { t } = useTranslation();
  const language = useColorLanguage();
  const [hex, setHex] = useState(color?.hex ?? SWATCHES[25]!);
  const [hexText, setHexText] = useState(hex);
  const [name, setName] = useState<string | null>(color?.name ?? null);
  const nameId = useId();
  const hexId = useId();
  const errorId = useId();
  const generated = colorName(hex, language) ?? hex;
  const valid = HEX.test(hexText.trim());
  const pick = (next: string) => {
    setHex(next);
    setHexText(next);
  };
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // A name left blank is the generated one (design D170).
        if (valid)
          onSave({ id: color?.id ?? crypto.randomUUID(), hex, name: name?.trim() || null });
      }}
      className="flex flex-col gap-4"
    >
      <Dialog.Title className="pr-10 text-title font-medium">
        {t(color ? "colorEditor.edit" : "colorEditor.new")}
      </Dialog.Title>
      <div className="flex items-end gap-3">
        <Dot color={hex} className="mb-1 size-10" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={nameId} className="text-small text-ink-muted">
            {t("colorEditor.name")}
          </label>
          <div className="flex items-center gap-1">
            <input
              id={nameId}
              value={name ?? generated}
              // As typed, spaces and a cleared field too: the generated name
              // comes back on saving a blank one, or on the button.
              onChange={(e) => setName(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-lg bg-canvas px-3 text-input text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              className={dialogIcon}
              aria-label={t("colorEditor.generate")}
              title={t("colorEditor.generate")}
              disabled={name === null}
              onClick={() => setName(null)}
            >
              <RepeatIcon className="size-5" />
            </button>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span id={`${hexId}-palette`} className="text-small text-ink-muted">
          {t("colorEditor.palette")}
        </span>
        <div
          role="radiogroup"
          aria-labelledby={`${hexId}-palette`}
          className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1.5"
        >
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              role="radio"
              aria-checked={swatch === hex}
              aria-label={colorName(swatch, language) ?? swatch}
              title={colorName(swatch, language) ?? swatch}
              onClick={() => pick(swatch)}
              className="grid aspect-square place-items-center rounded-full ring-offset-2 ring-offset-raised aria-checked:ring-2 aria-checked:ring-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Dot color={swatch} className="size-full" />
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={hexId} className="text-small text-ink-muted">
          {t("colorEditor.hex")}
        </label>
        <input
          id={hexId}
          value={hexText}
          spellCheck={false}
          autoCapitalize="off"
          aria-invalid={!valid}
          aria-describedby={valid ? undefined : errorId}
          onChange={(e) => {
            setHexText(e.target.value);
            const match = HEX.exec(e.target.value.trim());
            if (match) setHex(`#${match[1]!.toLowerCase()}`);
          }}
          className="h-10 w-full rounded-lg bg-canvas px-3 font-mono text-input text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-accent aria-invalid:ring-danger"
        />
        {!valid && (
          <p id={errorId} className="text-note text-danger">
            {t("colorEditor.badHex")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {color && (
          <button
            type="button"
            className={`${textButton} mr-auto text-danger`}
            onClick={() => onDelete(color)}
          >
            {t("colorEditor.delete")}
          </button>
        )}
        <button type="submit" className={primaryButton} disabled={!valid}>
          {t("colorEditor.save")}
        </button>
      </div>
    </form>
  );
}
