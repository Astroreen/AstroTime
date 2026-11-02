// The Agenda's illustrated cards (design D216): an item whose title has a
// theme's word (`themeOf`, D215) is drawn over its picture, taller than a
// plain card, its title and time in white over a scrim, its colour a band
// along the bottom. The picture is a file of its own, fetched as the card
// nears the screen and decoded off the main thread; the card's height does
// not wait for it. Loaded only with the Agenda (foundation D145).
import { useState, type CSSProperties } from "react";

import { DRAFT, type Entry } from "../calendar/query.ts";
import type { Art } from "../pictures/art.ts";
import { useCalendar } from "./context.ts";
import { CheckCircleIcon } from "./icons.tsx";
import { useItemArt } from "./item-picture.tsx";
import { AgendaCard, itemStyle, Opener, Title, useItemLabel, useItemTime } from "./items.tsx";

interface AgendaItemProps {
  readonly entry: Entry;
  readonly allDay: boolean;
  readonly part: { readonly index: number; readonly total: number } | null;
}

/** An item of the Agenda: over its picture when it has one, else the plain card. */
export function AgendaItem(props: AgendaItemProps) {
  const art = useItemArt(props.entry.occurrence.item.summary);
  return art ? <PictureCard {...props} art={art} /> : <AgendaCard {...props} />;
}

function PictureCard({ entry, allDay, part, art }: AgendaItemProps & { art: Art }) {
  const { t, colorOf } = useCalendar();
  const timeOf = useItemTime();
  const label = useItemLabel();
  const [shown, setShown] = useState(false);
  const time = part ? t("agenda.dayOf", part) : timeOf(entry, allDay);
  const task = entry.occurrence.item.kind === "task";
  const name = label(entry, allDay, time);
  return (
    <div
      role="listitem"
      data-draft={entry.objectId === DRAFT || undefined}
      aria-label={name}
      data-done={entry.done || undefined}
      className="item picture-card relative flex h-[6.5rem] items-end overflow-hidden rounded-[8px]"
      style={itemStyle(colorOf(entry), { "--ground": art.ground } as CSSProperties)}
    >
      <img
        src={art.url}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        data-shown={shown || undefined}
        onLoad={() => setShown(true)}
        className="absolute inset-y-0 right-0 h-full w-full max-w-[19.5rem] object-cover object-right"
      />
      <span aria-hidden="true" className="picture-scrim absolute inset-0" />
      <span className="relative flex min-w-0 flex-1 items-end gap-2 px-2.5 pt-2 pb-2.5">
        {task && <CheckCircleIcon className="mb-px size-4 shrink-0 self-start" />}
        <span className="picture-text flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex text-row leading-tight font-medium">
            <Title entry={entry} wrap={false} />
          </span>
          <span className="item-time truncate text-note leading-tight">{time}</span>
        </span>
      </span>
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-[var(--item-fill)]" />
      <Opener entry={entry} label={name} />
    </div>
  );
}
