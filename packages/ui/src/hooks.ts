import { useEffect, useState, useSyncExternalStore } from "react";

import { nowIn } from "./calendar/dates.ts";

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
