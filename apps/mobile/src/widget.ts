// Android's schedule widget (docs/plans/android.md#D317): the UI's snapshot
// handed to the shell plugin, which keeps it and draws the widget
// (android/app/src/main/java/io/github/astroreen/astrotime/widget/); a tap
// on the widget starts the app at `io.github.astroreen.astrotime:/widget`
// with what it opens, heard as `@capacitor/app` hears any address the app
// is opened at. The activity can be started at that address by any app, so
// what it asks for is read strictly: an item, a day or quick create, no more.
import type { ItemTime } from "@astrotime/core";
import type { WidgetHost, WidgetOpen } from "@astrotime/ui";

/** The address a tap opens the app at; `open` is the `WidgetOpen`, as JSON. */
export const WIDGET_URL = "io.github.astroreen.astrotime:/widget";

/** What the adapter uses of the shell plugin (`AstroTimeShell`). */
export interface NativeWidget {
  showWidget(options: { snapshot: string }): Promise<void>;
}

/** What the adapter uses of `@capacitor/app`. */
export interface WidgetApp {
  addListener(
    event: "appUrlOpen",
    listener: (event: { readonly url: string }) => void,
  ): Promise<unknown>;
  /** The address the app was started at, if any. */
  getLaunchUrl(): Promise<{ readonly url: string } | undefined>;
}

/** A day as `YYYY-MM-DD` that the calendar has: not "2026-02-31". */
function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** A wall clock as the snapshot writes it, `YYYY-MM-DDTHH:MM:SS`, on a day the calendar has. */
const isLocal = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value) &&
  isDay(value.slice(0, 10));

/**
 * An `ItemTime` rebuilt from what the address says, each kind with its own
 * fields and nothing more; `undefined` when it is none.
 */
function timeOf(value: unknown): ItemTime | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const time = value as Record<string, unknown>;
  if (time["type"] === "date" && isDay(time["date"])) return { type: "date", date: time["date"] };
  if (time["type"] === "floating" && isLocal(time["local"]))
    return { type: "floating", local: time["local"] };
  if (
    time["type"] === "zoned" &&
    isLocal(time["local"]) &&
    typeof time["timeZone"] === "string" &&
    typeof time["epochMs"] === "number" &&
    Number.isFinite(time["epochMs"])
  )
    return {
      type: "zoned",
      local: time["local"],
      timeZone: time["timeZone"],
      epochMs: time["epochMs"],
    };
  return undefined;
}

/** What a widget's address opens; `null` for any other address, or one that does not read. */
export function widgetOpenOf(url: string): WidgetOpen | null {
  if (!url.startsWith(`${WIDGET_URL}?`)) return null;
  let open: unknown;
  try {
    open = JSON.parse(new URLSearchParams(url.slice(WIDGET_URL.length + 1)).get("open") ?? "");
  } catch {
    return null;
  }
  if (typeof open !== "object" || open === null) return null;
  const { kind, objectId, recurrenceId, day } = open as Record<string, unknown>;
  if (kind === "create") return { kind };
  if (kind === "day") {
    if (day === undefined) return { kind };
    return isDay(day) ? { kind, day } : null;
  }
  if (kind !== "item" || typeof objectId !== "string" || !isDay(day)) return null;
  // Only an object's own occurrence opens: the id is compared with its occurrences.
  const time = recurrenceId === null ? null : timeOf(recurrenceId);
  return time === undefined ? null : { kind, objectId, recurrenceId: time, day };
}

export function androidWidget(native: NativeWidget, app: WidgetApp): WidgetHost {
  const listeners = new Set<(open: WidgetOpen) => void>();
  // A tap that started the app, before the UI listens.
  let pending: WidgetOpen | null = null;
  const tapped = (url: string) => {
    const open = widgetOpenOf(url);
    if (!open) return;
    if (listeners.size === 0) pending = open;
    for (const listener of listeners) listener(open);
  };
  void app
    .addListener("appUrlOpen", ({ url }) => tapped(url))
    .catch((error: unknown) => console.error(error));
  void app
    .getLaunchUrl()
    .then((launch) => launch && tapped(launch.url))
    .catch((error: unknown) => console.error(error));
  // The snapshot the widget has: the UI hands one at every change to the
  // store, and one the same as the last is not written again. One that
  // failed is handed again with the next change.
  let shown: string | null = null;
  return {
    async show(snapshot) {
      const json = JSON.stringify(snapshot);
      if (json === shown) return;
      shown = null;
      await native.showWidget({ snapshot: json });
      shown = json;
    },
    onOpen(listener) {
      listeners.add(listener);
      if (pending) {
        const open = pending;
        pending = null;
        listener(open);
      }
      return () => listeners.delete(listener);
    },
  };
}
