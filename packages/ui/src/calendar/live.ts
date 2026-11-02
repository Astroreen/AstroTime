// A query that runs again whenever the store changes (a sync writes while the
// app is open). A burst of writes costs at most one more run: a change during
// a run marks it stale, and one run follows when it ends. A result the same
// as the last one reported is not reported again (`same`), so a write that
// changed nothing this query reads costs no render (docs/plans/foundation.md#D181).
// A read that failed because the web store's leader tab went is not
// reported: the store tells every subscriber once the next leader serves,
// and the query runs again (docs/plans/foundation.md#D98). What is drawn
// hears the store through `whileShown`: a hidden page's views wait
// (docs/plans/foundation.md#D182).
import { handOverIn, type Store } from "@astrotime/storage";

/** What a live query hears the store's changes through: the store, or `whileShown` of it. */
export type Changes = Pick<Store, "subscribe">;

export function liveQuery<T>(
  store: Changes,
  run: () => Promise<T>,
  onResult: (result: T) => void,
  onError: (error: unknown) => void = (error) => console.error(error),
  /**
   * Whether a result is the one reported last, not to be reported again; a
   * query whose `onResult` must act on every run gives `everyRun`.
   */
  same: (last: T, result: T) => boolean = sameResult,
): () => void {
  let stopped = false;
  let running = false;
  let stale = false;
  let last: { readonly result: T } | null = null;
  const go = async () => {
    if (running) {
      stale = true;
      return;
    }
    running = true;
    for (;;) {
      stale = false;
      try {
        const result = await run();
        if (!stopped && !stale && !(last && same(last.result, result))) {
          // Kept as given: a consumer treats a result as read-only, as React does its state.
          last = { result };
          onResult(result);
        }
      } catch (error) {
        if (!stopped && !handOverIn(error)) {
          // What follows an error is reported, even the result reported before it.
          last = null;
          onError(error);
        }
      }
      // A change came during the run (`stale`, set by another `go`): once more.
      if (!stale || stopped) break;
    }
    running = false;
  };
  const unsubscribe = store.subscribe(() => void go());
  void go();
  return () => {
    stopped = true;
    unsubscribe();
  };
}

/**
 * For a query whose `onResult` writes: every run is reported, since its last
 * write may have failed, or what it decides on is more than it reads.
 */
export const everyRun = (): boolean => false;

/**
 * Whether two results are the same: arrays and plain objects (rows, lists of
 * them) by what they hold, anything else (a parsed object, kept by a cache
 * while its iCalendar is unchanged) by identity.
 */
export function sameResult(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) && a.length === b.length && a.every((item, i) => sameResult(item, b[i]))
    );
  }
  if (!isPlain(a) || !isPlain(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.hasOwn(b, key) &&
        sameResult((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

function isPlain(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Whether the page is shown, and when that changes; the document's by default, a fake in tests. */
export interface PageVisibility {
  shown(): boolean;
  /** Calls `listener` when the page is shown or hidden; returns the function that stops it. */
  onChange(listener: () => void): () => void;
}

export const documentVisibility: PageVisibility = {
  // No document (a headless run, a test in Node): always shown.
  shown: () => typeof document === "undefined" || document.visibilityState !== "hidden",
  onChange(listener) {
    if (typeof document === "undefined") return () => {};
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

/**
 * The store's changes as something drawn hears them (docs/plans/foundation.md#D182):
 * while the page is hidden they wait, and come as one when it is shown again,
 * so a hidden tab reads and draws nothing for another tab's or a sync's writes.
 */
export function whileShown(changes: Changes, page: PageVisibility = documentVisibility): Changes {
  return {
    subscribe(listener) {
      let missed = false;
      const stopChanges = changes.subscribe(() => {
        if (page.shown()) listener();
        else missed = true;
      });
      const stopPage = page.onChange(() => {
        if (!missed || !page.shown()) return;
        missed = false;
        listener();
      });
      return () => {
        stopChanges();
        stopPage();
      };
    },
  };
}
