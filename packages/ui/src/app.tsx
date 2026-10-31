// AstroTime's UI, the same in every app (docs/plans/foundation.md#D22): the
// app brings the platform (its store, where preferences are kept, the user's
// languages) and renders this.
import { StoreInUseError, type Store } from "@astrotime/storage";
import { useEffect, useState } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";

import { localeSettings } from "./calendar/locale.ts";
import { CalendarScreen } from "./components/calendar-screen.tsx";
import { createI18n } from "./i18n/index.ts";
import type { Preferences } from "./preferences.ts";

export interface AstroTimeProps {
  /** The local store, opening; created once, outside React. */
  readonly store: Promise<Store>;
  readonly preferences: Preferences;
  /** The user's languages, most preferred first (`navigator.languages`). */
  readonly languages: readonly string[];
  /** The IANA zone the calendar is shown in; the device's by default. */
  readonly timeZone?: string;
}

type Opening =
  | { readonly status: "opening" }
  | { readonly status: "open"; readonly store: Store }
  | { readonly status: "failed"; readonly error: unknown };

export function AstroTime({ store, preferences, languages, timeZone }: AstroTimeProps) {
  const [settings] = useState(() => localeSettings(languages));
  const [i18n] = useState(() => createI18n(settings.language));
  const [zone] = useState(() => timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [opening, setOpening] = useState<Opening>({ status: "opening" });

  useEffect(() => {
    document.documentElement.lang = settings.language;
  }, [settings.language]);

  useEffect(() => {
    let live = true;
    store.then(
      (opened) => live && setOpening({ status: "open", store: opened }),
      (error: unknown) => {
        if (!(error instanceof StoreInUseError)) console.error(error);
        if (live) setOpening({ status: "failed", error });
      },
    );
    return () => {
      live = false;
    };
  }, [store]);

  return (
    <I18nextProvider i18n={i18n}>
      {opening.status === "open" ? (
        <CalendarScreen
          store={opening.store}
          preferences={preferences}
          settings={settings}
          timeZone={zone}
        />
      ) : (
        <StoreMessage opening={opening} />
      )}
    </I18nextProvider>
  );
}

/** While the store opens, or why it did not. */
function StoreMessage({ opening }: { opening: Exclude<Opening, { status: "open" }> }) {
  const { t } = useTranslation();
  if (opening.status === "opening") {
    return (
      <main className="grid h-dvh place-items-center bg-canvas text-ink-muted" aria-busy="true">
        <p>{t("store.opening")}</p>
      </main>
    );
  }
  const inUse = opening.error instanceof StoreInUseError;
  return (
    <main className="grid h-dvh place-items-center bg-canvas p-6 text-ink">
      <div
        role="alert"
        className="flex max-w-sm flex-col items-start gap-3 rounded-2xl bg-raised p-6"
      >
        <h1 className="text-lg font-medium">
          {t(inUse ? "store.inUse.title" : "store.failed.title")}
        </h1>
        <p className="text-sm text-ink-muted">
          {t(inUse ? "store.inUse.body" : "store.failed.body")}
        </p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent"
        >
          {t("store.reload")}
        </button>
      </div>
    </main>
  );
}
