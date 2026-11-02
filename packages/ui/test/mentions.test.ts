// What the details read as a mention (design D208): a link to an e-mail
// whose words are "@" and a name, as the edit dialog writes one.
import { expect, test } from "vite-plus/test";

import { mentionIn } from "../src/components/mention-chip.tsx";

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
