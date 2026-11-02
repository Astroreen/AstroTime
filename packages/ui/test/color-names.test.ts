// A colour's generated name (design D170): its hue's family and one
// modifier, in English and Russian, the same for the same colour.
import { expect, test } from "vite-plus/test";

import { colorName } from "../src/calendar/color-names.ts";

const both = (hex: string) => [colorName(hex, "en"), colorName(hex, "ru")];

test("a hue's family with one modifier, in both languages", () => {
  expect(both("#c48b9f")).toEqual(["Dusty rose", "Пыльно-розовый"]);
  expect(both("#00585e")).toEqual(["Deep teal", "Глубокий бирюзовый"]);
  expect(both("#000080")).toEqual(["Dark blue", "Тёмно-синий"]);
  expect(both("#ff0000")).toEqual(["Bright red", "Ярко-красный"]);
  expect(both("#ffc0cb")).toEqual(["Pale rose", "Бледно-розовый"]);
  expect(both("#20b2aa")).toEqual(["Teal", "Бирюзовый"]);
  expect(both("#663399")).toEqual(["Violet", "Фиолетовый"]);
});

test("dark oranges are brown, dark yellows olive, light reds pink, soft light oranges beige", () => {
  expect(both("#8b4513")).toEqual(["Brown", "Коричневый"]);
  expect(both("#808000")).toEqual(["Olive", "Оливковый"]);
  expect(both("#f08080")).toEqual(["Pink", "Розовый"]);
  expect(both("#d2b48c")).toEqual(["Beige", "Бежевый"]);
});

test("greys, black and white by lightness alone", () => {
  expect(both("#808080")).toEqual(["Grey", "Серый"]);
  expect(both("#3c4043")).toEqual(["Dark grey", "Тёмно-серый"]);
  expect(both("#d3d3d3")).toEqual(["Light grey", "Светло-серый"]);
  expect(both("#000")).toEqual(["Black", "Чёрный"]);
  expect(both("#ffffff")).toEqual(["White", "Белый"]);
});

test("the same colour, the same name, in any case or form; no name for what is no hex", () => {
  expect(colorName("#C48B9F", "en")).toBe(colorName("c48b9f", "en"));
  expect(colorName("#0ff", "en")).toBe(colorName("#00ffff", "en"));
  expect(colorName("tomato", "en")).toBeNull();
  expect(colorName("#12345", "ru")).toBeNull();
});

test("every hue around the wheel has a name, never the hex", () => {
  const names = new Set<string>();
  for (let i = 0; i < 360; i += 10) {
    const r = Math.round(127 + 127 * Math.cos((i * Math.PI) / 180));
    const g = Math.round(127 + 127 * Math.cos(((i - 120) * Math.PI) / 180));
    const b = Math.round(127 + 127 * Math.cos(((i + 120) * Math.PI) / 180));
    const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    const name = colorName(hex, "ru")!;
    expect(name).toMatch(/^[А-ЯЁ][а-яё -]+$/);
    names.add(colorName(hex, "en")!);
  }
  expect(names.size).toBeGreaterThan(10);
});
