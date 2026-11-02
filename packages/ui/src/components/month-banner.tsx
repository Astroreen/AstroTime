// The Agenda's month banner (design D218): a wide picture of the month's
// season above its first day, its name over it at the top left. The
// picture drifts a little slower than the list as it passes (a scroll-driven
// animation, off the main thread; none with reduced motion, or where the
// browser has none). Its box has its size before the picture comes.
import type { CSSProperties, ReactNode } from "react";

import { MONTH_ART } from "../pictures/art.ts";
import { bannerOf } from "../pictures/months.ts";
import { usePictureUrl } from "../pictures/own.ts";
import { useSettings } from "../settings.ts";

export function MonthBanner({
  month,
  timeZone,
  children,
}: {
  /** The month, 1–12. */
  month: number;
  timeZone: string;
  /** The month's heading. */
  children: ReactNode;
}) {
  const { settings } = useSettings();
  // The user's own banner of this month (design D223), shown even with AstroTime's off.
  const own = settings.ownBanners[String(month)] ?? null;
  const ownUrl = usePictureUrl(own);
  if (!settings.monthBanners && !own) {
    return <h2 className="px-4 pt-4 pb-1 text-row font-medium">{children}</h2>;
  }
  const art = MONTH_ART[bannerOf(month, timeZone) - 1]!;
  const url = own ? ownUrl : art.url;
  return (
    <div
      className="month-banner relative mt-3 mb-2 h-36 overflow-hidden sm:mx-2 sm:rounded-2xl lg:h-44"
      style={{ "--ground": own ? "#59627a" : art.ground } as CSSProperties}
    >
      {url && (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-x-0 -top-[8%] h-[116%] w-full object-cover"
        />
      )}
      <span aria-hidden="true" className="month-banner-scrim absolute inset-0" />
      <h2 className="picture-text relative px-4 pt-3 text-title font-medium text-white">
        {children}
      </h2>
    </div>
  );
}
