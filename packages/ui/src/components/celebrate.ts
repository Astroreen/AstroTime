// A short burst of shapes from where the user completed a task (design
// D198): a few dots, squares and triangles of AstroTime's own, thrown out
// from the checkbox or the button and falling away, on a layer over
// everything that takes no press and that a screen reader does not see.
// Loaded with the first completion, not with the app (D145). Only
// `transform` and `opacity` move, with the Web Animations API (D154).

/** The shapes' colours: the theme's accent, then four that read on both themes. */
const COLORS = ["var(--color-accent)", "#f2b84b", "#e8708c", "#4fc59b", "#8f7ff2"];
const PIECES = 18;

export function celebrate(from: Element): void {
  const { left, top, width, height } = from.getBoundingClientRect();
  const x = left + width / 2;
  const y = top + height / 2;
  const layer = document.createElement("div");
  layer.dataset["celebration"] = "";
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    zIndex: "300",
    overflow: "hidden",
    pointerEvents: "none",
  });
  document.body.append(layer);
  const ends: Promise<unknown>[] = [];
  for (let index = 0; index < PIECES; index++) {
    const piece = document.createElement("span");
    const size = 6 + (index % 3) * 2;
    const shape = index % 3;
    Object.assign(piece.style, {
      position: "absolute",
      left: `${x - size / 2}px`,
      top: `${y - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      background: COLORS[index % COLORS.length],
      borderRadius: shape === 0 ? "50%" : "1px",
      clipPath: shape === 2 ? "polygon(50% 0, 100% 100%, 0 100%)" : "",
    });
    layer.append(piece);
    // All round, a little more upwards, each a little apart from the next.
    const angle = (index / PIECES) * 2 * Math.PI + Math.random() * 0.4;
    const reach = 40 + Math.random() * 40;
    const dx = Math.cos(angle) * reach;
    const dy = Math.sin(angle) * reach - 12;
    const turn = (Math.random() - 0.5) * 540;
    const flight = piece.animate(
      [
        { transform: "translate(0, 0) scale(0.3)", opacity: 1 },
        {
          transform: `translate(${dx}px, ${dy}px) scale(1) rotate(${turn / 2}deg)`,
          opacity: 1,
          offset: 0.5,
        },
        {
          transform: `translate(${dx * 1.15}px, ${dy + 30}px) scale(0.7) rotate(${turn}deg)`,
          opacity: 0,
        },
      ],
      { duration: 640 + Math.random() * 160, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
    );
    ends.push(flight.finished);
  }
  const gone = () => layer.remove();
  Promise.allSettled(ends).then(gone, gone);
}
