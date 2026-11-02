// What the details read as a mention (design D208): a link to an e-mail
// whose words are "@" and a name, as the edit dialog writes one.
import { expect, test } from "vite-plus/test";

import { parseMarkdown } from "../src/calendar/markdown.ts";
import { mentionIn } from "../src/components/mention-chip.tsx";
import { addressOf } from "../src/components/mention-field.tsx";

test("a mailto link named @Name is a mention, its address decoded", () => {
  expect(mentionIn("mailto:anna@example.com", ["@Anna Berg"])).toEqual({
    name: "Anna Berg",
    email: "anna@example.com",
  });
  expect(mentionIn("mailto:j%C3%BCrgen@example.com?subject=x", ["@Jürgen"])).toEqual({
    name: "Jürgen",
    email: "jürgen@example.com",
  });
});

test("any other link is a link", () => {
  expect(mentionIn("https://example.com", ["@Anna"])).toBeNull();
  expect(mentionIn("mailto:anna@example.com", ["Anna"])).toBeNull();
  expect(mentionIn("mailto:anna@example.com", ["@"])).toBeNull();
  expect(
    mentionIn("mailto:anna@example.com", ["@Anna ", { type: "em", children: ["B"] }]),
  ).toBeNull();
  expect(mentionIn("mailto:", ["@Anna"])).toBeNull();
});

test("an address that does not decode is read as written, not thrown on", () => {
  expect(mentionIn("mailto:50%off@example.com", ["@Shop"])).toEqual({
    name: "Shop",
    email: "50%off@example.com",
  });
});

test("an e-mail written as a link's address keeps the Markdown whole and reads back the same", () => {
  const email = 'odd (name) 100%"x"@example.com';
  const address = addressOf(email);
  expect(address).toBe("odd%20%28name%29%20100%25%22x%22@example.com");
  expect(addressOf("anna@example.com")).toBe("anna@example.com");
  const [paragraph] = parseMarkdown(`Ask [@Odd](mailto:${address}) now`);
  const link = (paragraph as unknown as { children: unknown[] }).children[1] as {
    href: string;
    children: unknown[];
  };
  expect(link.href).toBe(`mailto:${address}`);
  expect(mentionIn(link.href, link.children)).toEqual({ name: "Odd", email });
});
