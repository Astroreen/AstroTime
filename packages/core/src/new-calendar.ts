// What making a calendar on a server needs beside the provider's method
// (docs/plans/providers.md#D275): its name as it can be sent, and why one
// was not made. A module of its own (`@astrotime/core/new-calendar`), so it
// loads with what makes a calendar, never with the app.

/**
 * Why no calendar was made (docs/plans/providers.md#D275): `no-name`, its
 * name is nothing once trimmed; `unsupported`, the server (or that part of
 * the service) makes none; `no-server`, the account is on no server that
 * makes them (this device's, a subscription); `signed-out`, no credentials
 * are saved. Nothing was sent for any but `unsupported`.
 */
export class CannotMakeCalendarError extends Error {
  override name = "CannotMakeCalendarError";
  readonly reason: "no-name" | "unsupported" | "no-server" | "signed-out";
  constructor(reason: CannotMakeCalendarError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * A new calendar's name as it can be sent: trimmed, with no control
 * character, lone surrogate or noncharacter (U+FFFE, U+FFFF), which XML
 * 1.0 cannot carry; `null` when nothing is left.
 */
export function calendarNameOf(name: string): string | null {
  const kept = [...name]
    .filter((c) => {
      const code = c.codePointAt(0)!;
      return (
        code >= 0x20 &&
        code !== 0x7f &&
        code !== 0xfffe &&
        code !== 0xffff &&
        !(code >= 0xd800 && code <= 0xdfff)
      );
    })
    .join("")
    .trim();
  return kept === "" ? null : kept;
}
