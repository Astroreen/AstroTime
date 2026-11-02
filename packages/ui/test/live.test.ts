// `liveQuery` (docs/plans/foundation.md#D54, D181): a result the same as the
// last one reported costs no render, so an idle app does no work. Each run
// waits for the test to answer it, so nothing here waits for time.
import type { Store } from "@astrotime/storage";
import { expect, test } from "vite-plus/test";

import { everyRun, liveQuery, whileShown, type PageVisibility } from "../src/calendar/live.ts";

/** A store that only tells its listeners, when the test says it changed. */
function changingStore() {
  const listeners = new Set<() => void>();
  return {
    store: {
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as Store,
    changed: () => {
      for (const listener of listeners) listener();
    },
  };
}

/**
 * A query whose runs the test answers one by one: `asked` resolves when the
 * next run starts, and an answer resolves once the query decided on it (its
 * reaction runs before the test's, being first in line).
 */
function answered<T>() {
  const runs: PromiseWithResolvers<T>[] = [];
  const waiting: ((run: PromiseWithResolvers<T>) => void)[] = [];
  const answering = (run: PromiseWithResolvers<T>) => ({
    answer: async (value: T) => {
      run.resolve(value);
      await run.promise;
    },
    fail: async (error: Error) => {
      run.reject(error);
      await run.promise.catch(() => {});
    },
  });
  let started = 0;
  return {
    /** How many runs have started. */
    started: () => started,
    run: () => {
      started++;
      const run = Promise.withResolvers<T>();
      const next = waiting.shift();
      if (next) next(run);
      else runs.push(run);
      return run.promise;
    },
    asked: () =>
      new Promise<PromiseWithResolvers<T>>((resolve) => {
        const run = runs.shift();
        if (run) resolve(run);
        else waiting.push(resolve);
      }).then(answering),
  };
}

test("a result the same as the last one reported is not reported again; a new one is", async () => {
  const { store, changed } = changingStore();
  const query = answered<{ ids: string[] }>();
  const reported: unknown[] = [];
  liveQuery(store, query.run, (result) => reported.push(result));
  await (await query.asked()).answer({ ids: ["a"] });
  changed();
  // An equal result, new objects: not reported.
  await (await query.asked()).answer({ ids: ["a"] });
  changed();
  // The next run starts only once the one before it decided.
  const third = await query.asked();
  expect(reported).toEqual([{ ids: ["a"] }]);
  await third.answer({ ids: ["a", "b"] });
  changed();
  await query.asked();
  expect(reported).toEqual([{ ids: ["a"] }, { ids: ["a", "b"] }]);
});

test("a query whose result makes a write settles: an equal result makes no write", async () => {
  // As the app's lists: a write that notifies, and the same rows read again.
  const { store, changed } = changingStore();
  const query = answered<{ count: number }>();
  let reports = 0;
  liveQuery(store, query.run, () => {
    reports++;
    changed();
  });
  await (await query.asked()).answer({ count: 1 });
  // The write's change: one more run, the same result, and nothing more.
  await (await query.asked()).answer({ count: 1 });
  changed();
  await query.asked();
  expect(reports).toBe(1);
});

test("after an error, a result is reported even if the one before was the same", async () => {
  const { store, changed } = changingStore();
  const query = answered<number>();
  const seen: string[] = [];
  liveQuery(
    store,
    query.run,
    (result) => seen.push(`result ${result}`),
    () => seen.push("error"),
  );
  await (await query.asked()).answer(1);
  changed();
  await (await query.asked()).fail(new Error("The read failed."));
  changed();
  await (await query.asked()).answer(1);
  changed();
  await query.asked();
  expect(seen).toEqual(["result 1", "error", "result 1"]);
});

test("`everyRun` reports every run, equal or not", async () => {
  const { store, changed } = changingStore();
  const query = answered<boolean>();
  let reports = 0;
  liveQuery(store, query.run, () => reports++, undefined, everyRun);
  await (await query.asked()).answer(true);
  changed();
  await (await query.asked()).answer(true);
  changed();
  await query.asked();
  expect(reports).toBe(2);
});

/** A page the test shows and hides. */
function fakePage() {
  let shown = true;
  const listeners = new Set<() => void>();
  const page: PageVisibility = {
    shown: () => shown,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const set = (value: boolean) => {
    shown = value;
    for (const listener of listeners) listener();
  };
  return { page, show: () => set(true), hide: () => set(false), listeners };
}

test("while the page is hidden the store's changes wait, and come as one when it is shown (D182)", () => {
  const { store, changed } = changingStore();
  const { page, show, hide, listeners } = fakePage();
  let heard = 0;
  const stop = whileShown(store, page).subscribe(() => heard++);
  changed();
  expect(heard).toBe(1);
  hide();
  changed();
  changed();
  expect(heard).toBe(1);
  show();
  expect(heard).toBe(2);
  // Hidden and shown again with no change: nothing to read.
  hide();
  show();
  expect(heard).toBe(2);
  stop();
  changed();
  show();
  expect([heard, listeners.size]).toEqual([2, 0]);
});

test("a live query on `whileShown` reads once when the page is shown, whatever changed while hidden (D182)", async () => {
  const { store, changed } = changingStore();
  const { page, show, hide } = fakePage();
  const query = answered<number>();
  const reported: number[] = [];
  liveQuery(whileShown(store, page), query.run, (result) => reported.push(result));
  await (await query.asked()).answer(1);
  hide();
  changed();
  changed();
  changed();
  // Hidden: no read.
  expect(query.started()).toBe(1);
  show();
  expect(query.started()).toBe(2);
  await (await query.asked()).answer(2);
  expect(reported).toEqual([1, 2]);
  // Shown again with nothing changed: no read.
  hide();
  show();
  expect(query.started()).toBe(2);
});
