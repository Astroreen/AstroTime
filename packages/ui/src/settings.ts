// The settings (design D53, D131): this device's theme, language, week
// start and clock, whether completed tasks (D51) and the week numbers
// (D169) show on the views, the colours new items start with and the
// user's own (D172, D173), whether reminders notify (foundation D101), the
// pictures the Agenda and the details are drawn with (D217), and whether
// completing a task is celebrated (D198).
// Kept in the app's preferences as one value and applied at once.
import { isColorName } from "@astrotime/core";
import { createContext, useContext } from "react";

import type { LocaleSettings } from "./calendar/locale.ts";
import { LANGUAGES, type Language } from "./i18n/index.ts";

export const THEMES = ["system", "dark", "light"] as const;
/** `system` follows the device; the others set `data-theme` on the root (design D58). */
export type Theme = (typeof THEMES)[number];

/** The weekdays a week may start on, ISO-numbered: Monday, Sunday, Saturday. */
export const WEEK_STARTS = [1, 7, 6] as const;
export const CLOCKS = [12, 24] as const;

/**
 * A colour of the user's own (design D173): its hex and its name, `null`
 * while the name is the one generated from the colour (D170).
 */
export interface OwnColor {
  readonly id: string;
  /** `#rrggbb`. */
  readonly hex: string;
  readonly name: string | null;
}

export interface Settings {
  readonly theme: Theme;
  readonly language: "system" | Language;
  readonly weekStart: "locale" | (typeof WEEK_STARTS)[number];
  readonly clock: "locale" | (typeof CLOCKS)[number];
  readonly hideCompleted: boolean;
  /** The week numbers on the views (D49, D86): on unless turned off (design D169). */
  readonly weekNumbers: boolean;
  /**
   * The colour a new event or task starts with (design D172): `null`, its
   * calendar's; an own colour by its id (`own:<id>`), so recolouring it
   * moves the default; else a CSS name or a hex. See `defaultColorOf`.
   */
  readonly defaultColors: { readonly event: string | null; readonly task: string | null };
  /** The user's own colours, on this device (design D173). */
  readonly colors: readonly OwnColor[];
  /** On unless turned off; they show once the platform may notify (foundation D101). */
  readonly reminders: boolean;
  /**
   * Closing the window leaves the app running, where the shell can (the
   * desktop, docs/plans/desktop.md#D75); off, closing it quits.
   */
  readonly keepRunning: boolean;
  /**
   * Location searches places on the map and the place card shows one,
   * where the platform has them (design D175); off, neither asks anything.
   */
  readonly places: boolean;
  /** The Agenda's cards and the details drawn over a picture by their title's words (design D217). */
  readonly illustrations: boolean;
  /** A picture of the season above each month of the Agenda (design D218). */
  readonly monthBanners: boolean;
  /** A burst of shapes when the user completes a task: on unless turned off (design D198). */
  readonly celebrate: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  language: "system",
  weekStart: "locale",
  clock: "locale",
  hideCompleted: false,
  weekNumbers: true,
  defaultColors: { event: null, task: null },
  colors: [],
  reminders: true,
  keepRunning: true,
  places: true,
  illustrations: true,
  monthBanners: true,
  celebrate: true,
};

const oneOf = <T>(values: readonly T[], value: unknown, fallback: T): T =>
  values.includes(value as T) ? (value as T) : fallback;

/** The settings from what was stored; anything unreadable is the default. */
export function readSettings(stored: string | null): Settings {
  let value: Partial<Record<keyof Settings, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(stored ?? "{}");
    if (parsed && typeof parsed === "object") value = parsed;
  } catch {
    // Unreadable: the defaults.
  }
  const d = DEFAULT_SETTINGS;
  return {
    theme: oneOf(THEMES, value.theme, d.theme),
    language: oneOf(["system", ...LANGUAGES] as const, value.language, d.language),
    weekStart: oneOf(["locale", ...WEEK_STARTS] as const, value.weekStart, d.weekStart),
    clock: oneOf(["locale", ...CLOCKS] as const, value.clock, d.clock),
    hideCompleted: value.hideCompleted === true,
    weekNumbers: value.weekNumbers !== false,
    defaultColors: readDefaults(value.defaultColors),
    colors: readColors(value.colors),
    reminders: value.reminders !== false,
    keepRunning: value.keepRunning !== false,
    places: value.places !== false,
    illustrations: value.illustrations !== false,
    monthBanners: value.monthBanners !== false,
    celebrate: value.celebrate !== false,
  };
}

const HEX = /^#[0-9a-f]{6}$/;
/** An own colour as a default names it: by its id. */
export const OWN = "own:";
/**
 * A default as settings keep it: an own colour's id, a hex in lower case,
 * or a CSS3 name, which `editItem` takes (foundation D174); anything else
 * is the calendar's colour, so no new item's save is refused for it.
 */
const colorValue = (value: unknown): string | null =>
  typeof value === "string" && (value.startsWith(OWN) || HEX.test(value) || isColorName(value))
    ? value
    : null;

/** The colours new items start with, resolved: a CSS name or a hex, or `null` for the calendar's. */
export type DefaultColors = Readonly<Record<"event" | "task", string | null>>;

/** The colour a new item of `kind` starts with (design D172); `null`, its calendar's. */
export function defaultColorOf(settings: Settings, kind: "event" | "task"): string | null {
  const value = settings.defaultColors[kind];
  if (!value?.startsWith(OWN)) return value;
  const id = value.slice(OWN.length);
  return settings.colors.find((color) => color.id === id)?.hex ?? null;
}

function readDefaults(value: unknown): Settings["defaultColors"] {
  const read = (value ?? {}) as { event?: unknown; task?: unknown };
  return { event: colorValue(read.event), task: colorValue(read.task) };
}

function readColors(value: unknown): readonly OwnColor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const { id, hex, name } = (entry ?? {}) as Partial<Record<keyof OwnColor, unknown>>;
    if (typeof id !== "string" || typeof hex !== "string" || !HEX.test(hex)) return [];
    return [{ id, hex, name: typeof name === "string" && name.trim() !== "" ? name : null }];
  });
}

/** The locale's week start and clock, or the ones chosen in settings (design D45). */
export function withSettings(locale: LocaleSettings, settings: Settings): LocaleSettings {
  return {
    ...locale,
    weekStart: settings.weekStart === "locale" ? locale.weekStart : settings.weekStart,
    hour12: settings.clock === "locale" ? locale.hour12 : settings.clock === 12,
  };
}

export interface SettingsContextValue {
  readonly settings: Settings;
  readonly change: (changes: Partial<Settings>) => void;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings needs a SettingsContext provider.");
  return value;
}
