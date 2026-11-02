// The place in an item's details (docs/plans/design.md#D177): a place with
// a point shows its name and address over a small map of OpenStreetMap's
// tiles with a pin, credited as OpenStreetMap asks; any place can be opened
// in maps and its address copied. A text with no point shows as it always
// did. The map loads only once the details show it, and not at all with
// places turned off.
import type { Geo } from "@astrotime/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { mapsLink, nameAndAddress, tilesAround } from "../places/map.ts";
import { useSettings } from "../settings.ts";
import { useAccounts } from "./accounts-context.tsx";
import { CheckIcon, CopyIcon, MapIcon } from "./icons.tsx";

/** The map's box, wider than any card: it is cut to the card's width, the pin in the middle. */
const BOX = { width: 512, height: 144 } as const;

const action =
  "inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-small font-medium text-accent ring-1 ring-line hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent";

/** How long "Copied" shows before the button says "Copy address" again. */
const COPIED_MS = 2000;

export function PlaceCard({
  location,
  geo,
  label,
  onCopyFailed,
}: {
  location: string;
  geo: Geo | null;
  /** Apple's name and address of the point, when it names them. */
  label: { readonly name: string; readonly address: string } | null;
  onCopyFailed: () => void;
}) {
  const { t } = useTranslation();
  const { platform } = useAccounts();
  const { settings } = useSettings();
  const places = settings.places ? platform.places : undefined;
  const [copied, setCopied] = useState(false);
  // Only a place with a point is split: free text shows whole, commas and all.
  const { name, address } = geo ? nameAndAddress(location, label) : { name: location, address: "" };
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  // No clipboard to write to (an insecure page, some WebViews): no button.
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  const copy = () =>
    void clipboard?.writeText(location).then(
      () => setCopied(true),
      // Refused (a permission, a page out of focus): the notice says so.
      () => onCopyFailed(),
    );
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-col">
        <span className="break-words whitespace-pre-wrap">{name}</span>
        {address && <span className="break-words text-small text-ink-muted">{address}</span>}
      </p>
      {geo && places && (
        <StaticMap geo={geo} tiles={places.tiles} label={t("places.map", { place: name })} />
      )}
      <div className="flex flex-wrap gap-2">
        <a
          href={mapsLink(location, geo, places?.links ?? "web")}
          target="_blank"
          rel="noopener noreferrer"
          className={action}
        >
          <MapIcon className="size-[18px]" />
          {t("places.open")}
        </a>
        {clipboard && (
          <button type="button" onClick={copy} className={action}>
            {copied ? <CheckIcon className="size-[18px]" /> : <CopyIcon className="size-[18px]" />}
            {t(copied ? "places.copied" : "places.copy")}
          </button>
        )}
      </div>
    </div>
  );
}

function StaticMap({ geo, tiles, label }: { geo: Geo; tiles: string; label: string }) {
  const { t } = useTranslation();
  return (
    <div className="relative h-36 overflow-hidden rounded-xl bg-canvas ring-1 ring-line">
      <div
        role="img"
        aria-label={label}
        className="absolute top-0 left-1/2 -translate-x-1/2"
        style={{ width: BOX.width, height: BOX.height }}
      >
        {tilesAround(geo, BOX.width, BOX.height, tiles).map((tile) => (
          <img
            key={tile.src}
            src={tile.src}
            alt=""
            width={256}
            height={256}
            loading="lazy"
            decoding="async"
            draggable={false}
            // The page sends no Referer elsewhere (foundation D110); OpenStreetMap's tile policy asks for one.
            referrerPolicy="strict-origin-when-cross-origin"
            // Offline, a tile that does not come leaves the map's ground, not a broken image.
            onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            className="absolute max-w-none select-none"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 32"
          width="28"
          height="37"
          className="absolute drop-shadow"
          style={{ left: BOX.width / 2 - 14, top: BOX.height / 2 - 37 }}
        >
          <path
            d="M12 31s10-11.2 10-19A10 10 0 0 0 2 12c0 7.8 10 19 10 19z"
            fill="#d93025"
            stroke="#fff"
            strokeWidth="1.5"
          />
          <circle cx="12" cy="12" r="3.6" fill="#fff" />
        </svg>
      </div>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-0 bottom-0 rounded-tl-md bg-white/85 px-1.5 py-0.5 text-[0.6875rem] leading-4 text-[#1b1e25] hover:underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {t("places.attribution")}
      </a>
    </div>
  );
}
