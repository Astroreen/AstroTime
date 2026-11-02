// A description read as Markdown (design D207): the blocks and marks the
// details draw, and what is never a link or markup.
import { describe, expect, test } from "vite-plus/test";

import { linkOf, parseMarkdown, safeHref } from "../src/calendar/markdown.ts";

const paragraph = (...children: unknown[]) => ({ type: "paragraph", children });

describe("blocks", () => {
  test("paragraphs split by a blank line; a single line break stays one", () => {
    expect(parseMarkdown("Bring the slides\nand the notes.\n\nThen lunch.")).toEqual([
      paragraph("Bring the slides", { type: "break" }, "and the notes."),
      paragraph("Then lunch."),
    ]);
  });

  test("headings, a rule, a quote and a fenced code block", () => {
    expect(
      parseMarkdown("# Plan\n### Steps ###\n---\n> Bring *both*\n> copies\n\n```\na < b\n```"),
    ).toEqual([
      { type: "heading", level: 1, children: ["Plan"] },
      { type: "heading", level: 3, children: ["Steps"] },
      { type: "rule" },
      {
        type: "quote",
        children: [
          paragraph("Bring ", { type: "em", children: ["both"] }, { type: "break" }, "copies"),
        ],
      },
      { type: "code", text: "a < b" },
    ]);
  });

  test("a word after # with no space is no heading: #hashtag", () => {
    expect(parseMarkdown("#hashtag")).toEqual([paragraph("#hashtag")]);
  });

  test("lists: bullets, numbers from their start, nested, and checklists", () => {
    expect(parseMarkdown("- one\n- two\n  - two and a half\n\n3. third\n4. fourth")).toEqual([
      {
        type: "list",
        start: null,
        items: [
          { checked: null, children: [paragraph("one")] },
          {
            checked: null,
            children: [
              paragraph("two"),
              {
                type: "list",
                start: null,
                items: [{ checked: null, children: [paragraph("two and a half")] }],
              },
            ],
          },
        ],
      },
      {
        type: "list",
        start: 3,
        items: [
          { checked: null, children: [paragraph("third")] },
          { checked: null, children: [paragraph("fourth")] },
        ],
      },
    ]);
    expect(parseMarkdown("- [x] Tickets\n- [ ] Hotel\n* [X] Visa")).toEqual([
      {
        type: "list",
        start: null,
        items: [
          { checked: true, children: [paragraph("Tickets")] },
          { checked: false, children: [paragraph("Hotel")] },
          { checked: true, children: [paragraph("Visa")] },
        ],
      },
    ]);
  });

  test("Windows line ends read as line ends", () => {
    expect(parseMarkdown("a\r\nb")).toEqual([paragraph("a", { type: "break" }, "b")]);
  });

  test("quotes nested deeper than eight read as text, not as more quotes", () => {
    const deep = parseMarkdown(">".repeat(20) + " x");
    let depth = 0;
    let node = deep[0];
    while (node?.type === "quote") {
      depth++;
      node = node.children[0];
    }
    expect(depth).toBe(8);
  });
});

describe("marks", () => {
  test("strong, emphasis, struck text and code", () => {
    expect(parseMarkdown("**Bold** and *it* and _it_ and ~~gone~~ and `x * y`")).toEqual([
      paragraph(
        { type: "strong", children: ["Bold"] },
        " and ",
        { type: "em", children: ["it"] },
        " and ",
        { type: "em", children: ["it"] },
        " and ",
        { type: "del", children: ["gone"] },
        " and ",
        { type: "code", text: "x * y" },
      ),
    ]);
  });

  test("underscores inside a word and a lone star are text", () => {
    expect(parseMarkdown("snake_case_name and 2 * 3")).toEqual([
      paragraph("snake_case_name and 2 * 3"),
    ]);
  });

  test("a backslash keeps a mark as text", () => {
    expect(parseMarkdown("\\*not em\\*")).toEqual([paragraph("*not em*")]);
  });

  test("links: written, in angle brackets, bare; mail and phone too", () => {
    expect(
      parseMarkdown(
        "[Notes](https://example.com/notes) <https://example.com/a> see https://example.com/b. [Call](tel:+37060000000) [Mail](mailto:anna@example.com)",
      ),
    ).toEqual([
      paragraph(
        { type: "link", href: "https://example.com/notes", children: ["Notes"] },
        " ",
        { type: "link", href: "https://example.com/a", children: ["https://example.com/a"] },
        " see ",
        { type: "link", href: "https://example.com/b", children: ["https://example.com/b"] },
        ". ",
        { type: "link", href: "tel:+37060000000", children: ["Call"] },
        " ",
        { type: "link", href: "mailto:anna@example.com", children: ["Mail"] },
      ),
    ]);
  });
});

describe("safety", () => {
  test.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<b>x</b>",
    "vbscript:x",
    "file:///etc/passwd",
    "/relative",
  ])("%s is no link", (href) => {
    expect(safeHref(href)).toBeNull();
    const [first] = parseMarkdown(`[click](${href})`);
    expect(JSON.stringify(first)).not.toContain('"link"');
  });

  test("a link with a space in it is none as written; its first word may be a bare one", () => {
    expect(safeHref("https://example.com/a b")).toBeNull();
  });

  test("HTML stays text", () => {
    expect(parseMarkdown('<img src=x onerror="alert(1)"> <b>bold</b>')).toEqual([
      paragraph('<img src=x onerror="alert(1)"> <b>bold</b>'),
    ]);
  });

  test("no link inside a link's words", () => {
    expect(parseMarkdown("[https://a.example](https://b.example)")).toEqual([
      paragraph({ type: "link", href: "https://b.example", children: ["https://a.example"] }),
    ]);
  });

  test("a bare link ends before the marks around it", () => {
    expect(linkOf("https://example.com/x**")).toBe("https://example.com/x");
  });
});
