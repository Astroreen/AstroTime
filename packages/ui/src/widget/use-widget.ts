// The open app keeps the home screen widget (docs/plans/android.md#D317):
// a snapshot at every change to the store, to the calendars shown, to the
// words or to today. It hears the store while the page is hidden too: a
// sync the app runs in the background still reaches the home screen. The
// snapshot's code is a chunk of its own, loaded only where the shell has a
// widget (foundation D145): the web app never loads it.
import type { Store } from "@astrotime/storage";
import { useEffect, useState } from "react";

import { liveQuery } from "../calendar/live.ts";
import { ObjectCache } from "../calendar/query.ts";
import type { SnapshotWords, WidgetHost } from "./schedule.ts";

export function useScheduleWidget(
  widget: WidgetHost | undefined,
  store: Store,
  options: SnapshotWords & {
    readonly hidden: ReadonlySet<string>;
    readonly hideCompleted: boolean;
    /** Today in the user's zone: a new day is a new snapshot. */
    readonly today: string;
  },
): void {
  const { t, formats, timeZone, hideCompleted, today } = options;
  // The ids by value: the set is new with every change of it.
  const hiddenKey = [...options.hidden].toSorted().join(",");
  const [cache] = useState(() => new ObjectCache());
  useEffect(() => {
    if (!widget) return;
    const hidden = new Set(hiddenKey === "" ? [] : hiddenKey.split(","));
    let stop: (() => void) | undefined;
    let gone = false;
    void import("./schedule.ts").then(
      ({ scheduleSnapshot }) => {
        if (gone) return;
        stop = liveQuery(
          store,
          () =>
            scheduleSnapshot({
              store,
              cache,
              hidden,
              hideCompleted,
              words: { t, formats, timeZone },
              now: Date.now(),
            }),
          (snapshot) => {
            try {
              void Promise.resolve(widget.show(snapshot)).catch((error: unknown) =>
                console.error(error),
              );
            } catch (error) {
              console.error(error);
            }
          },
        );
      },
      (error: unknown) => console.error(error),
    );
    return () => {
      gone = true;
      stop?.();
    };
  }, [widget, store, cache, hiddenKey, hideCompleted, t, formats, timeZone, today]);
}
