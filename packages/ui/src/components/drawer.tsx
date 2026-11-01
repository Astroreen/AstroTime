// The drawer (design D46): the views, then each account's calendars with
// their colour and a visibility checkbox. A sheet over the view on a phone,
// a sidebar on a wide screen.
import type { Account, Calendar } from "@astrotime/storage";
import { Checkbox } from "@base-ui/react/checkbox";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { VIEWS, type GridView, type View } from "../calendar/views.ts";
import { AgendaIcon, MonthIcon, ViewIcon } from "./icons.tsx";

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
}: {
  view: View;
  onView: (view: View) => void;
  accounts: readonly Account[];
  calendars: readonly Calendar[];
  hidden: ReadonlySet<string>;
  onToggle: (calendarId: string, visible: boolean) => void;
  colorOf: (calendar: Calendar) => string;
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
      {calendars.length === 0 && (
        <p className="px-4 py-2 text-[13.5px] text-ink-muted">{t("drawer.noCalendars")}</p>
      )}
      {accounts.map((account) => {
        const own = calendars.filter((calendar) => calendar.accountId === account.id);
        if (own.length === 0) return null;
        return (
          <section key={account.id} aria-label={account.name} className="flex flex-col">
            {accounts.length > 1 && (
              <h3 className="truncate px-4 pt-2 pb-1 text-xs text-ink-muted">{account.name}</h3>
            )}
            {own.map((calendar) => (
              <label
                key={calendar.id}
                className="flex h-10 cursor-pointer items-center gap-4 rounded-full px-4 text-[14px] hover:bg-raised-hover"
              >
                <Checkbox.Root
                  checked={!hidden.has(calendar.id)}
                  onCheckedChange={(checked) => onToggle(calendar.id, checked)}
                  className="grid size-[18px] shrink-0 place-items-center rounded-[4px] border-2 border-[var(--calendar)] data-checked:bg-[var(--calendar)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  style={{ "--calendar": colorOf(calendar) } as CSSProperties}
                >
                  <Checkbox.Indicator className="item-on-color flex data-unchecked:hidden">
                    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
                      <path
                        d="M3.5 8.5l3 3 6-7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Checkbox.Indicator>
                </Checkbox.Root>
                <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
              </label>
            ))}
          </section>
        );
      })}
    </div>
  );
}
