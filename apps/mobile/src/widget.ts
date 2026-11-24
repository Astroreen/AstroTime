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

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** An `ItemTime` as the snapshot wrote it: an object with its `type`. */
const isTime = (value: unknown): value is ItemTime =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

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
    return typeof day === "string" && DAY.test(day) ? { kind, day } : null;
  }
  if (
    kind === "item" &&
    typeof objectId === "string" &&
    typeof day === "string" &&
    DAY.test(day) &&
    (recurrenceId === null || isTime(recurrenceId))
  ) {
    // The recurrence id is only compared with the object's own occurrences.
    return { kind, objectId, recurrenceId, day };
  }
  return null;
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
  return {
    show: (snapshot) => native.showWidget({ snapshot: JSON.stringify(snapshot) }),
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
