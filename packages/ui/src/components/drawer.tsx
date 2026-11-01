// The drawer (design D46): the views, then each account with its menu and
// its calendars, each with its colour and a visibility checkbox
// (`AccountSection`). A sheet over the view on a phone, with Settings last
// (D131); a sidebar on a wide screen, headed by Create (D132), where Settings
// is the top bar's.
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
  /** Opens Settings: the drawer's last row, on a phone. */
  onSettings?: (() => void) | undefined;
  /** Creates an event, at the sidebar's top on a wide screen (D132); none on a phone, where the "+" button floats. */
  create?: { readonly disabled: boolean; readonly onCreate: () => void } | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1 px-2 pt-3 pb-6">
      {create ? (
        <div className="px-2 pt-1 pb-4">
          <button
            type="button"
            disabled={create.disabled}
            onClick={create.onCreate}
            className="flex h-14 items-center gap-3 rounded-2xl bg-fab pr-6 pl-4 text-[15px] font-medium text-on-fab shadow-md shadow-black/15 hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
          >
            <PlusIcon className="size-6" />
            {t("fab.create")}
          </button>
        </div>
      ) : (
        <p className="px-4 pb-3 text-[19px] font-medium tracking-tight">{t("app.name")}</p>
      )}
      <h2 className="sr-only">{t("drawer.views")}</h2>
      <ul className="flex flex-col">
        {VIEWS.map((v) => (
          <li key={v}>
            <button
              type="button"
              aria-current={v === view ? "true" : undefined}
              onClick={() => onView(v)}
              className={`flex h-11 w-full items-center gap-4 rounded-full px-4 text-left text-[14.5px] ${
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
      <h2 className="px-4 pt-1 pb-1 text-[13px] font-medium text-ink-muted">
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
      {onSettings ? (
        <>
          <hr className="mx-4 my-2 border-line" />
          <button
            type="button"
            onClick={onSettings}
            className="flex h-11 w-full items-center gap-4 rounded-full px-4 text-left text-[14.5px] hover:bg-raised-hover"
          >
            <SettingsIcon className="size-5 text-ink-muted" />
            {t("settings.title")}
          </button>
        </>
      ) : null}
    </div>
  );
}
