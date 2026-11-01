import { createContext, useContext } from "react";

import type { Formats } from "../calendar/format.ts";
import type { Entry } from "../calendar/query.ts";

export interface CalendarContextValue {
  readonly formats: Formats;
  readonly timeZone: string;
  /** An item's colour: its own `COLOR`, else its calendar's (design D47). */
  readonly colorOf: (entry: Entry) => string;
  /** The stored object a search jumped to, marked on the views (design D53). */
  readonly found?: string | null;
}

export const CalendarContext = createContext<CalendarContextValue | null>(null);

export function useCalendar(): CalendarContextValue {
  const value = useContext(CalendarContext);
  if (!value) throw new Error("useCalendar needs a CalendarContext provider.");
  return value;
}
