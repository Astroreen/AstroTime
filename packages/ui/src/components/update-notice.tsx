// A newer version of the app is ready (the web's service worker,
// docs/plans/foundation.md#D124): said quietly at the foot of the screen,
// with Reload, never in the way of what the user is doing.
import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import type { AppUpdates } from "../platform.ts";
import { CloseIcon } from "./icons.tsx";

export function UpdateNotice({ updates }: { updates: AppUpdates }) {
  const { t } = useTranslation();
  const waiting = useSyncExternalStore(
    (onChange) => updates.subscribe(onChange),
    () => updates.waiting,
  );
  // Later, for this page: the new version runs once every tab of it is closed.
  const [later, setLater] = useState(false);
  if (!waiting || later) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[120] flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-2 rounded-2xl bg-raised p-2 pl-4 text-[14px] text-ink shadow-lg ring-1 ring-line"
    >
      <p className="flex-1 py-1">{t("update.ready")}</p>
      <button
        type="button"
        onClick={() => updates.apply()}
        className="rounded-full px-4 py-2 text-sm font-medium text-accent hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        {t("update.reload")}
      </button>
      <button
        type="button"
        onClick={() => setLater(true)}
        aria-label={t("update.later")}
        className="grid size-8 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        <CloseIcon className="size-4" />
      </button>
    </div>
  );
}
