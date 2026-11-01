// A query that runs again whenever the store changes (a sync writes while the
// app is open). A burst of writes costs at most one more run: a change during
// a run marks it stale, and one run follows when it ends. A read that failed
// because the web store's leader tab went is not reported: the store tells
// every subscriber once the next leader serves, and the query runs again
// (docs/plans/foundation.md#D98).
import { handOverIn, type Store } from "@astrotime/storage";

export function liveQuery<T>(
  store: Store,
  run: () => Promise<T>,
  onResult: (result: T) => void,
  onError: (error: unknown) => void = (error) => console.error(error),
): () => void {
  let stopped = false;
  let running = false;
  let stale = false;
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
        if (!stopped && !stale) onResult(result);
      } catch (error) {
        if (!stopped && !handOverIn(error)) onError(error);
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
