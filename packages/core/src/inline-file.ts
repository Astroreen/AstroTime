// An inline attachment's file, decoded only when the user saves it
// (docs/plans/foundation.md#D229): a module of its own, so the code that
// decodes loads with the details, not with the views.
import ICAL from "ical.js";

import { attachment, isInline, textOf } from "./attachments.ts";
import type { CalendarObject } from "./calendar-object.ts";
import { fromIcalTime, type ItemTime } from "./time.ts";

/** An inline attachment's file, decoded when it is opened: its bytes, type and name. */
export interface InlineFile {
  readonly bytes: Uint8Array;
  readonly type: string | null;
  readonly name: string | null;
}

/**
 * The inline file of the item's attachment at `index` (the item at
 * `recurrenceId`: its exception, else the series'), decoded only now; null
 * when that attachment is a link.
 */
export function inlineFile(
  object: CalendarObject,
  recurrenceId: ItemTime | null,
  index: number,
): InlineFile | null {
  const { master, exceptions } = object.components;
  const id = recurrenceId && JSON.stringify(recurrenceId);
  const exception =
    id &&
    exceptions.find((component) => {
      const value = component.getFirstPropertyValue("recurrence-id");
      return value instanceof ICAL.Time && JSON.stringify(fromIcalTime(value)) === id;
    });
  const component = exception || master || exceptions[0];
  const property = component?.getAllProperties("attach")[index];
  if (!property || !isInline(property)) return null;
  const { type, name } = attachment(property);
  // ical.js decodes base64 itself: the core has no `atob` (AGENTS.md rule 1).
  const binary = new ICAL.Binary(textOf(property).replaceAll(/\s/g, "")).decodeValue();
  return { bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)), type, name };
}
