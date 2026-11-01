// Removing an account from this device, confirmed first: its calendars and
// items go from the local store, its credentials from the secret store; the
// server keeps everything (docs/plans/foundation.md#D90).
import type { Account } from "@astrotime/storage";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { textButton } from "./sign-in-dialog.tsx";

export function RemoveAccountDialog({
  account,
  onClose,
  onRemove,
}: {
  account: Account | null;
  onClose: () => void;
  onRemove: (account: Account) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [removing, setRemoving] = useState(false);
  return (
    <AlertDialog.Root open={account !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-[100] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-[110] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-raised p-6 text-ink shadow-2xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <AlertDialog.Title className="text-lg font-medium">
            {t("accounts.removeTitle", { name: account?.name ?? "" })}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-ink-muted">
            {t("accounts.removeBody")}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close className={textButton}>
              {t("accounts.removeCancel")}
            </AlertDialog.Close>
            <button
              type="button"
              disabled={removing}
              className="rounded-full bg-danger px-5 py-2 text-sm font-medium text-on-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50"
              onClick={() => {
                if (!account) return;
                setRemoving(true);
                onRemove(account)
                  .catch((error: unknown) => console.error(error))
                  .finally(() => {
                    setRemoving(false);
                    onClose();
                  });
              }}
            >
              {t("accounts.removeConfirm")}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
