// What the user is told when a change made outside the edit dialog (a
// deletion, a task completed or starred) did not land: the item was gone,
// it is unclear whether it was saved, or it failed (docs/plans/foundation.md#D103).
import { useTranslation } from "react-i18next";

import type { Notice } from "../calendar/editing.ts";
import { CloseIcon } from "./icons.tsx";

const KEYS = {
  gone: "edit.problem.gone",
  inDoubt: "edit.problem.inDoubt",
  failed: "edit.failed",
  deleteInDoubt: "notice.deleteInDoubt",
  deleteFailed: "notice.deleteFailed",
} as const satisfies Record<Notice, string>;

export function ChangeNotice({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const { t } = useTranslation();
  if (!notice) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 z-[120] flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-2 rounded-2xl bg-danger-soft p-3 text-body text-danger shadow-lg"
    >
      <p className="flex-1 py-1">{t(KEYS[notice])}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("notice.close")}
        className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-danger"
      >
        <CloseIcon className="size-4" />
      </button>
    </div>
  );
}
