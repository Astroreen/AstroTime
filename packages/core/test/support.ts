import { readFileSync } from "node:fs";

import { CalendarObject } from "../src/index.ts";

export const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

export const load = (name: string) => CalendarObject.parse(fixture(name));
