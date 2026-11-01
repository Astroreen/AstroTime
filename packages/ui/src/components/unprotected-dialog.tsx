// Asked before a password is saved where no keyring protects it
// (docs/plans/desktop.md#D74): keep it until the app quits, or save it
// unprotected. Over the sign-in dialog, which waits for the answer.
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import type { UnprotectedPrompt } from "../accounts/unprotected.ts";
import { primaryButton, textButton } from "./sign-in-dialog.tsx";
import { AlertDialogBackdrop, AlertDialogPopup } from "./dialog-parts.tsx";

export function UnprotectedDialog({ prompt }: { prompt: UnprotectedPrompt }) {
  const { t } = useTranslation();
  const asking = useSyncExternalStore(
    (onChange) => prompt.subscribe(onChange),
    () => prompt.asking,
  );
  return (
    // Escape keeps it until the app quits: nothing is written unless the user says so.
    <AlertDialog.Root open={asking} onOpenChange={(open) => !open && prompt.answer("until-quit")}>
      <AlertDialog.Portal>
        <AlertDialogBackdrop className="fixed inset-0 z-[120] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialogPopup className="fixed top-1/2 left-1/2 z-[130] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-raised p-6 text-ink shadow-2xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <AlertDialog.Title className="text-title font-medium">
            {t("secrets.unprotected.title")}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-body text-ink-muted">
            {t("secrets.unprotected.body")}
          </AlertDialog.Description>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={textButton}
              onClick={() => prompt.answer("unprotected")}
            >
              {t("secrets.unprotected.save")}
            </button>
            <button
              type="button"
              className={primaryButton}
              onClick={() => prompt.answer("until-quit")}
            >
              {t("secrets.unprotected.untilQuit")}
            </button>
          </div>
        </AlertDialogPopup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
