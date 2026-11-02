// A query that runs again whenever the store changes (a sync writes while the
// app is open). A burst of writes costs at most one more run: a change during
// a run marks it stale, and one run follows when it ends. A result the same
// as the last one reported is not reported again (`same`), so a write that
// changed nothing this query reads costs no render (docs/plans/foundation.md#D181).
// A read that failed because the web store's leader tab went is not
// reported: the store tells every subscriber once the next leader serves,
// and the query runs again (docs/plans/foundation.md#D98).
import { handOverIn, type Store } from "@astrotime/storage";

export function liveQuery<T>(
  store: Store,
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
function sameResult(a: unknown, b: unknown): boolean {
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
