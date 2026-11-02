// An item's picture (design D215, D216, D220): the illustration its title
// gives while illustrations are on (D217), else its place's photo, and the
// details' header drawn over it, a photo with its credit.
import type { Item } from "@astrotime/core";
import type { CSSProperties, ReactNode } from "react";

import { ITEM_ART, type Art } from "../pictures/art.ts";
import type { PlacePhoto } from "../places/photos.ts";
import { subjectOf } from "../pictures/subjects.ts";
import { useSettings } from "../settings.ts";
import { PhotoCredit, usePlacePhoto } from "./place-photo.tsx";

/** What a card or a header is drawn over: an illustration, or a place's photo. */
export interface Backdrop {
  readonly url: string;
  readonly srcSet?: string;
  readonly ground: string;
  readonly photo: boolean;
}

/** A photo's ground until it comes: a calm slate, under white text. */
const PHOTO_GROUND = "#59627a";

export function backdropOf(picture: Art | PlacePhoto): Backdrop {
  if ("ground" in picture) return { url: picture.url, ground: picture.ground, photo: false };
  return {
    url: picture.url,
    srcSet: `${picture.small} 500w, ${picture.url} 960w`,
    ground: PHOTO_GROUND,
    photo: true,
  };
}

/** The illustration an item is drawn over, if any: its subject's, while illustrations are on. */
export function useItemArt(title: string | null | undefined): Art | null {
  const { settings } = useSettings();
  if (!settings.illustrations) return null;
  const subject = subjectOf(title);
  return subject && ITEM_ART[subject];
}

/**
 * The details' header (design D216, D221): the item's picture across the
 * top, the dialog's bar (`children`) over it, its buttons on dark discs so
 * they read over any picture; a place's photo with its credit at its foot;
 * with no picture, the bar alone, as before.
 */
export function DetailsPicture({ item, children }: { item: Item; children: ReactNode }) {
  const art = useItemArt(item.summary);
  const photo = usePlacePhoto(item, art === null);
  const picture = art ? backdropOf(art) : photo ? backdropOf(photo) : null;
  if (!picture) return children;
  return (
    <div
      className="details-picture relative mb-4 h-40 shrink-0 overflow-hidden"
      style={{ "--ground": picture.ground } as CSSProperties}
    >
      <img
        src={picture.url}
        {...(picture.srcSet && {
          srcSet: picture.srcSet,
          sizes: "(min-width: 640px) 448px, 100vw",
        })}
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
      {photo && !art && (
        <PhotoCredit
          photo={photo}
          className="picture-text absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-black/60 to-transparent px-3 pt-4 pb-1.5 text-right text-tiny text-white"
        />
      )}
    </div>
  );
}
