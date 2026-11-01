import type { Store, UndoneTask } from "@astrotime/storage";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type PointerEventHandler,
} from "react";

import { nowIn } from "./calendar/dates.ts";
import { liveQuery } from "./calendar/live.ts";
import type { Entry, ObjectCache } from "./calendar/query.ts";

/** Whether a media query matches, kept up to date. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

/** Today and the minutes past midnight in `timeZone`, updated each minute. */
export function useNow(timeZone: string): { today: string; minutes: number } {
  const [now, setNow] = useState(() => nowIn(Date.now(), timeZone));
  useEffect(() => {
    const tick = () => {
      const next = nowIn(Date.now(), timeZone);
      setNow((current) =>
        current.today === next.today && current.minutes === next.minutes ? current : next,
      );
    };
    tick();
    const timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, [timeZone]);
  return now;
}

/** The occurrences of a range of days, and today's undone tasks, as last read. */
export interface Entries {
  readonly from: string;
  readonly to: string;
  readonly entries: readonly Entry[];
  readonly undone: readonly UndoneTask[];
}

/**
 * The visible calendars' occurrences from `from` to `to` (exclusive) and
 * the undone tasks before today, read again whenever the store changes
 * (docs/plans/foundation.md#D54). Nothing is read while `ids` (the calendars
 * are not read yet) or `from` is null; the last result stays meanwhile. A
 * range whose read fails comes back empty.
 */
export function useEntries(
  store: Store,
  cache: ObjectCache,
  query: {
    readonly ids: readonly string[] | null;
    readonly from: string | null;
    readonly to: string | null;
    readonly today: string;
    readonly timeZone: string;
  },
): Entries | null {
  const { from, to, today, timeZone } = query;
  // The ids by value: the calendars' list is new on every store write, and
  // the query already runs again on every write.
  const idsKey = query.ids?.join(",") ?? null;
  const [data, setData] = useState<Entries | null>(null);
  useEffect(() => {
    if (idsKey === null || from === null || to === null) return;
    const ids = idsKey === "" ? [] : idsKey.split(",");
    const range = { from, to, timeZone };
    return liveQuery(
      store,
      async () => {
        const [rows, undone] = await Promise.all([
          store.objectsBetween(ids, range),
          store.undoneTasksBefore(ids, today, timeZone),
        ]);
        return { from, to, entries: cache.entries(rows, range), undone };
      },
      setData,
      (error) => {
        console.error(error);
        // A range that could not be read is had as empty, and one read
        // before as it was, anew: either way a view that waits for this
        // read draws it (design D59).
        setData((last) =>
          last?.from === from && last.to === to
            ? { ...last }
            : { from, to, entries: [], undone: last?.undone ?? [] },
        );
      },
    );
  }, [store, cache, idsKey, from, to, timeZone, today]);
  return data;
}

/** A horizontal swipe on a touch screen: the next (`1`) or previous (`-1`) period (design D59). */
export function useSwipe(onSwipe: (direction: 1 | -1) => void): {
  onPointerDown: PointerEventHandler;
  onPointerUp: PointerEventHandler;
  onPointerCancel: PointerEventHandler;
} {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (event: PointerEvent) => {
      start.current = event.pointerType === "touch" ? { x: event.clientX, y: event.clientY } : null;
    },
    onPointerUp: (event: PointerEvent) => {
      const from = start.current;
      start.current = null;
      if (!from) return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (Math.abs(dx) > 56 && Math.abs(dx) > 2 * Math.abs(dy)) onSwipe(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}
