// A description read as Markdown (docs/plans/design.md#D207): paragraphs and
// line breaks, emphasis, lists and checklists, headings, links, code and
// quotes, as a tree the details draw as React elements. No HTML is read or
// made: a tag in the text stays text. A link is one only to http(s), mailto
// or tel. The text itself is never changed (foundation D7).

export type Inline =
  | string
  | { readonly type: "strong" | "em" | "del"; readonly children: readonly Inline[] }
  | { readonly type: "code"; readonly text: string }
  | { readonly type: "link"; readonly href: string; readonly children: readonly Inline[] }
  | { readonly type: "break" };

export interface ListItem {
  /** A checklist's box: `null` for a plain item. */
  readonly checked: boolean | null;
  readonly children: readonly Block[];
}

export type Block =
  | { readonly type: "paragraph"; readonly children: readonly Inline[] }
  | { readonly type: "heading"; readonly level: number; readonly children: readonly Inline[] }
  | { readonly type: "code"; readonly text: string }
  | { readonly type: "quote"; readonly children: readonly Block[] }
  | {
      readonly type: "list";
      /** The first number of an ordered list; `null` for bullets. */
      readonly start: number | null;
      readonly items: readonly ListItem[];
    }
  | { readonly type: "rule" };

/** How deep quotes and lists nest before the rest reads as text. */
const DEEPEST = 8;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const BLANK = /^[ \t]*$/;

/** The description as blocks. */
export function parseMarkdown(text: string): readonly Block[] {
  return blocks(text.replace(/\r\n?/g, "\n").split("\n"), 0);
}

const starts = (line: string) =>
  FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line);

function blocks(lines: readonly string[], depth: number): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (BLANK.test(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(mark)) body.push(lines[i++]!);
      i++;
      out.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ type: "heading", level: heading[1]!.length, children: inline(heading[2] ?? "") });
      i++;
      continue;
    }
    // A rule before a list: "- - -" and "* * *" are rules.
    if (RULE.test(line)) {
      out.push({ type: "rule" });
      i++;
      continue;
    }
    if (depth < DEEPEST && QUOTE.test(line)) {
      const body: string[] = [];
      // The quote's lines, and those that carry its paragraph on (lazy lines).
      while (i < lines.length && !BLANK.test(lines[i]!)) {
        const next = lines[i]!;
        if (QUOTE.test(next)) body.push(next.replace(QUOTE, ""));
        else if (starts(next)) break;
        else body.push(next);
        i++;
      }
      out.push({ type: "quote", children: blocks(body, depth + 1) });
      continue;
    }
    if (depth < DEEPEST && ITEM.test(line)) {
      const [list, next] = listAt(lines, i, depth);
      out.push(list);
      i = next;
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      !BLANK.test(lines[i]!) &&
      (body.length === 0 || !starts(lines[i]!))
    ) {
      body.push(lines[i++]!.trim());
    }
    out.push({ type: "paragraph", children: inline(body.join("\n")) });
  }
  return out;
}

/** A list from line `i`: its items, each with what is indented under it; and the line after it. */
function listAt(lines: readonly string[], from: number, depth: number): [Block, number] {
  const first = ITEM.exec(lines[from]!)!;
  const ordered = /\d/.test(first[2]!);
  const items: ListItem[] = [];
  let i = from;
  while (i < lines.length) {
    const marker = ITEM.exec(lines[i]!);
    if (!marker || /\d/.test(marker[2]!) !== ordered) break;
    // What follows the marker; the lines under it are indented at least this far.
    const indent = marker[0].length;
    const body = [lines[i]!.slice(indent)];
    i++;
    while (i < lines.length) {
      const next = lines[i]!;
      if (BLANK.test(next)) {
        // A blank line ends the item unless what follows is still indented under it.
        const after = lines[i + 1];
        if (after !== undefined && !BLANK.test(after) && indentOf(after) >= Math.min(indent, 2)) {
          body.push("");
          i++;
          continue;
        }
        break;
      }
      if (indentOf(next) >= Math.min(indent, 2))
        body.push(next.slice(Math.min(indent, indentOf(next))));
      else if (ITEM.test(next) || starts(next)) break;
      // A lazy line carries the item's paragraph on.
      else body.push(next);
      i++;
    }
    const task = /^\[([ xX])\](?:[ \t]+|$)/.exec(body[0]!);
    if (task) body[0] = body[0]!.slice(task[0].length);
    items.push({
      checked: task ? task[1] !== " " : null,
      children: blocks(body, depth + 1),
    });
    // A blank line between items keeps the list.
    if (i < lines.length && BLANK.test(lines[i]!) && ITEM.test(lines[i + 1] ?? "")) i++;
  }
  return [{ type: "list", start: ordered ? Number.parseInt(first[2]!, 10) : null, items }, i];
}

const indentOf = (line: string) => /^[ \t]*/.exec(line)![0].replace(/\t/g, "    ").length;

/** The schemes a link may have: the web, mail and the phone. */
export function safeHref(href: string): string | null {
  const url = href.trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(url) && !/[\s<>"]/.test(url) ? url : null;
}

const BARE = /^(https?:\/\/|mailto:)[^\s<>"]+/i;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~<>|]/;
const WORD = /[\p{L}\p{N}]/u;

/** Text with its inline marks: code, emphasis, struck text, links (none inside a link's own words). */
function inline(text: string, links = true): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push(plain);
    plain = "";
  };
  const push = (node: Inline) => {
    flush();
    out.push(node);
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    const rest = text.slice(i);
    if (char === "\\" && ESCAPABLE.test(text[i + 1] ?? "")) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (char === "\n") {
      push({ type: "break" });
      i++;
      continue;
    }
    if (char === "`") {
      const run = /^`+/.exec(rest)![0];
      const end = text.indexOf(run, i + run.length);
      if (end > 0) {
        push({ type: "code", text: text.slice(i + run.length, end).replace(/\n/g, " ") });
        i = end + run.length;
        continue;
      }
      plain += run;
      i += run.length;
      continue;
    }
    const emphasis = emphasisAt(text, i);
    if (emphasis) {
      push({
        type: emphasis.type,
        children: inline(text.slice(emphasis.from, emphasis.to), links),
      });
      i = emphasis.end;
      continue;
    }
    if (links && char === "[") {
      const link = linkAt(text, i);
      if (link) {
        const href = safeHref(link.href);
        const children = inline(link.text, false);
        if (href) push({ type: "link", href, children });
        else {
          // Not a link it may follow: its words, as written.
          flush();
          out.push(...children);
        }
        i = link.end;
        continue;
      }
    }
    if (links && char === "<") {
      const auto = /^<((?:https?:\/\/|mailto:|tel:)[^\s<>]+)>/i.exec(rest);
      if (auto) {
        push({ type: "link", href: auto[1]!, children: [auto[1]!] });
        i += auto[0].length;
        continue;
      }
    }
    const bare = !links || WORD.test(text[i - 1] ?? "") ? null : BARE.exec(rest);
    if (bare) {
      const url = linkOf(bare[0]);
      push({ type: "link", href: url, children: [url] });
      i += url.length;
      continue;
    }
    plain += char;
    i++;
  }
  flush();
  return out;
}

const DELIMITERS = [
  ["**", "strong"],
  ["__", "strong"],
  ["~~", "del"],
  ["*", "em"],
  ["_", "em"],
] as const;

/** Emphasis opening at `i` and where it closes; `_` only between words, as CommonMark's. */
function emphasisAt(
  text: string,
  i: number,
): { type: "strong" | "em" | "del"; from: number; to: number; end: number } | null {
  for (const [mark, type] of DELIMITERS) {
    if (!text.startsWith(mark, i)) continue;
    const from = i + mark.length;
    const after = text[from];
    if (after === undefined || /\s/.test(after)) return null;
    if (mark[0] === "_" && WORD.test(text[i - 1] ?? "")) return null;
    let at = from;
    for (;;) {
      const to = text.indexOf(mark, at + 1);
      if (to < 0) break;
      const before = text[to - 1]!;
      const next = text[to + mark.length] ?? "";
      // A single mark is not the start of a double one; a closing mark follows a non-space.
      const doubled = mark.length === 1 && next === mark;
      if (!/\s/.test(before) && !doubled && !(mark[0] === "_" && WORD.test(next))) {
        return { type, from, to, end: to + mark.length };
      }
      at = doubled ? to + 1 : to;
    }
  }
  return null;
}

/** `[text](href)` at `i`, its brackets balanced. */
function linkAt(text: string, i: number): { text: string; href: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let j = i; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === "[") depth++;
    else if (text[j] === "]" && --depth === 0) {
      close = j;
      break;
    }
  }
  if (close < 0 || text[close + 1] !== "(") return null;
  const target = /^\(\s*<?([^\s)>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(text.slice(close + 1));
  if (!target) return null;
  return { text: text.slice(i + 1, close), href: target[1]!, end: close + 1 + target[0].length };
}

/**
 * A link as found in text, without what ends the sentence after it: a full
 * stop, a comma, or a closing bracket the link did not open
 * (`https://en.wikipedia.org/wiki/Foo_(bar)` keeps its own).
 */
export function linkOf(found: string): string {
  let url = found;
  for (;;) {
    url = url.replace(/[.,;:!?*_~]+$/, "");
    const last = url.at(-1);
    const open = last === ")" ? "(" : last === "]" ? "[" : null;
    if (!last || !open || count(url, open) >= count(url, last)) return url;
    url = url.slice(0, -1);
  }
}

const count = (text: string, char: string) => text.split(char).length - 1;
