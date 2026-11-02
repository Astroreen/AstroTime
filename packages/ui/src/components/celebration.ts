// When completing a task is celebrated (design D198): when the user
// completes one, here or in its details, unless the setting is off or less
// motion is asked for; never for a change a sync brought. The burst's code
// comes with the first completion (D145).
import { useSettings } from "../settings.ts";

/** A burst from `from`, the checkbox or the button the user completed a task with. */
export function useCelebrate(): (from: Element | null | undefined) => void {
  const { settings } = useSettings();
  return (from) => {
    // `reducedMotion` of the Pager, asked here so this file, which the
    // editing chunk shares, does not take the Pager into that chunk (D145).
    if (!from || !settings.celebrate || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    // Where it was pressed, now: a first burst waits for its code, and what
    // was pressed may have moved by then (its row on its way to "Completed").
    const { left, top, width, height } = from.getBoundingClientRect();
    const at = { x: left + width / 2, y: top + height / 2 };
    import("./celebrate.ts").then(
      ({ celebrate }) => celebrate(at),
      () => {
        // Not loaded (offline, a new release): the task is completed all the same.
      },
    );
  };
}
