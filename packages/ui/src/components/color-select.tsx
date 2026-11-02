// Choosing a colour (design D168): a dropdown whose entries are a dot of
// the colour left of its name: "The calendar's colour" first, then the
// palette, then the user's own colours (D173), and the item's own colour
// when it is none of them.
import { colorNameHex } from "@astrotime/core";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { colorName } from "../calendar/color-names.ts";
import type { Language } from "../i18n/index.ts";
import { OWN, useSettings } from "../settings.ts";
import { Select, type SelectOption } from "./select.tsx";

/** RFC 7986 `COLOR`s to pick from: CSS names, as Nextcloud writes them. */
const PALETTE = [
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

/**
 * A dot of a colour, drawn as an item of it is (design D120); with none, a
 * ring: the calendars' own colours, whichever each is.
 */
export function Dot({ color, className = "size-4" }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`item-color shrink-0 rounded-full ${color ? "bg-[var(--item-fill)]" : "ring-2 ring-ink-muted ring-inset"} ${className}`}
      style={color ? ({ "--item": color } as CSSProperties) : undefined}
    />
  );
}

/** The language generated names are in: the UI's. */
export function useColorLanguage(): Language {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage === "ru" ? "ru" : "en";
}

/** A colour of the user's own, by its name or the one generated from it (design D170). */
export function useOwnColorName(): (color: { hex: string; name: string | null }) => string {
  const language = useColorLanguage();
  return (color) => color.name ?? colorName(color.hex, language) ?? color.hex;
}

/**
 * A colour from the dropdown: `null` is the calendar's colour; else a
 * palette name or a hex. `calendarColor` is the dot of the first entry,
 * a ring when there is no one calendar (a default in Settings).
 */
export function ColorSelect({
  label,
  labelClassName,
  value,
  onChange,
  calendarColor,
  ownById = false,
  className,
}: {
  label: string;
  labelClassName?: string;
  value: string | null;
  onChange: (color: string | null) => void;
  calendarColor: string | null;
  /** Own colours chosen by their id (a default in Settings, D172), not their hex. */
  ownById?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const nameOf = useOwnColorName();
  const language = useColorLanguage();
  const options: SelectOption[] = [
    { value: "", label: t("edit.colorDefault"), leading: <Dot color={calendarColor} /> },
    ...PALETTE.map((color) => ({
      value: color,
      label: t(`color.${color}`),
      leading: <Dot color={color} />,
    })),
  ];
  for (const color of settings.colors) {
    const own = ownById ? `${OWN}${color.id}` : color.hex;
    if (options.some((option) => option.value === own)) continue;
    options.push({ value: own, label: nameOf(color), leading: <Dot color={color.hex} /> });
  }
  // The item's own colour, from another client or a colour since deleted.
  if (value && !options.some((option) => option.value === value)) {
    options.push({
      value,
      // A CSS name (Nextcloud writes one) is named from its hex too (D168).
      label: colorName(colorNameHex(value) ?? value, language) ?? t("edit.colorCustom"),
      leading: <Dot color={value} />,
    });
  }
  return (
    <Select
      label={label}
      {...(labelClassName === undefined ? {} : { labelClassName })}
      value={value ?? ""}
      onChange={(next) => onChange(next === "" ? null : next)}
      options={options}
      {...(className === undefined ? {} : { className })}
    />
  );
}
