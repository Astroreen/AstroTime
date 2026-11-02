import type { TFunction } from "i18next";
import { createContext, useContext } from "react";

import type { Formats } from "../calendar/format.ts";
import type { Entry } from "../calendar/query.ts";

export interface CalendarContextValue {
  /**
   * The UI's words, the view's own: every item drawn asks for them, and
   * `useTranslation` in each made a copy of i18next's instance per item
   * (docs/plans/foundation.md#D146). It changes with the language.
   */
  readonly t: TFunction;
  readonly formats: Formats;
  readonly timeZone: string;
  /** An item's colour: its own `COLOR`, else its calendar's (design D47). */
  readonly colorOf: (entry: Entry) => string;
  /** Whether the views show the week numbers (design D169). */
  readonly weekNumbers: boolean;
  /** The UID of the item just saved from the edit dialog, which lands with motion (design D193). */
  readonly landed?: string | null;
  /** The stored object a search jumped to, marked on the views (design D53). */
  readonly found?: string | null;
}

export const CalendarContext = createContext<CalendarContextValue | null>(null);

export function useCalendar(): CalendarContextValue {
  const value = useContext(CalendarContext);
  if (!value) throw new Error("useCalendar needs a CalendarContext provider.");
  return value;
}
