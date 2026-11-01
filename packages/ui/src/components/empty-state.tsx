// What a screen shows when it has nothing to list (design D134): its icon in
// a soft circle, what is empty, and what to do about it, in the middle of
// the free space rather than one grey line at the top.
import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint?: string | undefined;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-12 text-center">
      <span
        aria-hidden="true"
        className="grid size-14 place-items-center rounded-full bg-accent-soft text-accent"
      >
        {icon}
      </span>
      <p className="text-row font-medium text-ink">{title}</p>
      {hint ? <p className="max-w-72 text-small text-ink-muted">{hint}</p> : null}
    </div>
  );
}
