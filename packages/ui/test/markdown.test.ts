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

describe("what the review found (design D207)", () => {
  test("a one-line ```code``` is inline code, not a fence that swallows the rest", () => {
    expect(parseMarkdown("Run ```npm i``` now\n\nThen this.")).toEqual([
      paragraph("Run ", { type: "code", text: "npm i" }, " now"),
      paragraph("Then this."),
    ]);
    expect(parseMarkdown("```npm i```\nnext")).toEqual([
      paragraph({ type: "code", text: "npm i" }, { type: "break" }, "next"),
    ]);
    // A fence closes only on its own character, as long or longer, alone.
    expect(parseMarkdown("````\n```\nstill code\n````\nafter")).toEqual([
      { type: "code", text: "```\nstill code" },
      paragraph("after"),
    ]);
  });

  test("a list nested by a tab keeps its marker: indents count and cut in columns", () => {
    const nested = {
      type: "list",
      start: null,
      items: [
        {
          checked: null,
          children: [
            paragraph("a"),
            { type: "list", start: null, items: [{ checked: null, children: [paragraph("sub")] }] },
          ],
        },
      ],
    };
    expect(parseMarkdown("- a\n\t- sub")).toEqual([nested]);
    expect(parseMarkdown("- a\n  - sub")).toEqual([nested]);
  });

  test("a written link's target keeps its balanced parentheses", () => {
    expect(parseMarkdown("[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) and (that)")).toEqual([
      paragraph(
        { type: "link", href: "https://en.wikipedia.org/wiki/Foo_(bar)", children: ["Foo"] },
        " and (that)",
      ),
    ]);
    expect(parseMarkdown('[a](<https://example.com/a_(b> "title")')).toEqual([
      paragraph({ type: "link", href: "https://example.com/a_(b", children: ["a"] }),
    ]);
  });

  test("***both*** is strong around emphasis; an escaped mark closes nothing", () => {
    expect(parseMarkdown("***both***")).toEqual([
      paragraph({ type: "strong", children: [{ type: "em", children: ["both"] }] }),
    ]);
    expect(parseMarkdown("*a\\* b*")).toEqual([paragraph({ type: "em", children: ["a* b"] })]);
  });

  test("only a bullet or a list from 1 cuts a paragraph short", () => {
    expect(parseMarkdown("A good year was\n2019. And 5) more")).toEqual([
      paragraph("A good year was", { type: "break" }, "2019. And 5) more"),
    ]);
    expect(parseMarkdown("Steps:\n1. one").map((b) => b.type)).toEqual(["paragraph", "list"]);
    // At a block's start any number begins a list, from that number.
    expect(parseMarkdown("2019. great")).toEqual([
      { type: "list", start: 2019, items: [{ checked: null, children: [paragraph("great")] }] },
    ]);
  });

  test("emphasis nested deeper than eight reads as text", () => {
    const deep = "*_".repeat(20) + "x" + "_*".repeat(20);
    expect(() => parseMarkdown(deep)).not.toThrow();
    let depth = 0;
    let node: unknown = (parseMarkdown(deep)[0] as unknown as { children: unknown[] }).children[0];
    while (node && typeof node === "object" && "children" in node) {
      depth++;
      node = (node as { children: unknown[] }).children[0];
    }
    expect(depth).toBeLessThanOrEqual(8);
  });
});

describe("untrusted text costs time in proportion to its length", () => {
  // Each of these took seconds when every opener scanned the rest of the
  // text for its closer; in proportion to their length they take a few
  // milliseconds. The ceiling is generous: nothing here waits for time.
  test.each([
    ["unclosed stars", "*a ".repeat(20_000)],
    ["unclosed underscores", "_a ".repeat(20_000)],
    ["stars alone", "*".repeat(60_000)],
    ["brackets", "[".repeat(60_000)],
    ["targets with no end", "[a](".repeat(15_000)],
    ["angle targets with no end", "[a](<".repeat(12_000)],
    [
      "backticks of every length",
      Array.from({ length: 300 }, (_, i) => "`".repeat(i + 1) + "a").join(" "),
    ],
    ["a long bare link of brackets", `https://example.com/${")".repeat(60_000)}`],
    ["a heading of spaces", `# ${" ".repeat(60_000)}x`],
  ])("%s", (_, text) => {
    const started = performance.now();
    parseMarkdown(text);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("random text (a seeded fuzz)", () => {
  const ALPHABET = [
    ..."*_~`[]()<>#->!\\ \t\n1.)xX:/",
    "javascript:",
    "https://",
    "mailto:",
    "tel:",
    "<script>",
    "data:",
    "```",
    "- [ ] ",
    "> ",
    "word",
  ];
  const KINDS = new Set(["paragraph", "heading", "code", "quote", "list", "rule"]);
  const MARKS = new Set(["strong", "em", "del", "code", "link", "break"]);

  /** Every node is one the details draw; every link one `safeHref` lets through. */
  function check(node: unknown): void {
    if (typeof node === "string") return;
    const n = node as {
      type?: string;
      href?: string;
      children?: unknown[];
      items?: { children: unknown[] }[];
    };
    if (n.type === undefined) {
      n.children?.forEach(check);
      return;
    }
    expect(KINDS.has(n.type) || MARKS.has(n.type)).toBe(true);
    if (n.type === "link") expect(safeHref(n.href!)).toBe(n.href);
    n.children?.forEach(check);
    n.items?.forEach((item) => item.children.forEach(check));
  }

  test("never throws, makes only known nodes and safe links, and finishes", () => {
    let seed = 20_261_102;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let run = 0; run < 3000; run++) {
      const length = Math.floor(random() * 80);
      const text = Array.from(
        { length },
        () => ALPHABET[Math.floor(random() * ALPHABET.length)]!,
      ).join("");
      parseMarkdown(text).forEach(check);
    }
  });
});
