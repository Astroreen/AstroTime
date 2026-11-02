// An item's illustration (design D215, D216): which picture its title gives
// while illustrations are on (D217), and the details' header drawn over it.
import type { CSSProperties, ReactNode } from "react";

import { ITEM_ART, type Art } from "../pictures/art.ts";
import { themeOf } from "../pictures/themes.ts";
import { useSettings } from "../settings.ts";

/** The illustration an item is drawn over, if any: its theme's, while illustrations are on. */
export function useItemArt(title: string | null | undefined): Art | null {
  const { settings } = useSettings();
  if (!settings.illustrations) return null;
  const theme = themeOf(title);
  return theme && ITEM_ART[theme];
}

/**
 * The details' header (design D216): the item's picture across the top,
 * the dialog's bar (`children`) over it, its buttons on dark discs so they
 * read over any picture; with no picture, the bar alone, as before.
 */
export function DetailsPicture({
  title,
  children,
}: {
  title: string | null | undefined;
  children: ReactNode;
}) {
  const art = useItemArt(title);
  if (!art) return children;
  return (
    <div
      className="details-picture relative mb-4 h-40 shrink-0 overflow-hidden"
      style={{ "--ground": art.ground } as CSSProperties}
    >
      <img
        src={art.url}
        alt=""
        decoding="async"
        draggable={false}
        className="absolute inset-0 size-full object-cover"
      />
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-16 bg-linear-to-b from-black/30 to-transparent"
      />
      <div className="relative">{children}</div>
    </div>
  );
}
