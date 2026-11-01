// The scope of an edit or a deletion of one occurrence of a series
// (docs/plans/foundation.md#D11), as Google asks it: "This occurrence",
// "This and following occurrences", "All occurrences". With no scope to
// choose, a deletion is only confirmed.
import type { Scope } from "@astrotime/core";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { primaryButton, textButton } from "./sign-in-dialog.tsx";

export interface ScopeRequest {
  readonly action: "edit" | "delete";
  readonly kind: "event" | "task";
  /** The scopes offered, the first chosen; empty: a deletion to confirm. */
  readonly scopes: readonly Scope[];
  readonly run: (scope: Scope) => void;
  /** Closed without a choice: Cancel, Escape or a tap outside. */
  readonly onCancel?: () => void;
}

export function ScopeDialog({
  request,
  onClose,
}: {
  request: ScopeRequest | null;
  onClose: () => void;
}) {
  return (
    <AlertDialog.Root
      open={request !== null}
      onOpenChange={(open) => {
        if (open) return;
        request?.onCancel?.();
        onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-[140] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:pointer-events-none" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-[150] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-raised p-6 text-ink shadow-2xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:pointer-events-none">
          {request && <Choice key={request.scopes.join()} request={request} onClose={onClose} />}
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function Choice({ request, onClose }: { request: ScopeRequest; onClose: () => void }) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<Scope>(request.scopes[0] ?? "all");
  const confirm = request.scopes.length === 0;
  const title = confirm
    ? t(`delete.${request.kind}`)
    : t(`scope.${request.action}.${request.kind}`);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onClose();
        request.run(scope);
      }}
    >
      <AlertDialog.Title className="text-title font-medium">{title}</AlertDialog.Title>
      {!confirm && (
        <fieldset className="mt-4 flex flex-col gap-1">
          <legend className="sr-only">{title}</legend>
          {request.scopes.map((option) => (
            <label
              key={option}
              className="flex min-h-11 cursor-pointer items-center gap-3 text-row"
            >
              <input
                type="radio"
                name="scope"
                value={option}
                checked={scope === option}
                onChange={() => setScope(option)}
                className="size-5 accent-[var(--color-accent)]"
              />
              {t(`scope.${option}`)}
            </label>
          ))}
        </fieldset>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <AlertDialog.Close className={textButton}>{t("scope.cancel")}</AlertDialog.Close>
        <button
          type="submit"
          autoFocus
          className={
            request.action === "delete"
              ? "rounded-full bg-danger px-5 py-2 text-body font-medium text-on-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
              : primaryButton
          }
        >
          {t(request.action === "delete" ? "delete.confirm" : "scope.ok")}
        </button>
      </div>
    </form>
  );
}
