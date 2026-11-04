// Where a new calendar or list goes and why one was not made
// (docs/plans/design.md#D276, docs/plans/import.md#D277): a module of its
// own, so a dialog names this device and says a failure without loading
// what makes one (`make.ts`).

/** Where a new calendar goes: an account's id, or this device. */
export type Place = string;
export const DEVICE = "device";

/**
 * Why no calendar was made, as a dialog says it in its own words (no
 * error's English reaches the user): its server not reached, busy (429,
 * 503), making none, refusing, its account signed out, no name, no server
 * at all, an error answered (`status`), or anything else.
 */
export type NotMade =
  | "offline"
  | "busy"
  | "unsupported"
  | "refused"
  | "signed-out"
  | "no-name"
  | "no-server"
  | "answered"
  | "failed";

export function whyNotMade(error: unknown): { readonly why: NotMade; readonly status: number } {
  const { name, reason, status } = (error ?? {}) as {
    name?: unknown;
    reason?: unknown;
    status?: unknown;
  };
  const answered = typeof status === "number" ? status : 0;
  const why = (): NotMade => {
    if (name === "ServerBusyError") return "busy";
    if (name === "OfflineError") return "offline";
    if (name === "AuthError") return "signed-out";
    if (name === "CannotMakeCalendarError")
      return reason === "unsupported" ||
        reason === "signed-out" ||
        reason === "no-name" ||
        reason === "no-server"
        ? reason
        : "failed";
    if (name === "HttpError") return answered === 403 ? "refused" : "answered";
    return "failed";
  };
  return { why: why(), status: answered };
}
