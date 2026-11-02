// A place's photo where an item shows it (docs/plans/design.md#D220, D221):
// which items have one, the one lookup the whole app shares, and the
// photo's credit. Only while "Photos of places" is on and the platform's
// page reaches the network (its `places`, foundation D178).
import type { Item } from "@astrotime/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { addPictureStrings } from "../i18n/pictures.ts";
import { nameAndAddress } from "../places/map.ts";
import {
  isAddress,
  wikipediaPhotos,
  type PhotoLookup,
  type PhotoPlace,
  type PlacePhoto,
} from "../places/photos.ts";
import type { Preferences } from "../preferences.ts";
import { useSettings } from "../settings.ts";
import { useAccounts } from "./accounts-context.tsx";

/** One lookup per app: its queue, its answers kept. */
const lookups = new WeakMap<Preferences, PhotoLookup>();
const lookupOf = (preferences: Preferences) => {
  let lookup = lookups.get(preferences);
  if (!lookup) lookups.set(preferences, (lookup = wikipediaPhotos(preferences)));
  return lookup;
};

/** The place an item's photo would be of: one with a point, while photos may be asked for. */
function usePhotoPlace(
  item: Item,
): { place: PhotoPlace; lookup: PhotoLookup; language: string } | null {
  const { settings } = useSettings();
  const { platform } = useAccounts();
  const { i18n } = useTranslation();
  if (!settings.placePhotos || !platform.places || !item.geo || !item.location) return null;
  const { name } = nameAndAddress(item.location, item.placeLabel);
  // An address (a home, an office) is never sent: only a place with a name of its own (D220).
  if (isAddress(name)) return null;
  return {
    place: { name, geo: item.geo },
    lookup: lookupOf(platform.preferences),
    language: i18n.resolvedLanguage ?? i18n.language,
  };
}

/**
 * An item's place photo: what is known at once, and, once `wanted` (its
 * card nears the screen, its details open), asked for if it is not.
 * `undefined` while unknown, `null` for none.
 */
export function usePlacePhoto(
  item: Item,
  wanted: boolean,
  /** Whether a photo that arrives now may be drawn; else it waits for the next `attempt`. */
  welcome: () => boolean = () => true,
  /** Changes each time the photo is wanted again (its card came near). */
  attempt = 0,
): PlacePhoto | null | undefined {
  const asked = usePhotoPlace(item);
  const key =
    asked && `${asked.language}|${asked.place.name}|${asked.place.geo.lat},${asked.place.geo.lon}`;
  const [found, setFound] = useState<{ key: string | null; photo: PlacePhoto | null | undefined }>(
    () => ({ key, photo: asked?.lookup.known(asked.place, asked.language) }),
  );
  // Another place, or photos turned on or off: what is known of this one.
  if (found.key !== key) setFound({ key, photo: asked?.lookup.known(asked.place, asked.language) });
  const photo = found.key === key ? found.photo : undefined;
  useEffect(() => {
    if (!asked || !wanted || photo !== undefined) return;
    let live = true;
    asked.lookup.find(asked.place, asked.language).then(
      // A photo the card cannot take now (it is above the screen's top) is
      // kept and known at its next drawing; no "none" is noted for it.
      (answer) => live && (answer === null || welcome()) && setFound({ key, photo: answer }),
      // The service failed or the network is gone: the plain card, and asked again next time.
      () => live && setFound({ key, photo: null }),
    );
    return () => {
      live = false;
    };
    // `asked` is new each render; its key says what it is.
  }, [key, wanted, photo, attempt]);
  return asked ? photo : null;
}

/** "Photo: author, licence", each linked to its source, as Commons' licences ask (design D221). */
export function PhotoCredit({ photo, className = "" }: { photo: PlacePhoto; className?: string }) {
  const { t, i18n } = useTranslation();
  addPictureStrings(i18n);
  const link = "underline underline-offset-2";
  // The author's name links to the photo's page; with none named, the licence does.
  const licence = photo.licenceUrl ? (
    <a href={photo.licenceUrl} target="_blank" rel="noopener noreferrer license" className={link}>
      {photo.licence}
    </a>
  ) : (
    photo.licence
  );
  return (
    <p className={className}>
      {t("pictures.photoBy")}{" "}
      {photo.author !== null && (
        <>
          <a href={photo.source} target="_blank" rel="noopener noreferrer" className={link}>
            {photo.author}
          </a>
          {", "}
        </>
      )}
      {photo.author === null && !photo.licenceUrl ? (
        <a href={photo.source} target="_blank" rel="noopener noreferrer" className={link}>
          {photo.licence}
        </a>
      ) : (
        licence
      )}
      {" · "}
      <a href={photo.article} target="_blank" rel="noopener noreferrer" className={link}>
        {t("pictures.wikipedia")}
      </a>
    </p>
  );
}

/** A photo's credit in a line, for the Agenda's card: "© author" or its licence (design D221). */
export const creditLine = (photo: PlacePhoto) => `© ${photo.author ?? photo.licence}`;
