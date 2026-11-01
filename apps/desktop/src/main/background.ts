// What keeps the app alive with its window closed (docs/plans/desktop.md#D75,
// D76): the main process's own triggers. It asks the page for a sync every
// 15 minutes while the app runs and when the machine resumes, and checks the
// reminders again on resume and on unlock, since its timers stood still while
// the machine slept. Apart from Electron, so it is tested with a fake clock
// and a fake `powerMonitor`.

/** How often the main process asks for a sync, the window open or closed. */
export const SYNC_EVERY_MS = 15 * 60_000;

/** The `powerMonitor` events heard here. */
export type PowerEvent = "resume" | "unlock-screen";

export function backgroundTriggers(options: {
  /** Calls `run` every `ms`, while the app runs. */
  every(ms: number, run: () => void): unknown;
  power: { on(event: PowerEvent, listener: () => void): unknown };
  /** Asks the page for a sync (through the shared sync entry, foundation D91). */
  sync(): void;
  /** Checks the reminders again: what came due meanwhile shows. */
  wake(): void;
}): void {
  const { every, power, sync, wake } = options;
  power.on("resume", () => {
    wake();
    sync();
  });
  power.on("unlock-screen", wake);
  every(SYNC_EVERY_MS, sync);
}
