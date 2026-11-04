// The place in an item's details (docs/plans/design.md#D177): a place with
// a point shows its name and address over a small map of OpenStreetMap's
// tiles with a pin, credited as OpenStreetMap asks; any place can be opened
// in maps and its address copied, by two icon buttons at the end of its
// line (design D238), or by a tap on the map and on the address. A text
// with no point shows as it always did. The map loads only once the
// details show it, and not at all with places turned off.
import type { Geo } from "@astrotime/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { mapsLink, nameAndAddress, tilesAround } from "../places/map.ts";
import { useSettings } from "../settings.ts";
import { useAccounts } from "./accounts-context.tsx";
import { CheckIcon, CopyIcon, MapIcon } from "./icons.tsx";

/** The map's box, wider than any card: it is cut to the card's width, the pin in the middle. */
const BOX = { width: 512, height: 144 } as const;

/** An icon button at the end of the place's line: 48 px, a finger's target (Material's 48 dp). */
const action =
  "grid size-12 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-raised-hover hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-accent";

/** How long the tick shows after a copy. */
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
  // Copies made, each said once (design D238); 0 when the tick is gone.
  const [copied, setCopied] = useState(0);
  // Only a place with a point is split: free text shows whole, commas and all.
  const { name, address } = geo ? nameAndAddress(location, label) : { name: location, address: "" };
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(0), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  // No clipboard to write to (an insecure page, some WebViews): no button.
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  const copy = () =>
    void clipboard?.writeText(location).then(
      () => setCopied((count) => count + 1),
      // Refused (a permission, a page out of focus): the notice says so.
      () => onCopyFailed(),
    );
  const link = mapsLink(location, geo, places?.links ?? "web");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start">
        {/* Its first line level with the icons' middle; a tap on it copies
            the address, a long press or a drag selects as text does (design
            D238). Keys and screen readers have the button at the end. */}
        <div
          className={`min-w-0 flex-1 pt-3 ${clipboard ? "cursor-copy" : ""}`}
          onClick={() => {
            if (document.getSelection()?.isCollapsed !== false) copy();
          }}
        >
          <p className="flex flex-col">
            <span className="break-words whitespace-pre-wrap">{name}</span>
            {address && <span className="break-words text-small text-ink-muted">{address}</span>}
          </p>
        </div>
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("places.open")}
          title={t("places.open")}
          className={action}
        >
          <MapIcon className="size-5" />
        </a>
        {clipboard && (
          <button
            type="button"
            onClick={copy}
            aria-label={t("places.copy")}
            title={t("places.copy")}
            className={`${action} ${copied ? "text-accent" : ""}`}
          >
            {copied ? <CheckIcon className="size-5" /> : <CopyIcon className="size-5" />}
          </button>
        )}
      </div>
      {geo && places && (
        <StaticMap
          geo={geo}
          tiles={places.tiles}
          label={t("places.map", { place: name })}
          link={link}
        />
      )}
      {/* "Copied", said once for each copy: each a node of its own. */}
      <span role="status" className="sr-only">
        {copied > 0 && <span key={copied}>{t("places.copied")}</span>}
      </span>
    </div>
  );
}

function StaticMap({
  geo,
  tiles,
  label,
  link,
}: {
  geo: Geo;
  tiles: string;
  label: string;
  /** Where a tap on the map goes: maps, as "Open in maps" does (design D238). */
  link: string;
}) {
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
      {/* The whole map opens maps; the button by the address is its name for keys and screen readers. */}
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0"
      />
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
