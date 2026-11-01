import { describe, expect, test } from "vite-plus/test";

import { linkOf } from "../src/components/item-details.tsx";

describe("a link in a description", () => {
  test.each([
    ["https://example.com/review.", "https://example.com/review"],
    ["https://example.com/review),", "https://example.com/review"],
    ["https://en.wikipedia.org/wiki/Foo_(bar)", "https://en.wikipedia.org/wiki/Foo_(bar)"],
    ["https://en.wikipedia.org/wiki/Foo_(bar)).", "https://en.wikipedia.org/wiki/Foo_(bar)"],
    ["https://example.com/a[1]]", "https://example.com/a[1]"],
    ["mailto:anna@example.com;", "mailto:anna@example.com"],
  ])("%s is %s", (found, url) => {
    expect(linkOf(found)).toBe(url);
  });
});
