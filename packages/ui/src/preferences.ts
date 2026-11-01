// This device's own choices (the view, which calendars show, the drawer's
// settings, the tasks screen's list and order). Each app
// brings the storage: `localStorage` on the web and in Android's WebView.
import { useState } from "react";

export interface Preferences {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Preferences kept in memory, for tests and as a fallback. */
export function memoryPreferences(initial: Record<string, string> = {}): Preferences {
  const values = new Map(Object.entries(initial));
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => void values.set(key, value),
  };
}

/** A preference as React state, written through on every change. */
export function usePreference<T>(
  preferences: Preferences,
  key: string,
  read: (stored: string | null) => T,
  write: (value: T) => string,
): [T, (value: T) => void] {
  const [value, setValue] = useState(() => read(preferences.get(key)));
  const update = (next: T) => {
    setValue(next);
    preferences.set(key, write(next));
  };
  return [value, update];
}

export const KEYS = {
  view: "astrotime.view",
  hiddenCalendars: "astrotime.hiddenCalendars",
  settings: "astrotime.settings",
  taskList: "astrotime.taskList",
  taskSort: "astrotime.taskSort",
} as const;

/** The ids of hidden calendars, from what was stored (anything unreadable hides none). */
export function readHidden(stored: string | null): ReadonlySet<string> {
  try {
    const value: unknown = JSON.parse(stored ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}
