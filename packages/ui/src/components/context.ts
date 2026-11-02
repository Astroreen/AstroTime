import type { TFunction } from "i18next";
import { createContext, useContext } from "react";

import type { Formats } from "../calendar/format.ts";
import type { Entry } from "../calendar/query.ts";

/** An occurrence by its item's UID and where it starts on the wall clock: a day, or a day and a time. */
export interface Landed {
  readonly uid: string;
  readonly at: string;
}

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
  /** The occurrence just saved from the edit dialog, which lands with motion once (design D193). */
  readonly landed?: Landed | null;
  /** Its landing ran: it lands no more when drawn again. */
  readonly onLanded?: () => void;
  /** The stored object a search jumped to, marked on the views (design D53). */
  readonly found?: string | null;
}

export const CalendarContext = createContext<CalendarContextValue | null>(null);

export function useCalendar(): CalendarContextValue {
  const value = useContext(CalendarContext);
  if (!value) throw new Error("useCalendar needs a CalendarContext provider.");
  return value;
}
