// What the details read as a mention (design D208): a link to an e-mail
// whose words are "@" and a name, as the edit dialog writes one.
import { expect, test } from "vite-plus/test";

import { parseMarkdown } from "../src/calendar/markdown.ts";
import { addressOf, mailtoOf, mentionIn } from "../src/components/mention-chip.tsx";
import { mentionOf } from "../src/components/mention-field.tsx";

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
  const email = 'odd (name) 100%"x"?#@example.com';
  const address = addressOf(email);
  expect(address).toBe("odd%20%28name%29%20100%25%22x%22%3F%23@example.com");
  expect(addressOf("anna@example.com")).toBe("anna@example.com");
  const [paragraph] = parseMarkdown(`Ask [@Odd](mailto:${address}) now`);
  const link = (paragraph as unknown as { children: unknown[] }).children[1] as {
    href: string;
    children: unknown[];
  };
  expect(link.href).toBe(`mailto:${address}`);
  expect(mentionIn(link.href, link.children)).toEqual({ name: "Odd", email });
});

test("a name with Markdown's marks is written escaped and reads back as it is", () => {
  const person = { name: "A*b_c `d` ~~e~~ <f> [g] \\h #1.", email: "a@example.com" };
  // What does not change a link's words is not escaped: it reads as typed in Nextcloud.
  expect(mentionOf({ name: "Anna-Marie O'Neil (Jr.) #2!", email: "a@example.com" })).toBe(
    "[@Anna-Marie O'Neil (Jr.) #2!](mailto:a@example.com)",
  );
  const [paragraph] = parseMarkdown(`Ask ${mentionOf(person)}`);
  const link = (paragraph as unknown as { children: unknown[] }).children[1] as {
    href: string;
    children: unknown[];
  };
  expect(link.children).toEqual([`@${person.name}`]);
  expect(mentionIn(link.href, link.children)).toEqual(person);
});

test("an address that decodes to a query adds no header: the chip's link re-encodes it", () => {
  const person = mentionIn("mailto:a%40x.com%3Fbcc%3Devil%40y.com", ["@A"]);
  expect(person).toEqual({ name: "A", email: "a@x.com?bcc=evil@y.com" });
  const href = mailtoOf(person!.email);
  expect(href).toBe("mailto:a@x.com%3Fbcc=evil@y.com");
  // As a mail client reads it: one address, no query.
  expect(new URL(href).search).toBe("");
  expect(mailtoOf("a@x.com#body")).toBe("mailto:a@x.com%23body");
});
