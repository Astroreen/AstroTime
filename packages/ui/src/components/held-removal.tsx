// A subscription's file that would remove most of its calendar, held until
// the user lets it (docs/plans/providers.md#D263): how many would go, and
// the way to let them. Loads only when a sync held one.
import { useTranslation } from "react-i18next";

import { addSubscribeStrings } from "../i18n/subscribe.ts";
import { useAccounts } from "./accounts-context.tsx";

/** Outside the component: the React Compiler does not compile an `import()` (design D194). */
const subscriptions = () => import("@astrotime/sync/subscriptions");

export default function HeldRemoval({
  accountId,
  held,
}: {
  accountId: string;
  held: { readonly count: number; readonly version: string };
}) {
  const { t, i18n } = useTranslation();
  addSubscribeStrings(i18n);
  const { platform, scheduler } = useAccounts();
  return (
    <p className="flex flex-wrap items-center gap-x-2">
      {t("subscribe.held", { count: held.count })}
      <button
        type="button"
        className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() =>
          void subscriptions()
            .then(({ applyHeld }) =>
              applyHeld({ secrets: platform.secrets }, accountId, held.version),
            )
            .then(() => scheduler.syncNow())
            .catch(console.error)
        }
      >
        {t("subscribe.applyHeld")}
      </button>
    </p>
  );
}
