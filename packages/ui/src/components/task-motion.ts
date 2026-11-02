// How the tasks screen moves when its tasks change (design D197): each row
// and card is measured before the change is drawn and slides from where it
// was to where it is (FLIP: only `transform` and `opacity` move, with the Web
// Animations API, so no frame lays the page out again). A row that left the
// list shown (completed while "Completed" is folded, deleted, moved to
// another list) goes on drawn where it was, over the list, and leaves toward
// "Completed" or fades; a new row comes in from above. Loaded with the tasks
// screen's first showing, not with the app (D145); never with
// `prefers-reduced-motion`.
/** The Pager's `SLIDE`, Material's standard easing (design D154), not imported so the Pager stays out of this chunk. */
const SLIDE = "cubic-bezier(0.2, 0, 0, 1)";

/** Milliseconds a move takes, and a row that leaves. */
const MOVE_MS = 280;
const LEAVE_MS = 320;
/** More moves than this at once (a sync's batch, a sort) are drawn in place. */
const AT_MOST = 40;

interface Measured {
  readonly rect: DOMRect;
  /** The row's own element: drawn on after it left, it leaves from where it was. */
  readonly element: HTMLElement;
}

/** The tasks shown, as they were before a change. */
export interface Snapshot {
  /** Rows by `data-task`. */
  readonly rows: ReadonlyMap<string, Measured>;
  /** Cards by `data-card`. */
  readonly cards: ReadonlyMap<string, DOMRect>;
  /** "Completed"'s count as it read. */
  readonly count: string | null;
}

const ROW = "[data-task]";
const LAYER = "[data-motion-layer]";
const CARD = "[data-card]";
const COUNT = "[data-completed-count]";

/**
 * The rows in the list, not those leaving on the layer: a row that left
 * goes on leaving through the next change, never measured or moved again.
 */
const rowsOf = (root: HTMLElement) =>
  [...shown(root).querySelectorAll<HTMLElement>(ROW)].filter((row) => !row.closest(LAYER));

/**
 * The list shown: on a touch screen the lists beside it are drawn too
 * (design D199), inert, with rows of their own that never move here.
 */
const shown = (root: HTMLElement): HTMLElement =>
  root.querySelector<HTMLElement>("[data-current]") ?? root;

/** Where each row and card of `root` is now. */
export function measure(root: HTMLElement): Snapshot {
  const rows = new Map<string, Measured>();
  for (const element of rowsOf(root)) {
    rows.set(element.dataset["task"]!, { rect: element.getBoundingClientRect(), element });
  }
  const cards = new Map<string, DOMRect>();
  for (const element of shown(root).querySelectorAll<HTMLElement>(CARD)) {
    cards.set(element.dataset["card"]!, element.getBoundingClientRect());
  }
  return { rows, cards, count: shown(root).querySelector(COUNT)?.textContent ?? null };
}

/**
 * Moves what `root` draws now from where `before` saw it. `hold`: the
 * milliseconds everything waits first, so a tick the user drew shows before
 * its row moves.
 */
export function play(
  root: HTMLElement,
  before: Snapshot,
  hold: number,
  /** The tasks done now: only a row of these that left goes toward "Completed". */
  done: ReadonlySet<string>,
): void {
  const timing: KeyframeAnimationOptions = {
    duration: MOVE_MS,
    easing: SLIDE,
    delay: hold,
    fill: "backwards",
  };
  const slide = (element: Element, frames: Keyframe[], options = timing) =>
    element.animate(frames, options);
  const rows = rowsOf(root);
  const cards = [...shown(root).querySelectorAll<HTMLElement>(CARD)];
  // Where everything is now, measured before anything moves: a move still
  // running ends here (`before` saw it where it was drawn), and a card's own
  // move must not count in its rows'.
  for (const element of [
    ...rows,
    ...cards,
    ...shown(root).querySelectorAll(`${COUNT}, [data-card-background]`),
  ]) {
    for (const running of element.getAnimations()) running.cancel();
  }
  const rects = new Map<Element, DOMRect>();
  for (const element of [...rows, ...cards]) rects.set(element, element.getBoundingClientRect());
  const moved = rows.filter((element) => {
    const was = before.rows.get(element.dataset["task"]!);
    return !was || was.rect.top !== rects.get(element)!.top;
  });
  if (moved.length > AT_MOST) return;

  // A card slides as a whole, its background stretched from the height it
  // had; its rows slide by what is left of their own move.
  const shift = new Map<Element, number>();
  for (const card of cards) {
    const was = before.cards.get(card.dataset["card"]!);
    const now = rects.get(card)!;
    if (!was) {
      if (before.rows.size > 0) slide(card, [{ opacity: 0 }, { opacity: 1 }]);
      continue;
    }
    const dy = was.top - now.top;
    shift.set(card, dy);
    if (Math.abs(dy) >= 0.5) {
      slide(card, [{ transform: `translateY(${dy}px)` }, { transform: "none" }]);
    }
    const background = card.querySelector(":scope > [data-card-background]");
    if (background && now.height > 0 && Math.abs(was.height - now.height) >= 0.5) {
      slide(background, [
        { transform: `scaleY(${was.height / now.height})` },
        { transform: "none" },
      ]);
    }
  }
  for (const element of rows) {
    const was = before.rows.get(element.dataset["task"]!);
    const now = rects.get(element)!;
    if (!was) {
      // A new row comes in from above, unless the whole list is new.
      if (before.rows.size > 0) {
        slide(element, [
          { transform: "translateY(-8px)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ]);
      }
      continue;
    }
    const dx = was.rect.left - now.left;
    const dy = was.rect.top - now.top - (shift.get(element.closest(CARD)!) ?? 0);
    if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
      slide(element, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }]);
    }
  }

  // Rows that left: drawn on over the list where they were, a task now done
  // leaves toward "Completed", any other (deleted, moved) fades where it is.
  const layer = root.querySelector<HTMLElement>(LAYER);
  const count = shown(root).querySelector<HTMLElement>(COUNT);
  const counted = Number(count?.textContent ?? 0);
  const rose = counted > Number(before.count ?? 0);
  const room = root.getBoundingClientRect();
  const toward = count?.closest("button")?.getBoundingClientRect() ?? null;
  for (const [key, was] of before.rows) {
    if (!layer || was.element.isConnected || rows.some((row) => row.dataset["task"] === key)) {
      continue;
    }
    const ghost = was.element;
    Object.assign(ghost.style, {
      position: "absolute",
      left: `${was.rect.left - room.left}px`,
      top: `${was.rect.top - room.top}px`,
      width: `${was.rect.width}px`,
      margin: "0",
    });
    layer.append(ghost);
    const dy =
      done.has(key) && toward
        ? toward.top + toward.height / 2 - (was.rect.top + was.rect.height / 2)
        : 0;
    const leave = slide(
      ghost,
      // Gone before it reaches the count, so it crosses the rows faintly.
      [
        { transform: "none", opacity: 1 },
        { opacity: 0, offset: 0.45 },
        { transform: `translateY(${dy}px) scale(0.96)`, opacity: 0 },
      ],
      { ...timing, duration: LEAVE_MS, fill: "both" },
    );
    const gone = () => ghost.remove();
    leave.finished.then(gone, gone);
  }
  // "Completed"'s count ticks over to its new number.
  if (count && before.count !== null && counted !== Number(before.count)) {
    const up = rose ? 1 : -1;
    slide(
      count,
      [
        { transform: `translateY(${up * 60}%)`, opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { ...timing, delay: 0 },
    );
  }
}
