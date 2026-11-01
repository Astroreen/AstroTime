// When the UI syncs (docs/plans/foundation.md#D91): on start, when the app is
// back in front of the user, every few minutes while it is, after a local
// change, and when the network comes back. Every trigger calls `syncAll`,
// which joins a sync already running, so two never run at once.
import type { AccountSync, SyncAllReport } from "@astrotime/sync";

/** A sync while the app is visible: often enough to see another device's change soon. */
export const SYNC_EVERY_MS = 5 * 60_000;
/** Coming back to the app syncs only when the last sync started longer ago than this. */
export const REFOCUS_GAP_MS = 60_000;
/** A burst of local changes is sent once, this long after the last of them. */
export const CHANGE_DEBOUNCE_MS = 2_000;

type Event = "visible" | "hidden" | "online" | "offline";

/** What the scheduler needs of the page; the browser's by default, a fake in tests. */
export interface SyncEnvironment {
  now(): number;
  visible(): boolean;
  online(): boolean;
  /** Calls `listener` on `event`; returns the function that stops it. */
  on(event: Event, listener: () => void): () => void;
  /** Calls `run` every `ms`; returns the function that stops it. */
  every(ms: number, run: () => void): () => void;
  /** Calls `run` once after `ms`; returns the function that cancels it. */
  after(ms: number, run: () => void): () => void;
}

export function browserEnvironment(): SyncEnvironment {
  return {
    now: () => Date.now(),
    visible: () => document.visibilityState === "visible",
    online: () => navigator.onLine,
    on(event, listener) {
      if (event === "online" || event === "offline") {
        window.addEventListener(event, listener);
        return () => window.removeEventListener(event, listener);
      }
      // Another tab or another window in front and back again: the tab's
      // visibility, and the window's focus for a window beside others.
      const onVisibility = () => {
        if ((document.visibilityState === "visible") === (event === "visible")) listener();
      };
      document.addEventListener("visibilitychange", onVisibility);
      if (event === "visible") window.addEventListener("focus", listener);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        if (event === "visible") window.removeEventListener("focus", listener);
      };
    },
    every(ms, run) {
      const timer = setInterval(run, ms);
      return () => clearInterval(timer);
    },
    after(ms, run) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  };
}

/** One account's latest sync, for the UI. */
export interface AccountStatus {
  readonly last: AccountSync;
  /** When it last synced without stopping; `null` if it never has here. */
  readonly syncedAt: number | null;
}

export interface SyncStatus {
  readonly running: boolean;
  /** The browser says there is no network at all. */
  readonly offline: boolean;
  readonly accounts: ReadonlyMap<string, AccountStatus>;
}

/** Runs the UI's syncs and says how they went. */
export class SyncScheduler {
  readonly #sync: (fresh: boolean) => Promise<SyncAllReport>;
  readonly #environment: SyncEnvironment;
  readonly #listeners = new Set<() => void>();
  #status: SyncStatus;
  #running = 0;
  #lastStart = Number.NEGATIVE_INFINITY;
  #cancelChange: (() => void) | null = null;

  constructor(sync: (fresh: boolean) => Promise<SyncAllReport>, environment: SyncEnvironment) {
    this.#sync = sync;
    this.#environment = environment;
    this.#status = { running: false, offline: !environment.online(), accounts: new Map() };
  }

  get status(): SyncStatus {
    return this.#status;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Syncs now and keeps syncing on the triggers; returns the function that stops them. */
  start(): () => void {
    const env = this.#environment;
    let stopTimer: (() => void) | null = null;
    const startTimer = () => {
      stopTimer?.();
      stopTimer = env.every(SYNC_EVERY_MS, () => {
        if (env.visible() && env.online()) void this.#run(false);
      });
    };
    const stops = [
      env.on("visible", () => {
        if (env.online() && env.now() - this.#lastStart >= REFOCUS_GAP_MS) void this.#run(false);
        startTimer();
      }),
      // A hidden tab's timers are throttled anyway; the next visit syncs.
      env.on("hidden", () => {
        stopTimer?.();
        stopTimer = null;
      }),
      env.on("online", () => {
        this.#update({ offline: false });
        void this.#run(false);
      }),
      env.on("offline", () => this.#update({ offline: true })),
    ];
    void this.#run(false);
    if (env.visible()) startTimer();
    return () => {
      for (const stop of stops) stop();
      stopTimer?.();
      this.#cancelChange?.();
      this.#cancelChange = null;
    };
  }

  /** "Sync now", and an account just added: a sync that starts after this call. */
  syncNow(): Promise<void> {
    return this.#run(true);
  }

  /** Something changed on this device: it goes up shortly, in one sync per burst. */
  changed(): void {
    this.#cancelChange?.();
    this.#cancelChange = this.#environment.after(CHANGE_DEBOUNCE_MS, () => {
      this.#cancelChange = null;
      void this.#run(true);
    });
  }

  async #run(fresh: boolean): Promise<void> {
    this.#lastStart = this.#environment.now();
    this.#running++;
    this.#update({ running: true });
    try {
      const report = await this.#sync(fresh);
      const accounts = new Map(this.#status.accounts);
      for (const last of report.accounts) {
        const syncedAt =
          last.status === "synced"
            ? report.finishedAt
            : (accounts.get(last.accountId)?.syncedAt ?? null);
        accounts.set(last.accountId, { last, syncedAt });
      }
      this.#update({ accounts });
    } catch (error) {
      // The store itself failed; the accounts keep what they last said.
      console.error(error);
    } finally {
      this.#running--;
      this.#update({ running: this.#running > 0 });
    }
  }

  #update(changes: Partial<SyncStatus>): void {
    this.#status = { ...this.#status, ...changes };
    for (const listener of this.#listeners) listener();
  }
}
