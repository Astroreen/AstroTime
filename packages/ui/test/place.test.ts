// Why no calendar was made, in a dialog's own words (design D276, import
// D277): each error a reason the catalogs say, no error's English shown.
import { describe, expect, test } from "vite-plus/test";

import { whyNotMade } from "../src/calendar/place.ts";

const named = (name: string, fields: Record<string, unknown> = {}) =>
  Object.assign(new Error("English the user never reads"), { name, ...fields });

describe("why no calendar was made", () => {
  test("each error its reason; an error answered with its status", () => {
    expect(whyNotMade(named("OfflineError")).why).toBe("offline");
    // A server that answered and asked to wait is busy, not out of reach.
    expect(whyNotMade(named("ServerBusyError", { retryAfterMs: 1000 })).why).toBe("busy");
    expect(whyNotMade(named("AuthError")).why).toBe("signed-out");
    for (const reason of ["unsupported", "signed-out", "no-name", "no-server"])
      expect(whyNotMade(named("CannotMakeCalendarError", { reason })).why).toBe(reason);
    expect(whyNotMade(named("HttpError", { status: 403 })).why).toBe("refused");
    expect(whyNotMade(named("HttpError", { status: 507 }))).toEqual({
      why: "answered",
      status: 507,
    });
    expect(whyNotMade(new TypeError("x")).why).toBe("failed");
    expect(whyNotMade(null).why).toBe("failed");
  });
});
