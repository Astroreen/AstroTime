// The drawer (design D46): the views, then each account with its menu and
// its calendars, each with its colour and a visibility checkbox
// (`AccountSection`), then the settings (D53). A sheet over the view on a
// phone, a sidebar on a wide screen.
import type { Account, Calendar } from "@astrotime/storage";
import { useTranslation } from "react-i18next";

import { VIEWS, type GridView, type View } from "../calendar/views.ts";
import { AccountSection, AddAccountButton } from "./accounts.tsx";
import { AgendaIcon, MonthIcon, ViewIcon } from "./icons.tsx";
import { SettingsSection } from "./settings-section.tsx";

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
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1 px-2 pt-3 pb-6">
      <p className="px-4 pb-3 text-[19px] font-medium tracking-tight">{t("app.name")}</p>
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
      <hr className="mx-4 my-2 border-line" />
      <SettingsSection />
    </div>
  );
}
