import { expect, test } from "vite-plus/test";

import { parseIanaNames, parseWindowsZones, renderModule } from "./generate-windows-zones.ts";

const XML = `<supplementalData><windowsZones><mapTimezones>
  <!-- (UTC+01:00) Amsterdam, Berlin -->
  <mapZone other="W. Europe Standard Time" territory="001" type="Europe/Berlin"/>
  <mapZone other="W. Europe Standard Time" territory="DE" type="Europe/Berlin Europe/Busingen"/>
  <mapZone other="Russian Standard Time" territory="RU" type="Europe/Moscow Europe/Kirov"/>
  <mapZone other="Russian Standard Time" territory="001" type="Europe/Moscow"/>
  <mapZone other="Kaliningrad Standard Time" territory="001" type="Europe/Kaliningrad Europe/Minsk"/>
</mapTimezones></windowsZones></supplementalData>`;

test("only the territory 001 row of each Windows zone is read, with its first IANA name", () => {
  expect(parseWindowsZones(XML)).toEqual({
    "W. Europe Standard Time": "Europe/Berlin",
    "Russian Standard Time": "Europe/Moscow",
    "Kaliningrad Standard Time": "Europe/Kaliningrad",
  });
});

test("the module lists the zones sorted, as a plain object", () => {
  const module = renderModule({ "B Time": "Europe/B", "A Time": "Europe/A" });
  expect(module).toContain('  "A Time": "Europe/A",\n  "B Time": "Europe/B",\n};');
  expect(module).toContain("node scripts/generate-windows-zones.ts");
});

test("an old CLDR spelling becomes IANA's current name", () => {
  const names = parseIanaNames(`<keyword><key name="tz">
    <type name="inccu" description="Kolkata, India" alias="Asia/Calcutta Asia/Kolkata" iana="Asia/Kolkata"/>
    <type name="deber" description="Berlin, Germany" alias="Europe/Berlin"/>
  </key></keyword>`);
  expect(names.get("Asia/Calcutta")).toBe("Asia/Kolkata");
  expect(names.has("Europe/Berlin")).toBe(false);
  const xml = `<mapZone other="India Standard Time" territory="001" type="Asia/Calcutta"/>
    <mapZone other="W. Europe Standard Time" territory="001" type="Europe/Berlin"/>`;
  expect(parseWindowsZones(xml, names)).toEqual({
    "India Standard Time": "Asia/Kolkata",
    "W. Europe Standard Time": "Europe/Berlin",
  });
});
