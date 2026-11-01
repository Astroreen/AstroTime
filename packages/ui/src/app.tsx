// AstroTime's UI, the same in every app (docs/plans/foundation.md#D22): the
// app brings its platform (docs/plans/android.md#D60: the store, HTTP,
// secrets, the system browser, where preferences are kept) and the user's
// languages, and renders this.
import { InsecureContextError, StoreInUseError, type Store } from "@astrotime/storage";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { useEffect, useMemo, useRef, useState } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";

import { localeSettings } from "./calendar/locale.ts";
import { AccountsProvider } from "./components/accounts-context.tsx";
import { CalendarScreen } from "./components/calendar-screen.tsx";
import { createI18n } from "./i18n/index.ts";
import type { Platform } from "./platform.ts";
import { KEYS, usePreference } from "./preferences.ts";
import { readSettings, SettingsContext, withSettings, type Settings } from "./settings.ts";

export interface AstroTimeProps {
  readonly platform: Platform;
  /** The user's languages, most preferred first (`navigator.languages`). */
  readonly languages: readonly string[];
  /** The IANA zone the calendar is shown in; the device's by default. */
  readonly timeZone?: string;
  /** The page's Content Security Policy nonce, for the styles Base UI adds (foundation D110). */
  readonly nonce?: string;
}

type Opening =
  | { readonly status: "opening" }
  | { readonly status: "open"; readonly store: Store }
  | { readonly status: "failed"; readonly error: unknown };

export function AstroTime({ platform, languages, timeZone, nonce }: AstroTimeProps) {
  const { store, preferences } = platform;
  // The drawer's settings (design D53), applied as soon as they change.
  const [chosen, setChosen] = usePreference(preferences, KEYS.settings, readSettings, (value) =>
    JSON.stringify(value),
  );
  const language = chosen.language === "system" ? undefined : chosen.language;
  const settings = useMemo(
    () => withSettings(localeSettings(languages, language), chosen),
    [languages, language, chosen],
  );
  const [i18n] = useState(() => createI18n(settings.language));
  const [zone] = useState(() => timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [opening, setOpening] = useState<Opening>({ status: "opening" });

  useEffect(() => {
    document.documentElement.lang = settings.language;
    void i18n.changeLanguage(settings.language);
  }, [i18n, settings.language]);

  // The theme follows the system unless one is chosen (design D58).
  useEffect(() => {
    const root = document.documentElement;
    if (chosen.theme === "system") delete root.dataset["theme"];
    else root.dataset["theme"] = chosen.theme;
  }, [chosen.theme]);

  useEffect(() => {
    let live = true;
    store.then(
      (opened) => live && setOpening({ status: "open", store: opened }),
      (error: unknown) => {
        if (!(error instanceof StoreInUseError || error instanceof InsecureContextError)) {
          console.error(error);
        }
        if (live) setOpening({ status: "failed", error });
      },
    );
    return () => {
      live = false;
    };
  }, [store]);

  // From the latest settings, so two changes before a render keep both.
  const latest = useRef(chosen);
  latest.current = chosen;
  const change = (changes: Partial<Settings>) => {
    latest.current = { ...latest.current, ...changes };
    setChosen(latest.current);
  };
  const app = (
    <I18nextProvider i18n={i18n}>
      <SettingsContext.Provider value={{ settings: chosen, change }}>
        {opening.status === "open" ? (
          <AccountsProvider
            platform={platform}
            store={opening.store}
            settings={settings}
            timeZone={zone}
          >
            <CalendarScreen
              store={opening.store}
              preferences={preferences}
              settings={settings}
              timeZone={zone}
            />
          </AccountsProvider>
        ) : (
          <StoreMessage opening={opening} />
        )}
      </SettingsContext.Provider>
    </I18nextProvider>
  );
  return <CSPProvider nonce={nonce}>{app}</CSPProvider>;
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
  const reason =
    opening.error instanceof StoreInUseError
      ? "inUse"
      : opening.error instanceof InsecureContextError
        ? "insecure"
        : "failed";
  return (
    <main className="grid h-dvh place-items-center bg-canvas p-6 text-ink">
      <div
        role="alert"
        className="flex max-w-sm flex-col items-start gap-3 rounded-2xl bg-raised p-6"
      >
        <h1 className="text-lg font-medium">{t(`store.${reason}.title`)}</h1>
        <p className="text-sm text-ink-muted">{t(`store.${reason}.body`)}</p>
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
