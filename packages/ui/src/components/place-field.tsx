// The edit dialog's Location (docs/plans/design.md#D175): a text field that
// also searches places on the map as the user types, where the platform has
// a place search and the setting is on. A place picked is written with its
// point; text typed and not picked stays free text. Off, offline, or with
// the service failing, it is the plain text field it always was.
import type { Geo, Place } from "@astrotime/core";
import { placeText } from "@astrotime/core";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { photon, MIN_QUERY, type PlaceSearch } from "../places/photon.ts";
import { KEYS } from "../preferences.ts";
import { useSettings } from "../settings.ts";
import { useAccounts } from "./accounts-context.tsx";
import { PlaceIcon } from "./icons.tsx";

/** How long typing pauses before a search goes: one request per pause, not per letter. */
const PAUSE_MS = 350;

/** One search per Photon, so its answers are kept across the dialog's openings. */
const searches = new Map<string, PlaceSearch>();
const searchOf = (endpoint: string) => {
  let search = searches.get(endpoint);
  if (!search) searches.set(endpoint, (search = photon(endpoint)));
  return search;
};

export function PlaceField({
  value,
  geo,
  onChange,
  className,
}: {
  /** The field's text. */
  value: string;
  /** The item's own point, which the search prefers places near. */
  geo: Geo | null;
  /** The text typed, with the place when it was picked. */
  onChange: (text: string, place: Place | null) => void;
  className: string;
}) {
  const { t, i18n } = useTranslation();
  const { platform } = useAccounts();
  const { settings } = useSettings();
  const places = settings.places ? platform.places : undefined;
  const label = t("edit.location");
  if (!places) {
    return (
      <input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value, null)}
        className={className}
      />
    );
  }
  return (
    <Search
      search={searchOf(places.photon)}
      language={i18n.resolvedLanguage ?? i18n.language}
      near={geo ?? lastNear(platform.preferences.get(KEYS.placesNear))}
      value={value}
      onChange={onChange}
      onPick={(place) =>
        platform.preferences.set(
          KEYS.placesNear,
          JSON.stringify({ lat: +place.geo.lat.toFixed(1), lon: +place.geo.lon.toFixed(1) }),
        )
      }
      label={label}
      className={className}
    />
  );
}

/** The town of the last place picked, from what was stored; none when unreadable. */
function lastNear(stored: string | null): Geo | null {
  try {
    const value = JSON.parse(stored ?? "null") as Partial<Geo> | null;
    return typeof value?.lat === "number" && typeof value.lon === "number"
      ? { lat: value.lat, lon: value.lon }
      : null;
  } catch {
    return null;
  }
}

function Search({
  search,
  language,
  near,
  value,
  onChange,
  onPick,
  label,
  className,
}: {
  search: PlaceSearch;
  language: string;
  near: Geo | null;
  value: string;
  onChange: (text: string, place: Place | null) => void;
  onPick: (place: Place) => void;
  label: string;
  className: string;
}) {
  const { t } = useTranslation();
  const query = value.trim();
  const [found, setFound] = useState<{ query: string; places: readonly Place[] }>({
    query: "",
    places: [],
  });
  const [lat, lon] = [near?.lat, near?.lon];
  useEffect(() => {
    if (query.length < MIN_QUERY) return;
    // A request at a time: the one before is aborted when the text changes.
    const controller = new AbortController();
    const town = lat === undefined || lon === undefined ? null : { lat, lon };
    const timer = setTimeout(() => {
      search(query, { language, near: town, signal: controller.signal }).then(
        (places) => setFound({ query, places }),
        // Aborted, offline or refused: Location stays a text field.
        () => undefined,
      );
    }, PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, query, language, lat, lon]);
  // The last answer shows until the next one comes, as Google's suggestions do.
  const places = query.length < MIN_QUERY ? [] : found.places;
  const [open, setOpen] = useState(false);
  return (
    <Autocomplete.Root
      items={places}
      filter={null}
      // Open only with places to show: an open list, even an empty one,
      // takes the dialog's other fields from the accessibility tree.
      open={open && places.length > 0}
      onOpenChange={setOpen}
      value={value}
      itemToStringValue={placeText}
      onValueChange={(text, details) => {
        const place =
          details.reason === "item-press" ? places.find((p) => placeText(p) === text) : undefined;
        if (place) onPick(place);
        onChange(text, place ?? null);
      }}
    >
      <Autocomplete.Input aria-label={label} placeholder={label} className={className} />
      <Autocomplete.Portal>
        {/* Over the edit dialog (z 130). */}
        <Autocomplete.Positioner sideOffset={4} align="start" className="z-[140] outline-none">
          <Autocomplete.Popup className="max-h-[min(20rem,var(--available-height))] w-[var(--anchor-width)] overflow-y-auto overscroll-contain rounded-xl bg-raised py-1 text-ink shadow-xl ring-1 ring-line transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none">
            <Autocomplete.List aria-label={t("places.results")}>
              {(place: Place) => (
                <Autocomplete.Item
                  key={placeText(place)}
                  value={place}
                  className="flex min-h-12 cursor-pointer items-start gap-3 px-3 py-2 outline-none select-none data-highlighted:bg-raised-hover"
                >
                  <PlaceIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-muted" />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-row break-words">{place.name || place.address}</span>
                    {place.name && place.address && (
                      <span className="text-small break-words text-ink-muted">{place.address}</span>
                    )}
                  </span>
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
            <p className="px-3 pt-1 pb-1.5 text-note text-ink-muted">{t("places.credit")}</p>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
