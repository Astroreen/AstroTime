// A place's point (foundation D176): read from GEO or Apple's structured
// location, written with a place picked on the map, gone with free text,
// kept by every edit that leaves the place alone.
import { describe, expect, test } from "vite-plus/test";

import {
  CalendarObject,
  createItem,
  editItem,
  placeText,
  zonedTime,
  type Place,
} from "../src/index.ts";
import { canonicalLine, contentLines, fixture } from "./support.ts";

const NOW = Date.parse("2026-11-04T08:40:00Z");

const GATE: Place = {
  name: "Brandenburg Gate",
  address: "Pariser Platz 1, 10117 Berlin, Germany",
  geo: { lat: 52.51622534, lon: 13.3777025 },
};

const event = (...lines: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "BEGIN:VEVENT",
    "UID:place",
    "DTSTAMP:20261001T000000Z",
    "DTSTART:20261110T100000Z",
    "DTEND:20261110T110000Z",
    "SUMMARY:Walk",
    ...lines,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

const master = (ics: string) => CalendarObject.parse(ics).master!;

describe("reading a place's point", () => {
  test("Apple's structured location, which Apple writes with no GEO", () => {
    const item = master(fixture("apple-event-attendees.ics"));
    expect(item.geo).toEqual({ lat: 37.334682, lon: -122.008944 });
  });

  test("GEO, latitude first", () => {
    expect(master(event("LOCATION:Somewhere", "GEO:37.386013;-122.082932")).geo).toEqual({
      lat: 37.386013,
      lon: -122.082932,
    });
  });

  test("none when another client changed the place and kept Apple's point of the old one", () => {
    const ics = event(
      "LOCATION:Room 7",
      "GEO:37.334682;-122.008944",
      'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-TITLE="Apple Park":geo:37.334682,-122.008944',
    );
    expect(master(ics).geo).toBeNull();
  });

  test("the name held case and spaces aside; a new place that holds the old name keeps its point", () => {
    const apple = (location: string) =>
      event(
        `LOCATION:${location}`,
        'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-TITLE="Cafe  Roma":geo:41.9,12.5',
      );
    // Re-cased or re-spaced by another client: still this place's point.
    expect(master(apple("CAFE ROMA\\, Via del Corso 1")).geo).toEqual({ lat: 41.9, lon: 12.5 });
    // The limit D176 names: a new text that holds the old name reads as the same place.
    expect(master(apple("Cafe Roma Nuovo")).geo).toEqual({ lat: 41.9, lon: 12.5 });
  });

  test("a lone GEO is trusted, even under a text another client changed (D176)", () => {
    // No client writes GEO without changing it with its text; AstroTime's own
    // places carry Apple's guard. Pinned, so a change here is a decision.
    expect(master(event("LOCATION:Somewhere else", "GEO:52.5;13.4")).geo).toEqual({
      lat: 52.5,
      lon: 13.4,
    });
  });

  test("0,0 is no point: some clients write it for none", () => {
    expect(master(event("LOCATION:Room 4", "GEO:0;0")).geo).toBeNull();
    expect(
      master(
        event("LOCATION:Room 4", "X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-TITLE=Room 4:geo:0,0"),
      ).geo,
    ).toBeNull();
  });

  test("a GEO another parser wrote as text is read as its two numbers", () => {
    expect(master(event("LOCATION:Somewhere", "GEO;VALUE=TEXT:37.5;-122.1")).geo).toEqual({
      lat: 37.5,
      lon: -122.1,
    });
  });

  test("Apple's geo: URI as RFC 5870 writes it: an altitude and parameters after the point", () => {
    const apple = (uri: string) =>
      master(
        event(
          "LOCATION:Apple Park",
          `X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-TITLE=Apple Park:${uri}`,
        ),
      ).geo;
    expect(apple("geo:52.5,13.4;u=10")).toEqual({ lat: 52.5, lon: 13.4 });
    expect(apple("geo:52.5,13.4,35")).toEqual({ lat: 52.5, lon: 13.4 });
    expect(apple("geo:52.5,13.4,35;crs=wgs84;u=10")).toEqual({ lat: 52.5, lon: 13.4 });
    expect(master(fixture("apple-event-attendees.ics")).geo).toEqual({
      lat: 37.334682,
      lon: -122.008944,
    });
  });

  test("GEO's parts are split at its semicolon alone: a decimal comma is no separator", () => {
    expect(master(event("LOCATION:Somewhere", "GEO;VALUE=TEXT:52,5;13,4")).geo).toBeNull();
  });

  test("a cut-off GEO is no point", () => {
    for (const value of ["52.5;", ";13.4", ";", "52.5"])
      expect(master(event("LOCATION:Somewhere", `GEO;VALUE=TEXT:${value}`)).geo, value).toBeNull();
    expect(
      master(event("LOCATION:Somewhere", "X-APPLE-STRUCTURED-LOCATION;VALUE=URI:geo:52.5,")).geo,
    ).toBeNull();
  });

  test("Apple's name never goes with a GEO read in its point's stead", () => {
    const item = master(
      event(
        "LOCATION:Apple Park",
        "GEO:37.3;-122",
        "X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-TITLE=Apple Park:geo:,",
      ),
    );
    expect([item.geo, item.placeLabel]).toEqual([{ lat: 37.3, lon: -122 }, null]);
  });

  test("Apple's name and address of the point, beside it", () => {
    expect(master(fixture("apple-event-attendees.ics")).placeLabel).toEqual({
      name: "Apple Park",
      address: "One Apple Park Way, Cupertino, CA 95014",
    });
    expect(master(event("LOCATION:Somewhere", "GEO:37.5;-122.1")).placeLabel).toBeNull();
  });

  test("none for a point off the globe, or none at all", () => {
    expect(master(event("LOCATION:Nowhere", "GEO:123;456")).geo).toBeNull();
    expect(master(event("LOCATION:Room 4")).geo).toBeNull();
  });
});

describe("writing a place", () => {
  test("a place picked: its text, GEO and Apple's structured location", () => {
    const { ics } = editItem(CalendarObject.parse(event()), { location: GATE }, { now: NOW });
    // Compared as meaning: ical.js writes parameters in its own order (D7).
    const place = contentLines(ics)
      .filter((line) => /^(LOCATION|GEO|X-APPLE-STRUCTURED-LOCATION)[:;]/.test(line))
      .map(canonicalLine);
    expect(place).toEqual([
      "LOCATION:Brandenburg Gate\\, Pariser Platz 1\\, 10117 Berlin\\, Germany",
      "GEO:52.516225;13.377703",
      "X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS=Pariser Platz 1, 10117 Berlin, Germany;X-APPLE-RADIUS=70;X-TITLE=Brandenburg Gate:geo:52.516225,13.377703",
    ]);
    expect(master(ics)).toMatchObject({
      location: "Brandenburg Gate, Pariser Platz 1, 10117 Berlin, Germany",
      geo: { lat: 52.516225, lon: 13.377703 },
    });
  });

  test("a quote and a newline in a geocoder's text: one line, the quote as RFC 6868's ^'", () => {
    const mill: Place = {
      name: 'The "Old"\nMill',
      address: "Mühlenweg 3,\r\n  12345 Dorf",
      geo: { lat: 52, lon: 13 },
    };
    const { ics } = editItem(CalendarObject.parse(event()), { location: mill }, { now: NOW });
    const apple = contentLines(ics).find((line) => line.startsWith("X-APPLE-STRUCTURED-LOCATION"));
    expect(apple).toContain(`X-TITLE=The ^'Old^' Mill;`);
    expect(apple).toContain(`X-ADDRESS="Mühlenweg 3, 12345 Dorf";`);
    // Read back: the same text, and the point still this place's.
    expect(master(ics)).toMatchObject({
      location: 'The "Old" Mill, Mühlenweg 3, 12345 Dorf',
      geo: { lat: 52, lon: 13 },
    });
  });

  test("a new item made on a place", () => {
    const ics = createItem(
      "event",
      {
        summary: "Walk",
        location: GATE,
        time: {
          start: zonedTime("2026-11-10T10:00:00", "Europe/Berlin"),
          end: zonedTime("2026-11-10T11:00:00", "Europe/Berlin"),
        },
      },
      { now: NOW, uid: "new" },
    );
    expect(master(ics).geo).toEqual({ lat: 52.516225, lon: 13.377703 });
  });

  test("free text typed over a place: the old point goes", () => {
    const placed = editItem(CalendarObject.parse(event()), { location: GATE }, { now: NOW }).ics;
    const { ics } = editItem(CalendarObject.parse(placed), { location: "Café" }, { now: NOW });
    expect(ics).not.toMatch(/^(GEO|X-APPLE-STRUCTURED-LOCATION)[:;]/m);
    expect(master(ics)).toMatchObject({ location: "Café", geo: null });
  });

  test("the same text written again is no change: the point and Apple's every parameter stay (D7)", () => {
    const source = fixture("apple-event-attendees.ics");
    const same = master(source).location!;
    const { ics } = editItem(CalendarObject.parse(source), { location: same }, { now: NOW });
    const place = (text: string) =>
      contentLines(text)
        .filter((line) => /^(LOCATION|GEO|X-APPLE-STRUCTURED-LOCATION)[:;]/.test(line))
        .map(canonicalLine);
    expect(place(ics)).toEqual(place(source));
    expect(place(ics).join()).toContain("X-APPLE-RADIUS=141.17");
  });

  test("a point off the globe is written as text alone", () => {
    for (const geo of [
      { lat: Number.NaN, lon: 13 },
      { lat: 91, lon: 13 },
      { lat: 52, lon: Number.POSITIVE_INFINITY },
    ]) {
      const { ics } = editItem(
        CalendarObject.parse(event()),
        { location: { ...GATE, geo } },
        { now: NOW },
      );
      expect(ics).not.toMatch(/^(GEO|X-APPLE-STRUCTURED-LOCATION)[:;]/m);
      expect(master(ics)).toMatchObject({ location: placeText(GATE), geo: null });
    }
  });

  test("a place with another client's text keeps that text, with its point", () => {
    const text = "Apple Park\nOne Apple Park Way\nCupertino";
    const park = {
      name: "Apple Park",
      address: "One Apple Park Way",
      geo: { lat: 37.3, lon: -122 },
    };
    const written = { text, name: park.name, address: park.address };
    const { ics } = editItem(
      CalendarObject.parse(event()),
      { location: { ...park, written } },
      { now: NOW },
    );
    expect(master(ics)).toMatchObject({ location: text, geo: { lat: 37.3, lon: -122 } });
    // A name or an address changed since makes "name, address" again: the old text never hides it.
    expect(placeText({ ...park, name: "Apple Park Visitor Center", written })).toBe(
      "Apple Park Visitor Center, One Apple Park Way",
    );
    expect(placeText({ ...park, address: "10600 N Tantau Ave", written })).toBe(
      "Apple Park, 10600 N Tantau Ave",
    );
  });

  test("the same place picked again is no change: Apple's every parameter stays (D7)", () => {
    const source = fixture("apple-event-attendees.ics");
    const { location, geo } = master(source);
    const same = {
      name: "Apple Park",
      address: "One Apple Park Way, Cupertino",
      geo: geo!,
      written: { text: location!, name: "Apple Park", address: "One Apple Park Way, Cupertino" },
    };
    const { ics } = editItem(CalendarObject.parse(source), { location: same }, { now: NOW });
    expect(contentLines(ics).join()).toContain("X-APPLE-RADIUS=141.17");
    // Its text on another point is a change.
    const moved = editItem(
      CalendarObject.parse(source),
      { location: { ...same, geo: { lat: 37.4, lon: -122 } } },
      { now: NOW },
    ).ics;
    expect(contentLines(moved).join()).not.toContain("X-APPLE-RADIUS=141.17");
    expect(master(moved).geo).toEqual({ lat: 37.4, lon: -122 });
  });

  test("the place removed: no LOCATION and no point", () => {
    const placed = editItem(CalendarObject.parse(event()), { location: GATE }, { now: NOW }).ics;
    const { ics } = editItem(CalendarObject.parse(placed), { location: "" }, { now: NOW });
    expect(ics).not.toMatch(/^(LOCATION|GEO|X-APPLE-STRUCTURED-LOCATION)[:;]/m);
  });

  test("an edit that leaves the place alone keeps every line of it in meaning (D7)", () => {
    const source = fixture("apple-event-attendees.ics");
    const { ics } = editItem(CalendarObject.parse(source), { summary: "Other" }, { now: NOW });
    // Against the fixture as Apple wrote it, parameters as a set: ical.js
    // writes Apple's `VALUE=URI` after `X-TITLE`, which means the same.
    const place = (text: string) =>
      contentLines(text)
        .filter((line) => /^(LOCATION|GEO|X-APPLE-STRUCTURED-LOCATION)[:;]/.test(line))
        .map(canonicalLine);
    expect(place(ics)).toEqual(place(source));
    expect(place(ics)).toHaveLength(2);
  });

  test("the text: name and address, the address alone when it begins with the name", () => {
    expect(placeText(GATE)).toBe("Brandenburg Gate, Pariser Platz 1, 10117 Berlin, Germany");
    expect(placeText({ ...GATE, name: "Pariser Platz 1" })).toBe(GATE.address);
    expect(placeText({ ...GATE, address: "" })).toBe("Brandenburg Gate");
  });
});
