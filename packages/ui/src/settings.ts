// The drawer's settings (design D53): this device's theme, language, week
// start and clock, and whether completed tasks show on the views (D51).
// Kept in the app's preferences as one value and applied at once.
import { createContext, useContext } from "react";

import type { LocaleSettings } from "./calendar/locale.ts";
import { LANGUAGES, type Language } from "./i18n/index.ts";

export const THEMES = ["system", "dark", "light"] as const;
/** `system` follows the device; the others set `data-theme` on the root (design D58). */
type Theme = (typeof THEMES)[number];

/** The weekdays a week may start on, ISO-numbered: Monday, Sunday, Saturday. */
export const WEEK_STARTS = [1, 7, 6] as const;
export const CLOCKS = [12, 24] as const;

export interface Settings {
  readonly theme: Theme;
  readonly language: "system" | Language;
  readonly weekStart: "locale" | (typeof WEEK_STARTS)[number];
  readonly clock: "locale" | (typeof CLOCKS)[number];
  readonly hideCompleted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  language: "system",
  weekStart: "locale",
  clock: "locale",
  hideCompleted: false,
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
  };
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
