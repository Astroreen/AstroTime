// Where a new calendar or list goes and why one was not made
// (docs/plans/design.md#D276, docs/plans/import.md#D277): a module of its
// own, so a dialog names this device and says a failure without loading
// what makes one (`make.ts`).

/** Where a new calendar goes: an account's id, or this device. */
export type Place = string;
export const DEVICE = "device";

/** Why no calendar was made, as a dialog says it. */
export type NotMade = "offline" | "unsupported" | "refused" | "signed-out" | "failed";

export function whyNotMade(error: unknown): NotMade {
  const { name, reason, status } = (error ?? {}) as {
    name?: unknown;
    reason?: unknown;
    status?: unknown;
  };
  if (name === "OfflineError" || name === "ServerBusyError") return "offline";
  if (name === "AuthError") return "signed-out";
  if (name === "CannotMakeCalendarError")
    return reason === "unsupported"
      ? "unsupported"
      : reason === "signed-out"
        ? "signed-out"
        : "failed";
  if (name === "HttpError" && status === 403) return "refused";
  return "failed";
}
