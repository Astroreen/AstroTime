// An item's own colour (docs/plans/foundation.md#D174): RFC 7986 `COLOR` is a
// CSS3 colour name, so an exact colour of AstroTime's is written as the
// nearest name with its hex in `X-ASTROTIME-COLOR`, read first while `COLOR`
// still names it.
import { expect, test } from "vite-plus/test";

import { CalendarObject, editItem } from "../src/index.ts";
import { nearestColorName } from "../src/colors.ts";
import { fixture } from "./support.ts";

const NOW = Date.parse("2026-11-04T08:40:00Z");
const colorOf = (ics: string) => CalendarObject.parse(ics).master?.color;

test("the nearest CSS3 name of a hex: itself for a named colour, the closest otherwise", () => {
  expect(nearestColorName("#ff6347")).toBe("tomato");
  expect(nearestColorName("#808080")).toBe("gray");
  expect(nearestColorName("#0ff")).toBe("aqua");
  expect(nearestColorName("#c48b9f")).toBe("rosybrown");
  expect(nearestColorName("#00585e")).toBe("darkslategray");
  expect(nearestColorName("#3F7BE0")).toBe("royalblue");
  expect(nearestColorName("tomato")).toBeNull();
});

test("a hex is written as its nearest name with the hex beside it, and read back exactly", () => {
  const source = fixture("nextcloud-web-event-timed.ics");
  const written = editItem(CalendarObject.parse(source), { color: "#C48B9F" }, { now: NOW }).ics;
  expect(written).toContain("COLOR:rosybrown\r\n");
  expect(written).toContain("X-ASTROTIME-COLOR:#c48b9f\r\n");
  expect(colorOf(written)).toBe("#c48b9f");
  // Everything else as it was: only the colour lines and the edit's stamps differ.
  const others = (ics: string) =>
    ics
      .split(/\r?\n/)
      .filter(
        (line) =>
          line !== "" &&
          !/^(COLOR|X-ASTROTIME-COLOR|DTSTAMP|LAST-MODIFIED|SEQUENCE)[:;]/.test(line),
      );
  expect(others(written)).toEqual(others(source));

  // A name of the palette drops the hex; none drops both.
  const named = editItem(CalendarObject.parse(written), { color: "tomato" }, { now: NOW }).ics;
  expect([named.includes("COLOR:tomato\r\n"), named.includes("X-ASTROTIME-COLOR")]).toEqual([
    true,
    false,
  ]);
  expect(colorOf(named)).toBe("tomato");
  const none = editItem(CalendarObject.parse(written), { color: null }, { now: NOW }).ics;
  expect(none).not.toContain("COLOR");
  expect(colorOf(none)).toBeNull();
});

test("another client's COLOR wins over a hex it no longer names; the hex stays in the file", () => {
  const written = editItem(
    CalendarObject.parse(fixture("nextcloud-web-event-timed.ics")),
    { color: "#c48b9f" },
    { now: NOW },
  ).ics;
  // Nextcloud, say, picks steelblue and leaves the property it does not know.
  const elsewhere = written.replace("COLOR:rosybrown\r\n", "COLOR:steelblue\r\n");
  expect(colorOf(elsewhere)).toBe("steelblue");
  expect(elsewhere).toContain("X-ASTROTIME-COLOR:#c48b9f\r\n");
  // A changed title keeps both lines as they were (foundation D7).
  const titled = editItem(
    CalendarObject.parse(elsewhere),
    { summary: "Renamed" },
    { now: NOW },
  ).ics;
  expect(titled).toContain("COLOR:steelblue\r\n");
  expect(titled).toContain("X-ASTROTIME-COLOR:#c48b9f\r\n");
  // Another case of the same name still names it.
  expect(colorOf(written.replace("COLOR:rosybrown", "COLOR:RosyBrown"))).toBe("#c48b9f");
});
