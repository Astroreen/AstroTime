// Removing an account from this device, confirmed first: its calendars and
// items go from the local store, its credentials from the secret store; the
// server keeps everything but an app password Login Flow gave, which is
// revoked, or the user is told it could not be (docs/plans/foundation.md#D90).
import type { Account } from "@astrotime/storage";
import type { AppPasswordRevocation } from "@astrotime/sync";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { accountName } from "./accounts.tsx";
import { textButton } from "./sign-in-dialog.tsx";

export function RemoveAccountDialog({
  account,
  onClose,
  onRemove,
}: {
  account: Account | null;
  onClose: () => void;
  onRemove: (account: Account) => Promise<AppPasswordRevocation>;
}) {
  const { t } = useTranslation();
  const [removing, setRemoving] = useState(false);
  // The calendar on this device has no server to keep its items (D122).
  const local = account?.provider === "local";
  const name = account ? accountName(account, t) : "";
  /** Removed, but its app password is still valid on the server. */
  const [kept, setKept] = useState(false);
  const close = () => {
    setKept(false);
    onClose();
  };
  return (
    <AlertDialog.Root open={account !== null} onOpenChange={(open) => !open && close()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-[100] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-[110] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-raised p-6 text-ink shadow-2xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          {kept ? (
            <>
              <AlertDialog.Title className="text-lg font-medium">
                {t("accounts.notRevokedTitle", { name })}
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm text-ink-muted">
                {t("accounts.notRevokedBody")}
              </AlertDialog.Description>
              <div className="mt-5 flex justify-end gap-2">
                <AlertDialog.Close className={textButton}>
                  {t("accounts.notRevokedClose")}
                </AlertDialog.Close>
              </div>
            </>
          ) : (
            <>
              <AlertDialog.Title className="text-lg font-medium">
                {local ? t("local.removeTitle") : t("accounts.removeTitle", { name })}
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm text-ink-muted">
                {t(local ? "local.removeBody" : "accounts.removeBody")}
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
                      .then(
                        (revocation) => (revocation === "kept" ? setKept(true) : close()),
                        (error: unknown) => {
                          console.error(error);
                          close();
                        },
                      )
                      .finally(() => setRemoving(false));
                  }}
                >
                  {t(local ? "local.removeConfirm" : "accounts.removeConfirm")}
                </button>
              </div>
            </>
          )}
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
