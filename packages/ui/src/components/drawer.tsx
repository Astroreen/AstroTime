// The drawer (design D46): the views, then each account with its menu and
// its calendars, each with its colour and a visibility checkbox
// (`AccountSection`). A sheet over the view on a phone, a sidebar on a wide
// screen headed by Create (D132); on both, Settings at its foot, pinned to
// the bottom while the rest scrolls (D131, D226).
import type { Account, Calendar } from "@astrotime/storage";
import { useTranslation } from "react-i18next";

import { VIEWS, type GridView, type View } from "../calendar/views.ts";
import { AccountSection, AddAccountButton } from "./accounts.tsx";
import { AgendaIcon, MonthIcon, PlusIcon, SettingsIcon, ViewIcon } from "./icons.tsx";

const COLUMNS: Record<GridView, number> = { day: 1, "3days": 3, week: 7 };

function ViewMark({ view }: { view: View }) {
  const className = "size-5 text-ink-muted";
  if (view === "month") return <MonthIcon className={className} />;
  if (view === "agenda") return <AgendaIcon className={className} />;
  return <ViewIcon columns={COLUMNS[view]} className={className} />;
}

export function DrawerContent({
  view,
  onView,
  accounts,
  calendars,
  hidden,
  onToggle,
  colorOf,
  onLeave,
  onSettings,
  create,
}: {
  view: View;
  onView: (view: View) => void;
  accounts: readonly Account[];
  calendars: readonly Calendar[];
  hidden: ReadonlySet<string>;
  onToggle: (calendarId: string, visible: boolean) => void;
  colorOf: (calendar: Calendar) => string;
  /** Closes the drawer (on a phone) before an account's dialog opens. */
  onLeave: () => void;
  /** Opens Settings: the drawer's foot (D226). */
  onSettings: () => void;
  /** Creates an event, at the sidebar's top on a wide screen (D132); none on a phone, where the "+" button floats. */
  create?: { readonly disabled: boolean; readonly onCreate: () => void } | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col bg-inherit">
      <div className="flex flex-col gap-1 px-2 pt-3 pb-4">
        {create ? (
          <div className="px-2 pt-1 pb-4">
            <button
              type="button"
              disabled={create.disabled}
              onClick={create.onCreate}
              className="flex h-14 items-center gap-3 rounded-2xl bg-fab pr-6 pl-4 text-row font-medium text-on-fab shadow-md shadow-black/15 hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
            >
              <PlusIcon className="size-6" />
              {t("fab.create")}
            </button>
          </div>
        ) : (
          <p className="px-4 pb-3 text-title font-medium tracking-tight">{t("app.name")}</p>
        )}
        <h2 className="sr-only">{t("drawer.views")}</h2>
        <ul className="flex flex-col">
          {VIEWS.map((v) => (
            <li key={v}>
              <button
                type="button"
                aria-current={v === view ? "true" : undefined}
                onClick={() => onView(v)}
                className={`flex h-11 w-full items-center gap-4 rounded-full px-4 text-left text-body ${
                  v === view ? "bg-accent-soft font-medium" : "hover:bg-raised-hover"
                }`}
              >
                <ViewMark view={v} />
                {t(`view.${v}`)}
              </button>
            </li>
          ))}
        </ul>
        <hr className="mx-4 my-2 border-line" />
        <h2 className="px-4 pt-1 pb-1 text-small font-medium text-ink-muted">
          {t("drawer.calendars")}
        </h2>
        {accounts.map((account) => (
          <AccountSection
            key={account.id}
            account={account}
            calendars={calendars.filter((calendar) => calendar.accountId === account.id)}
            hidden={hidden}
            onToggle={onToggle}
            colorOf={colorOf}
            onLeave={onLeave}
          />
        ))}
        <AddAccountButton onLeave={onLeave} />
      </div>
      {/* Bottom left, where a sidebar's settings sit, kept in reach while the calendars scroll (D226). */}
      <div className="sticky bottom-0 mt-auto border-t border-line bg-inherit px-2 py-2">
        <button
          type="button"
          onClick={onSettings}
          className="flex h-11 w-full items-center gap-4 rounded-full px-4 text-left text-body hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent"
        >
          <SettingsIcon className="size-5 text-ink-muted" />
          {t("settings.title")}
        </button>
      </div>
    </div>
  );
}
