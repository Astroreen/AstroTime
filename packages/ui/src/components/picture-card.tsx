// The Agenda's illustrated cards (design D216): an item whose title has a
// subject's word (`subjectOf`, D215) is drawn over its picture, taller than a
// plain card (at least 104 px, more for a large text), its title (as the
// plain card's, up to two lines) and time in white over a scrim, its colour
// a band along the bottom. The picture is a file of its own, fetched as the card
// nears the screen and decoded off the main thread; the card's height does
// not wait for it. Loaded only with the Agenda (foundation D145).
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { DRAFT, type Entry } from "../calendar/query.ts";
import { useCalendar } from "./context.ts";
import { CheckCircleIcon } from "./icons.tsx";
import { backdropOf, useItemArt, type Backdrop } from "./item-picture.tsx";
import { usePlacePhoto } from "./place-photo.tsx";
import { AgendaCard, itemStyle, Opener, Title, useItemLabel, useItemTime } from "./items.tsx";

interface AgendaItemProps {
  readonly entry: Entry;
  readonly allDay: boolean;
  readonly part: { readonly index: number; readonly total: number } | null;
}

/**
 * An item of the Agenda: over its illustration when its title has one;
 * else over its place's photo (design D220), looked up once its card nears
 * the screen; else the plain card.
 */
export function AgendaItem(props: AgendaItemProps) {
  const item = props.entry.occurrence.item;
  const art = useItemArt(item.summary);
  const plain = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  // A photo that comes while the card is above the screen's top would push
  // what is on screen down: it waits for the card's next drawing, kept.
  const welcome = () => {
    const card = plain.current;
    const scroller = card?.closest("[data-agenda]")?.parentElement;
    return (
      !card || !scroller || card.getBoundingClientRect().top >= scroller.getBoundingClientRect().top
    );
  };
  const photo = usePlacePhoto(item, !art && near, welcome);
  const waiting = !art && photo === undefined;
  useEffect(() => {
    const card = plain.current;
    if (!waiting || near || !card || typeof IntersectionObserver !== "function") return;
    const scroller = card.closest("[data-agenda]")?.parentElement ?? null;
    const observer = new IntersectionObserver(
      (seen) => seen.some((entry) => entry.isIntersecting) && setNear(true),
      { root: scroller, rootMargin: "50% 0px" },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, [waiting, near]);
  if (art) return <PictureCard {...props} backdrop={backdropOf(art)} />;
  if (photo) return <PictureCard {...props} backdrop={backdropOf(photo)} />;
  return <AgendaCard {...props} ref={plain} />;
}

function PictureCard({ entry, allDay, part, backdrop }: AgendaItemProps & { backdrop: Backdrop }) {
  const { t, colorOf } = useCalendar();
  const timeOf = useItemTime();
  const label = useItemLabel();
  // Which picture has come: a title edited to another subject fades its new one in too.
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  const shown = shownUrl === backdrop.url;
  const time = part ? t("agenda.dayOf", part) : timeOf(entry, allDay);
  const task = entry.occurrence.item.kind === "task";
  const name = label(entry, allDay, time);
  return (
    <div
      role="listitem"
      data-draft={entry.objectId === DRAFT || undefined}
      aria-label={name}
      data-done={entry.done || undefined}
      data-photo={backdrop.photo || undefined}
      className="item picture-card relative flex min-h-[6.5rem] items-end overflow-hidden rounded-[8px]"
      style={itemStyle(colorOf(entry), { "--ground": backdrop.ground } as CSSProperties)}
    >
      <img
        src={backdrop.url}
        {...(backdrop.srcSet && {
          srcSet: backdrop.srcSet,
          sizes: "(min-width: 640px) 960px, 500px",
        })}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        data-shown={shown || undefined}
        onLoad={() => setShownUrl(backdrop.url)}
        className={`absolute inset-y-0 right-0 h-full w-full object-cover ${backdrop.photo ? "" : "max-w-[19.5rem] object-right"}`}
      />
      <span aria-hidden="true" className="picture-scrim absolute inset-0" />
      {/* A photo's author on the card as on its details, which credit it whole (D221). */}
      {backdrop.credit && (
        <span className="picture-text absolute top-1 right-2 max-w-[60%] truncate text-tiny text-white/90">
          {backdrop.credit}
        </span>
      )}
      <span className="relative flex min-w-0 flex-1 items-end gap-2 px-2.5 pt-2 pb-2.5">
        {task && <CheckCircleIcon className="mb-px size-4 shrink-0 self-start" />}
        <span className="picture-text flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body leading-tight font-medium">
            <Title entry={entry} wrap lines={2} />
          </span>
          <span className="item-time truncate text-note leading-tight">{time}</span>
        </span>
      </span>
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-[var(--item-fill)]" />
      <Opener entry={entry} label={name} />
    </div>
  );
}
