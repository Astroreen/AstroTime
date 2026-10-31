// A query that runs again whenever the store changes (a sync writes while the
// app is open). A burst of writes costs at most one more run: a change during
// a run marks it stale, and one run follows when it ends.
import type { Store } from "@astrotime/storage";

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
    do {
      stale = false;
      try {
        const result = await run();
        if (!stopped && !stale) onResult(result);
      } catch (error) {
        if (!stopped) onError(error);
      }
    } while (stale && !stopped);
    running = false;
  };
  const unsubscribe = store.subscribe(() => void go());
  void go();
  return () => {
    stopped = true;
    unsubscribe();
  };
}
