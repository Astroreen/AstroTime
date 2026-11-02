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
import { documentVisibility, liveQuery, whileShown } from "./calendar/live.ts";
import type { Entry, ObjectCache } from "./calendar/query.ts";

/** Each media query asked, one list for the page: no `matchMedia` on a render. */
const mediaQueries = new Map<
  string,
  { subscribe: (onChange: () => void) => () => void; matches: () => boolean }
>();

/** Whether a media query matches, kept up to date. */
export function useMediaQuery(query: string): boolean {
  let known = mediaQueries.get(query);
  if (!known) {
    const list = matchMedia(query);
    known = {
      subscribe(onChange) {
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
      },
      matches: () => list.matches,
    };
    mediaQueries.set(query, known);
  }
  return useSyncExternalStore(known.subscribe, known.matches, () => false);
}

/**
 * Today and the minutes past midnight in `timeZone`, updated each minute
 * while the page is shown, and at once when it is shown again
 * (docs/plans/foundation.md#D182).
 */
export function useNow(timeZone: string): { today: string; minutes: number } {
  const [now, setNow] = useState(() => nowIn(Date.now(), timeZone));
  useEffect(() => {
    const tick = () => {
      const next = nowIn(Date.now(), timeZone);
      setNow((current) =>
        current.today === next.today && current.minutes === next.minutes ? current : next,
      );
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    const follow = () => {
      clearInterval(timer);
      timer = undefined;
      if (!documentVisibility.shown()) return;
      tick();
      timer = setInterval(tick, 15_000);
    };
    follow();
    const stop = documentVisibility.onChange(follow);
    return () => {
      clearInterval(timer);
      stop();
    };
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
      whileShown(store),
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
      whileShown(store),
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
/** Pixels a swipe goes sideways to move the period, at least. */
const SWIPE_DISTANCE = 56;
/** A swipe let go this fast sideways (pixels a millisecond) moves the period from 24 px on. */
const FLICK_SPEED = 0.4;
const FLICK_DISTANCE = 24;
/** How far back a release's speed is measured. */
const SPEED_WINDOW = 100;

/**
 * Where a swipe let go goes (design D154): the next (`1`) or previous
 * (`-1`) period past a quarter of the view's `width` (at least 56 px, at
 * most 120), or a flick of 24 px on; else back (`0`). Mostly sideways only.
 */
export function swipeOutcome(dx: number, dy: number, velocity: number, width: number): 1 | -1 | 0 {
  if (Math.abs(dx) <= 2 * Math.abs(dy)) return 0;
  const far = Math.abs(dx) >= Math.min(120, Math.max(SWIPE_DISTANCE, width / 4));
  const flick =
    Math.abs(dx) >= FLICK_DISTANCE && Math.abs(velocity) >= FLICK_SPEED && velocity * dx > 0;
  return far || flick ? (dx < 0 ? 1 : -1) : 0;
}

/** A finger on a swipe's element. */
interface Finger {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  axis: "x" | "y" | null;
  /** The last moves, for the speed at the release. */
  readonly samples: { x: number; t: number }[];
}

/** What a view does with a finger's sideways swipe (design D154). */
export interface SwipeHandlers {
  /** The finger locked sideways: the view gets ready to follow it. */
  readonly onStart?: () => void;
  /** How far sideways it went from where it pressed; on every move, so no render here. */
  readonly onMove?: (dx: number) => void;
  /** Let go: how far it went and its speed sideways (pixels a millisecond) at the end. */
  readonly onEnd: (dx: number, dy: number, velocity: number) => void;
  /** Taken by the browser's scroll or a drag after it began: back to where it was. */
  readonly onCancel?: () => void;
}

/**
 * A horizontal swipe on a touch screen over `ref`'s element (design D59).
 * The axis is locked on the first movement past a few pixels (design D152):
 * a sideways one is the swipe's, and its `touchmove`s are cancelled, so the
 * browser starts no fling of its own, whose stop would take the next tap's
 * click; an upward or downward one is the grid's scroll, which the browser
 * runs (`touch-action: pan-y`). A drag (design D111) takes the finger from
 * the swipe.
 */
export function useSwipe(ref: RefObject<HTMLElement | null>, handlers: SwipeHandlers): void {
  const start = useEffectEvent(() => handlers.onStart?.());
  const moved = useEffectEvent((dx: number) => handlers.onMove?.(dx));
  const ended = useEffectEvent((dx: number, dy: number, velocity: number) =>
    handlers.onEnd(dx, dy, velocity),
  );
  const cancelled = useEffectEvent(() => handlers.onCancel?.());
  // The finger down now, kept apart from the listeners: they may be attached
  // again while it is down (React's Strict Mode does so after mounting, in
  // development), and a swipe would then lose where it began (design D152).
  const finger = useRef<Finger | null>(null);
  // Attached as the element is, before anything is painted or pressed.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const dragging = () => document.documentElement.dataset["dragging"] !== undefined;
    const down = (event: globalThis.PointerEvent) => {
      finger.current =
        event.pointerType === "touch" && event.isPrimary
          ? {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              axis: null,
              samples: [{ x: event.clientX, t: event.timeStamp }],
            }
          : null;
    };
    const drop = () => {
      const was = finger.current;
      finger.current = null;
      if (was?.axis === "x") cancelled();
    };
    const move = (event: globalThis.PointerEvent) => {
      const now = finger.current;
      if (!now || event.pointerId !== now.id) return;
      if (dragging()) return drop();
      const dx = event.clientX - now.x;
      const dy = event.clientY - now.y;
      now.samples.push({ x: event.clientX, t: event.timeStamp });
      while (now.samples.length > 2 && event.timeStamp - now.samples[0]!.t > SPEED_WINDOW) {
        now.samples.shift();
      }
      if (!now.axis) {
        if (Math.hypot(dx, dy) < SWIPE_SLOP) return;
        now.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (now.axis === "x") start();
      }
      if (now.axis === "x") moved(dx);
    };
    const touchMove = (event: TouchEvent) => {
      if (finger.current?.axis === "x" && event.cancelable) event.preventDefault();
    };
    const up = (event: globalThis.PointerEvent) => {
      const from = finger.current;
      if (!from || event.pointerId !== from.id) return;
      finger.current = null;
      // A tap, or the grid's scroll: no swipe to end, nothing settles.
      if (from.axis !== "x") return;
      const first = from.samples[0]!;
      const elapsed = event.timeStamp - first.t;
      const velocity = elapsed > 0 ? (event.clientX - first.x) / elapsed : 0;
      ended(event.clientX - from.x, event.clientY - from.y, velocity);
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", drop);
    // Not passive: the browser waits for it before it moves the page.
    element.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", drop);
      element.removeEventListener("touchmove", touchMove);
    };
  }, [ref]);
}
