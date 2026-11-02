import type { Store, UndoneTask } from "@astrotime/storage";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
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

const NONE: readonly UndoneTask[] = [];

/** The occurrences of a range of days, and today's undone tasks, as last read. */
export interface Entries {
  readonly from: string;
  readonly to: string;
  readonly entries: readonly Entry[];
  readonly undone: readonly UndoneTask[];
  /**
   * Whether `undone` was read for these calendars, today and this zone; if
   * not, it is the last read, for a view to keep drawn until its own lands
   * (design D59).
   */
  readonly undoneCurrent: boolean;
}

/**
 * The visible calendars' occurrences from `from` to `to` (exclusive) and
 * the undone tasks before today, read again whenever the store changes
 * (docs/plans/foundation.md#D54). Nothing is read while `ids` (the calendars
 * are not read yet) or `from` is null; the last result stays meanwhile. A
 * range whose read fails comes back empty.
 *
 * The undone tasks are a read of their own, sent after the range's: on first
 * open a view draws its days as soon as they are read, and the "N undone
 * tasks" chip joins it when its tasks are, every one of them parsed to find
 * its latest undone occurrence (docs/plans/foundation.md#D146). Read for
 * other calendars, another day or zone, they come with `undoneCurrent`
 * false, so a view keeps what it drew until both reads are its own.
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
  const [read, setRead] = useState<Omit<Entries, "undone" | "undoneCurrent"> | null>(null);
  // The undone tasks with what they were read for.
  const undoneKey = `${idsKey}|${today}|${timeZone}`;
  const [undone, setUndone] = useState<{
    readonly key: string;
    readonly tasks: readonly UndoneTask[];
  } | null>(null);
  useEffect(() => {
    if (idsKey === null || from === null || to === null) return;
    const ids = idsKey === "" ? [] : idsKey.split(",");
    const range = { from, to, timeZone };
    return liveQuery(
      store,
      async () => ({
        from,
        to,
        entries: cache.entries(await store.objectsBetween(ids, range), range),
      }),
      setRead,
      (error) => {
        console.error(error);
        // A range that could not be read is had as empty, and one read
        // before as it was, anew: either way a view that waits for this
        // read draws it (design D59).
        setRead((last) =>
          last?.from === from && last.to === to ? { ...last } : { from, to, entries: [] },
        );
      },
    );
  }, [store, cache, idsKey, from, to, timeZone]);
  // Asked after the range, so the store's worker answers the range first;
  // not again for a new range, which does not change it.
  const reading = from !== null;
  useEffect(() => {
    if (idsKey === null || !reading) return;
    const ids = idsKey === "" ? [] : idsKey.split(",");
    const key = `${idsKey}|${today}|${timeZone}`;
    return liveQuery(
      store,
      () => store.undoneTasksBefore(ids, today, timeZone),
      (tasks) => setUndone({ key, tasks }),
      (error) => {
        console.error(error);
        // Tasks that could not be read are had as none, and those read
        // before as they were, anew, as the range's: a view that waits for
        // this read draws (design D59).
        setUndone((last) => (last?.key === key ? { ...last } : { key, tasks: NONE }));
      },
    );
  }, [store, idsKey, reading, today, timeZone]);
  const tasks = undone?.tasks ?? NONE;
  const undoneCurrent = undone?.key === undoneKey;
  return useMemo(
    () => (read ? { ...read, undone: tasks, undoneCurrent } : null),
    [read, tasks, undoneCurrent],
  );
}

/** Pixels a finger moves before its swipe knows its axis, under the browser's own touch slop. */
const SWIPE_SLOP = 8;
/** Pixels a swipe goes sideways to move the period. */
const SWIPE_DISTANCE = 56;

/**
 * A horizontal swipe on a touch screen over `ref`'s element: the next (`1`)
 * or previous (`-1`) period (design D59). The axis is locked on the first
 * movement past a few pixels (design D152): a sideways one is the swipe's,
 * and its `touchmove`s are cancelled, so the browser starts no fling of its
 * own, whose stop would take the next tap's click (a top-bar button had to
 * be pressed twice after a swipe); an upward or downward one is the grid's
 * scroll, which the browser runs (`touch-action: pan-y`).
 */
export function useSwipe(
  ref: RefObject<HTMLElement | null>,
  onSwipe: (direction: 1 | -1) => void,
): void {
  const swiped = useEffectEvent(onSwipe);
  // The finger down now, kept apart from the listeners: they may be attached
  // again while it is down (React's Strict Mode does so after mounting, in
  // development), and a swipe would then lose where it began (design D152).
  const finger = useRef<{ id: number; x: number; y: number; axis: "x" | "y" | null } | null>(null);
  // Attached as the element is, before anything is painted or pressed.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const down = (event: globalThis.PointerEvent) => {
      finger.current =
        event.pointerType === "touch" && event.isPrimary
          ? { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null }
          : null;
    };
    const move = (event: globalThis.PointerEvent) => {
      const start = finger.current;
      if (!start || event.pointerId !== start.id || start.axis) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.hypot(dx, dy) >= SWIPE_SLOP) start.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    };
    const touchMove = (event: TouchEvent) => {
      if (finger.current?.axis === "x" && event.cancelable) event.preventDefault();
    };
    const up = (event: globalThis.PointerEvent) => {
      const from = finger.current;
      if (!from || event.pointerId !== from.id) return;
      finger.current = null;
      if (from.axis === "y") return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > 2 * Math.abs(dy)) swiped(dx < 0 ? 1 : -1);
    };
    const cancel = () => {
      finger.current = null;
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", cancel);
    // Not passive: the browser waits for it before it moves the page.
    element.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("touchmove", touchMove);
    };
  }, [ref]);
}
