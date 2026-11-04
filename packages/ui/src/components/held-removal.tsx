// What a provider tells of a sync, in words that load with it: a
// subscription's file that would remove most of its calendar, held until
// the user lets it (docs/plans/providers.md#D263), how many would go and the
// way to let them; and a write a service took without some of an item's
// details (`NotKept`, D252).
import { useTranslation } from "react-i18next";

import { addSubscribeStrings } from "../i18n/subscribe.ts";
import { useAccounts } from "./accounts-context.tsx";

/** Outside the component: the React Compiler does not compile an `import()` (design D194). */
const subscriptions = () => import("@astrotime/sync/subscriptions");

/**
 * Writes the service took without some of the items' details (providers
 * D252): one line for all of a sync's, with what it could not keep.
 */
function NotKept({ errors }: { errors: readonly { readonly detail: string }[] }) {
  const { t, i18n } = useTranslation();
  addSubscribeStrings(i18n);
  const count = errors.length;
  const properties = [
    ...new Set(errors.flatMap((error) => error.detail.split(", ").filter(Boolean))),
  ];
  return (
    <p className="text-ink-muted">
      {t("subscribe.notKept", { count, properties: properties.join(", ") })}
    </p>
  );
}

function HeldRemoval({
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

/** One sync's problem, as `SyncReport.errors` holds it. */
interface Notice {
  readonly problem: string;
  readonly detail: string;
  readonly held?: { readonly count: number; readonly version: string };
}

/** What providers told of an account's last sync: a held removal, and what a service did not keep. */
export default function ProviderNotices({
  accountId,
  errors,
}: {
  accountId: string;
  errors: readonly Notice[];
}) {
  const held = errors.find((error) => error.held)?.held;
  const notKept = errors.filter((error) => error.problem === "not-kept");
  return (
    <>
      {held && <HeldRemoval accountId={accountId} held={held} />}
      {notKept.length > 0 && <NotKept errors={notKept} />}
    </>
  );
}
