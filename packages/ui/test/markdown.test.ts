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

  test("a bare link ends before a mark only where it closes emphasis opened before it", () => {
    expect(linkOf("https://example.com/x**", "*")).toBe("https://example.com/x");
    expect(linkOf("https://example.com/a_")).toBe("https://example.com/a_");
    expect(linkOf("https://example.com/a_~", "~")).toBe("https://example.com/a_");
    expect(parseMarkdown("see https://example.com/a_ now")).toEqual([
      paragraph(
        "see ",
        { type: "link", href: "https://example.com/a_", children: ["https://example.com/a_"] },
        " now",
      ),
    ]);
    expect(parseMarkdown("_see https://example.com/a_")).toEqual([
      paragraph({
        type: "em",
        children: [
          "see ",
          { type: "link", href: "https://example.com/a", children: ["https://example.com/a"] },
        ],
      }),
    ]);
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

  test("a rule right after a list item ends the list; it is no nested item", () => {
    const list = {
      type: "list",
      start: null,
      items: [{ checked: null, children: [paragraph("a")] }],
    };
    for (const rule of ["* * *", "- - -", "---", "***"]) {
      expect(parseMarkdown(`- a\n${rule}\nafter`)).toEqual([
        list,
        { type: "rule" },
        paragraph("after"),
      ]);
    }
  });

  test("an image is read as a link to it, named by its words; no picture is loaded", () => {
    expect(parseMarkdown("Map: ![The square](https://example.com/map.png)")).toEqual([
      paragraph("Map: ", {
        type: "link",
        href: "https://example.com/map.png",
        children: ["The square"],
      }),
    ]);
    expect(parseMarkdown("![x](javascript:alert(1))")).toEqual([paragraph("x")]);
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

describe("untrusted text costs work in proportion to its length", () => {
  // Each of these took seconds when every opener scanned the rest of the
  // text for its closer. The parser counts its steps (`ParseStats`): twice the
  // text costs about twice the steps, not four times. No clock is read.
  const stepsOf = (text: string) => {
    const stats = { steps: 0 };
    parseMarkdown(text, stats);
    return stats.steps;
  };
  test.each([
    ["unclosed stars", (n: number) => "*a ".repeat(n)],
    ["unclosed underscores", (n: number) => "_a ".repeat(n)],
    ["stars alone", (n: number) => "*".repeat(n)],
    ["brackets", (n: number) => "[".repeat(n)],
    ["targets with no end", (n: number) => "[a](".repeat(n)],
    ["angle targets with no end", (n: number) => "[a](<".repeat(n)],
    ["images with no end", (n: number) => "![a](".repeat(n)],
    ["a long bare link of brackets", (n: number) => `https://example.com/${")".repeat(n)}`],
    ["bare links with marks", (n: number) => "*x https://e.com/a_ ".repeat(n)],
    ["a heading of spaces", (n: number) => `# ${" ".repeat(n)}x`],
    ["nested lists", (n: number) => "- a\n  - b\n".repeat(n)],
  ])("%s", (_, make) => {
    const once = stepsOf(make(5000));
    const twice = stepsOf(make(10_000));
    expect(twice / once).toBeLessThan(2.5);
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

describe("after #94's review (design D207)", () => {
  test("a plain description keeps its spaces and indents inside a paragraph", () => {
    expect(parseMarkdown("Room:   4\n  second floor   ")).toEqual([
      paragraph("Room:   4", { type: "break" }, "  second floor"),
    ]);
  });

  test("a code span wins over emphasis; a mark inside a bare link closes nothing", () => {
    expect(parseMarkdown("*foo `a*` bar*")).toEqual([
      paragraph({ type: "em", children: ["foo ", { type: "code", text: "a*" }, " bar"] }),
    ]);
    expect(parseMarkdown("*see https://example.com/a*b now*")).toEqual([
      paragraph({
        type: "em",
        children: [
          "see ",
          { type: "link", href: "https://example.com/a*b", children: ["https://example.com/a*b"] },
          " now",
        ],
      }),
    ]);
  });

  test("a tab inside fenced code stays a tab, at the top and in a list", () => {
    expect(parseMarkdown("```\n\tindented\ta\n```")).toEqual([
      { type: "code", text: "\tindented\ta" },
    ]);
    const [list] = parseMarkdown("- a\n  ```\n  \tx\n  ```");
    expect(JSON.stringify(list)).toContain('"text":"\\tx"');
  });

  test("an empty heading is text, not an empty heading", () => {
    expect(parseMarkdown("#")).toEqual([paragraph("#")]);
    expect(parseMarkdown("## ##")).toEqual([paragraph("## ##")]);
    expect(parseMarkdown("Total\n#")).toEqual([paragraph("Total", { type: "break" }, "#")]);
  });
});

describe("after #94's last review (design D207)", () => {
  test("each parse counts its own steps", () => {
    const first = { steps: 0 };
    const second = { steps: 0 };
    parseMarkdown("*a* b", first);
    parseMarkdown("*a* b", second);
    expect(first.steps).toBeGreaterThan(0);
    expect(second.steps).toBe(first.steps);
  });

  test("an empty item does not take the next line in as its own", () => {
    expect(parseMarkdown("-\nnext")).toEqual([
      { type: "list", start: null, items: [{ checked: null, children: [] }] },
      paragraph("next"),
    ]);
    expect(parseMarkdown("- a\nlazy")).toEqual([
      {
        type: "list",
        start: null,
        items: [{ checked: null, children: [paragraph("a", { type: "break" }, "lazy")] }],
      },
    ]);
  });
});

describe("after #94's low review (design D207)", () => {
  test("a link or image with no words is named by its address", () => {
    expect(parseMarkdown("[](https://example.com/a) ![](https://example.com/b.png)")).toEqual([
      paragraph(
        { type: "link", href: "https://example.com/a", children: ["https://example.com/a"] },
        " ",
        {
          type: "link",
          href: "https://example.com/b.png",
          children: ["https://example.com/b.png"],
        },
      ),
    ]);
  });

  test("a written target's escapes are taken out", () => {
    expect(parseMarkdown("[a](https://example.com/a\\)b)")).toEqual([
      paragraph({ type: "link", href: "https://example.com/a)b", children: ["a"] }),
    ]);
  });
});
