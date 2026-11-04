// What an import that stopped says (docs/plans/import.md#D277): why, and
// the calendars it made on servers before it stopped, which stay there,
// each in the catalog's words and joined as the language joins a list.
import type { Calendar } from "@astrotime/storage";
import type { TFunction } from "i18next";

import { whyNotMade } from "../calendar/place.ts";
import { CalendarNotMadeError, ImportStoppedError } from "./plan.ts";

/** The calendars made on servers and kept, as one sentence; none when there are none. */
export function keptWords(
  t: TFunction,
  language: string,
  kept: readonly Calendar[],
  nameOf: (accountId: string) => string,
  key: "import.notMade.kept" | "import.keptOnServer",
): string | null {
  if (kept.length === 0) return null;
  const names = new Intl.ListFormat(language, { type: "conjunction" }).format(
    kept.map((calendar) =>
      t("import.keptItem", { name: calendar.name, account: nameOf(calendar.accountId) }),
    ),
  );
  return t(key, { count: kept.length, names });
}

/** Why an import stopped, and what it made on servers and kept. */
export function failureWords(
  t: TFunction,
  language: string,
  error: unknown,
  nameOf: (accountId: string) => string,
): string {
  if (error instanceof CalendarNotMadeError) {
    const { why, status } = whyNotMade(error.cause);
    const said = t(`import.notMade.${why}`, { account: nameOf(error.accountId), status });
    const kept = keptWords(t, language, error.kept, nameOf, "import.notMade.kept");
    return kept ? `${said} ${kept}` : said;
  }
  if (error instanceof ImportStoppedError) {
    const said = stoppedWords(t, error.cause);
    const kept = keptWords(t, language, error.kept, nameOf, "import.keptOnServer");
    return kept ? `${said} ${kept}` : said;
  }
  return stoppedWords(t, error);
}

/** Why an import stopped, in the catalog's words: no error's English reaches the user. */
function stoppedWords(t: TFunction, cause: unknown): string {
  const { why } = whyNotMade(cause);
  return t(
    why === "offline" || why === "busy" || why === "signed-out" || why === "refused"
      ? `import.stopped.${why}`
      : "import.stopped.failed",
  );
}
