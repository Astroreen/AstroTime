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

/**
 * A parse's steps, counted where it walks the text: a test reads them to
 * see that twice the text costs about twice the work (design D207), with
 * no clock.
 */
export interface ParseStats {
  steps: number;
}

/** The stats of the parse running now: each parse has its own (parsing never waits). */
let work: ParseStats = { steps: 0 };

/** How deep quotes and lists nest before the rest reads as text. */
const DEEPEST = 8;

/** A fence opens a code block; a backtick one has no backtick after it, or it is inline code. */
const FENCE = /^ {0,3}(`{3,}(?!.*`)|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const BLANK = /^[ \t]*$/;

/** The description as blocks. */
export function parseMarkdown(text: string, stats: ParseStats = { steps: 0 }): readonly Block[] {
  work = stats;
  work.steps += text.length;
  return blocks(text.replace(/\r\n?/g, "\n").split("\n"), 0);
}

/** A line's indent in columns, a tab to the next stop of 4. */
function indentOf(line: string): number {
  let columns = 0;
  for (const char of line) {
    if (char === " ") columns++;
    else if (char === "\t") columns += 4 - (columns % 4);
    else break;
  }
  return columns;
}

/**
 * The line without `count` columns of its indent: a tab that reaches past
 * them leaves its remaining columns as spaces. Only the indent is touched; a
 * tab in a code block's text stays a tab.
 */
function dropColumns(line: string, count: number): string {
  let columns = 0;
  let at = 0;
  while (at < line.length && columns < count) {
    const char = line[at]!;
    if (char === " ") columns++;
    else if (char === "\t") columns += 4 - (columns % 4);
    else break;
    at++;
  }
  return " ".repeat(Math.max(0, columns - count)) + line.slice(at);
}

/** A heading's level and words; none without words: a lone "#" is text. */
function headingOf(line: string): { level: number; words: string } | null {
  const heading = HEADING.exec(line);
  const words = heading ? headingWords(heading[2] ?? "") : "";
  return heading && words ? { level: heading[1]!.length, words } : null;
}

/**
 * Whether a line starts a block that cuts a paragraph short: an ordered
 * list only from 1, and a list item only with words, as CommonMark's
 * ("2019. was a good year" carries the paragraph on).
 */
const interrupts = (line: string) =>
  FENCE.test(line) ||
  headingOf(line) !== null ||
  RULE.test(line) ||
  QUOTE.test(line) ||
  /^ {0,3}(?:[-*+]|1[.)])[ \t]+\S/.test(line);

/** A heading's words, without its closing `#`s (`## Steps ##`). */
function headingWords(words: string): string {
  let end = words.trimEnd().length;
  let hashes = end;
  while (hashes > 0 && words[hashes - 1] === "#") hashes--;
  if (hashes < end && (hashes === 0 || /[ \t]/.test(words[hashes - 1]!))) end = hashes;
  return words.slice(0, end).trim();
}

function blocks(lines: readonly string[], depth: number): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    work.steps++;
    const line = lines[i]!;
    if (BLANK.test(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1]!;
      // Closed by a fence of its own character, as long or longer, alone on its line.
      const closing = new RegExp(`^ {0,3}${mark[0]}{${mark.length},}[ \t]*$`);
      // Each line loses as many of its spaces as the fence is indented, no more.
      const indent = new RegExp(`^ {0,${fence[0].length - mark.length}}`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !closing.test(lines[i]!))
        body.push(lines[i++]!.replace(indent, ""));
      i++;
      out.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = headingOf(line);
    if (heading) {
      out.push({ type: "heading", level: heading.level, children: inline(heading.words) });
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
        else if (interrupts(next)) break;
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
      (body.length === 0 || !interrupts(lines[i]!))
    ) {
      // Its spaces kept as typed: a plain description reads as it was written.
      body.push(lines[i++]!.trimEnd());
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
    // "* * *" or "- - -" after an item is a rule that ends the list, not an item.
    if (!marker || RULE.test(lines[i]!) || /\d/.test(marker[2]!) !== ordered) break;
    // What follows the marker; the lines under it are indented at least this far.
    // Its content's column, its marker's indent and width included (as
    // CommonMark's): a line under it belongs to it from this column on.
    // Five spaces or more after the marker start an indented line of the
    // item, and an empty item has no content to take the column from: its
    // column is then one past the marker.
    const marked = indentOf(marker[1]! + marker[2]!.replace(/./g, " ") + "x");
    const spaces = indentOf(marker[0].replace(/\S/g, " ") + "x") - marked;
    const body = [lines[i]!.slice(marker[0].length)];
    const indent = spaces >= 5 || BLANK.test(body[0]!) ? marked + 1 : marked + spaces;
    i++;
    while (i < lines.length) {
      const next = lines[i]!;
      if (BLANK.test(next)) {
        // A blank line ends the item unless what follows is still indented under it.
        const after = lines[i + 1];
        if (after !== undefined && !BLANK.test(after) && indentOf(after) >= indent) {
          body.push("");
          i++;
          continue;
        }
        break;
      }
      if (indentOf(next) >= indent) body.push(dropColumns(next, indent));
      // The list's next item ends this one; any other list only where it may
      // cut a paragraph short ("2019. was a good year" carries it on).
      else if (sibling(next, ordered) || interrupts(next)) break;
      // A lazy line carries the item's paragraph on; an empty item has none ("-" then words).
      else if (body.at(-1)?.trim()) body.push(next);
      else break;
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

/** Whether a line is an item of the same kind of list: bulleted, or numbered. */
function sibling(line: string, ordered: boolean): boolean {
  const marker = ITEM.exec(line);
  return marker !== null && /\d/.test(marker[2]!) === ordered;
}

/** The schemes a link may have: the web, mail and the phone. */
export function safeHref(href: string): string | null {
  const url = href.trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(url) && !/[\s<>"]/.test(url) ? url : null;
}

const BARE = /(?:https?:\/\/|mailto:)[^\s<>"]+/iy;
const AUTOLINK = /<((?:https?:\/\/|mailto:|tel:)[^\s<>]+)>/iy;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~<>|]/;
const WORD = /[\p{L}\p{N}]/u;

const DELIMITERS = [
  ["**", "strong"],
  ["__", "strong"],
  ["~~", "del"],
  ["*", "em"],
  ["_", "em"],
] as const;
type Mark = (typeof DELIMITERS)[number][0];

/**
 * Where marks may close in `text`, found once, so an opener with no closer
 * costs no scan of the rest (untrusted text, design D207): each mark's
 * closing places, in order, as CommonMark lets one close (after no space or
 * backslash; a single mark not half of a double; `_` not inside a word).
 */
function closersOf(text: string): Record<Mark, number[]> {
  const found = { "**": [], __: [], "~~": [], "*": [], _: [] } as Record<Mark, number[]>;
  const hidden = hiddenIn(text);
  work.steps += text.length;
  for (let at = 1; at < text.length; at++) {
    if (hidden[at]) continue;
    const before = text[at - 1]!;
    if (/\s/.test(before) || before === "\\") continue;
    for (const [mark] of DELIMITERS) {
      if (!text.startsWith(mark, at)) continue;
      const next = text[at + mark.length] ?? "";
      if (mark.length === 1 && (next === mark || before === mark)) continue;
      if (mark[0] === "_" && WORD.test(next)) continue;
      found[mark].push(at);
    }
  }
  return found;
}

const BARE_ANYWHERE = /(?:https?:\/\/|mailto:)[^\s<>"]+/gi;

/**
 * Where no mark closes: inside a code span (it wins over emphasis,
 * `*a `b*` c`), and inside a bare link, but for the marks after it that may
 * close emphasis opened before it.
 */
function hiddenIn(text: string): Uint8Array {
  const hidden = new Uint8Array(text.length);
  const unclosed = new Set<number>();
  for (let at = 0; at < text.length;) {
    work.steps++;
    if (text[at] === "\\") {
      at += 2;
      continue;
    }
    if (text[at] !== "`") {
      at++;
      continue;
    }
    let length = 1;
    while (text[at + length] === "`") length++;
    const end = unclosed.has(length) ? -1 : runOf(text, length, at + length);
    if (end < 0) {
      unclosed.add(length);
      at += length;
      continue;
    }
    work.steps += end - at;
    hidden.fill(1, at, end + length);
    at = end + length;
  }
  BARE_ANYWHERE.lastIndex = 0;
  for (let link = BARE_ANYWHERE.exec(text); link; link = BARE_ANYWHERE.exec(text)) {
    work.steps += link[0].length;
    if (!WORD.test(text[link.index - 1] ?? "")) {
      hidden.fill(1, link.index, link.index + linkOf(link[0], "*_~").length);
    }
  }
  return hidden;
}

/**
 * Where a run of exactly `length` backticks starts in `text` from `from`, the
 * one that closes a code span opened by as many; -1 when none does.
 */
function runOf(text: string, length: number, from: number): number {
  const run = "`".repeat(length);
  let at = text.indexOf(run, from);
  while (at >= 0) {
    let end = at + length;
    while (text[end] === "`") end++;
    if (end - at === length) return at;
    at = text.indexOf(run, end);
  }
  return -1;
}

/** The first of `sorted` at or after `from`, by halves. */
function firstFrom(sorted: readonly number[], from: number): number | undefined {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle]! < from) low = middle + 1;
    else high = middle;
  }
  return sorted[low];
}

/** Each `[` and the `]` that closes it, escapes aside: found once, with a stack. */
function bracketsOf(text: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const open: number[] = [];
  work.steps += text.length;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === "\\") at++;
    else if (char === "[") open.push(at);
    else if (char === "]" && open.length > 0) pairs.set(open.pop()!, at);
  }
  return pairs;
}

/**
 * Text with its inline marks: code, emphasis, struck text, links (none
 * inside a link's own words). Marks nested deeper than `DEEPEST` read as
 * text, and nothing is scanned twice for want of a closer.
 */
function inline(text: string, links = true, depth = 0): Inline[] {
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
  const closers = depth < DEEPEST ? closersOf(text) : null;
  const brackets = links && depth < DEEPEST ? bracketsOf(text) : null;
  /** By a run of backticks' length, where a search for its closer found none. */
  const unclosed = new Map<number, number>();
  /** Where each mark is first: a bare link's trailing mark closes one opened before it. */
  const firstMark = { "*": text.indexOf("*"), _: text.indexOf("_"), "~": text.indexOf("~") };
  work.steps += text.length;
  let i = 0;
  while (i < text.length) {
    work.steps++;
    const char = text[i]!;
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
      let length = 1;
      while (text[i + length] === "`") length++;
      const run = "`".repeat(length);
      const end = (unclosed.get(length) ?? -1) > i ? -1 : runOf(text, length, i + length);
      if ((unclosed.get(length) ?? -1) <= i) work.steps += (end > 0 ? end : text.length) - i;
      if (end > 0) {
        push({ type: "code", text: text.slice(i + length, end).replace(/\n/g, " ") });
        i = end + length;
        continue;
      }
      unclosed.set(length, text.length);
      plain += run;
      i += length;
      continue;
    }
    const emphasis = closers && emphasisAt(text, i, closers);
    if (emphasis) {
      push({
        type: emphasis.type,
        children: inline(text.slice(emphasis.from, emphasis.to), links, depth + 1),
      });
      i = emphasis.end;
      continue;
    }
    // An image is read as a link to it, named by its words (no picture is loaded).
    const image = char === "!" && text[i + 1] === "[";
    if (brackets && (char === "[" || image)) {
      const link = linkAt(text, i + (image ? 1 : 0), brackets.get(i + (image ? 1 : 0)));
      if (link) {
        const href = safeHref(link.href);
        const words = inline(link.text, false, depth + 1);
        // A link with no words is named by where it goes, so it can be seen and pressed.
        const children = words.length > 0 ? words : [href ?? link.href];
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
      AUTOLINK.lastIndex = i;
      const auto = AUTOLINK.exec(text);
      if (auto && safeHref(auto[1]!)) {
        push({ type: "link", href: auto[1]!, children: [auto[1]!] });
        i += auto[0].length;
        continue;
      }
    }
    if (links && (char === "h" || char === "H" || char === "m" || char === "M")) {
      BARE.lastIndex = i;
      const bare = WORD.test(text[i - 1] ?? "") ? null : BARE.exec(text);
      if (bare) work.steps += bare[0].length;
      const opened = (["*", "_", "~"] as const)
        .filter((mark) => firstMark[mark] >= 0 && firstMark[mark] < i)
        .join("");
      const url = bare ? linkOf(bare[0], opened) : "";
      // Only a link with more than its scheme: "mailto::" is words.
      if (bare && safeHref(url) && !/^(?:https?:\/\/|mailto:)$/i.test(url)) {
        push({ type: "link", href: url, children: [url] });
        i += url.length;
        continue;
      }
    }
    plain += char;
    i++;
  }
  flush();
  return out;
}

/** Emphasis opening at `i` and where it closes; `_` only between words, as CommonMark's. */
function emphasisAt(
  text: string,
  i: number,
  closers: Record<Mark, number[]>,
): { type: "strong" | "em" | "del"; from: number; to: number; end: number } | null {
  for (const [mark, type] of DELIMITERS) {
    if (!text.startsWith(mark, i)) continue;
    const from = i + mark.length;
    const after = text[from];
    if (after === undefined || /\s/.test(after)) return null;
    if (mark[0] === "_" && WORD.test(text[i - 1] ?? "")) return null;
    let to = firstFrom(closers[mark], from + 1);
    if (to === undefined) continue;
    // `***both***`: a double mark closes at the run's end, around the single inside.
    while (mark.length === 2 && text[to + 2] === mark[0]) to++;
    return { type, from, to, end: to + mark.length };
  }
  return null;
}

/**
 * `[text](href)` at `i`, closed at `close`: the target's parentheses
 * balanced (`…/wiki/Foo_(bar)`), or in angle brackets, then an optional
 * title in quotes or parentheses.
 */
function linkAt(
  text: string,
  i: number,
  close: number | undefined,
): { text: string; href: string; end: number } | null {
  if (close === undefined || text[close + 1] !== "(") return null;
  let at = close + 2;
  // A target is looked for this far only: "[a](" over and over costs no scan of the rest.
  const limit = Math.min(text.length, at + LONGEST_TARGET);
  const skip = () => {
    while (at < limit && text.charCodeAt(at) <= 32) at++;
  };
  skip();
  let href = "";
  if (text[at] === "<") {
    const end = findBefore(text, ">", at, limit);
    if (end < 0 || /[\n<]/.test(text.slice(at + 1, end))) return null;
    href = text.slice(at + 1, end);
    at = end + 1;
  } else {
    const start = at;
    let open = 0;
    for (; at < limit; at++) {
      work.steps++;
      const code = text.charCodeAt(at);
      if (code === 92) at++; // "\\"
      else if (code <= 32) break; // a space, a tab, a line end
      else if (code === 40) open++; // "("
      else if (code === 41 && open-- === 0) break; // ")"
    }
    // Its escapes taken out: `\)` is a ")" of the address.
    href = text.slice(start, at).replace(/\\([!-/:-@[-`{-~])/g, "$1");
  }
  skip();
  // A title in double or single quotes, or in parentheses.
  const closer = text[at] === "(" ? ")" : text[at] === '"' || text[at] === "'" ? text[at]! : null;
  if (closer) {
    const end = findBefore(text, closer, at + 1, limit);
    if (end < 0) return null;
    at = end + 1;
    skip();
  }
  if (text[at] !== ")") return null;
  return { text: text.slice(i + 1, close), href, end: at + 1 };
}

/** Where `char` is in `text` from `from`, looked for up to `limit` only; -1 when not there. */
function findBefore(text: string, char: string, from: number, limit: number): number {
  for (let at = from; at < limit; at++) {
    work.steps++;
    if (text[at] === char) return at;
  }
  return -1;
}

/** The longest link target, its title included, read after `](`. */
const LONGEST_TARGET = 2048;

const PAIRS: Record<string, string> = { ")": "(", "]": "[" };

/**
 * A link as found in text, without what ends the sentence after it: a full
 * stop, a comma, or a closing bracket the link did not open
 * (`https://en.wikipedia.org/wiki/Foo_(bar)` keeps its own), and a `*`,
 * `_` or `~` only where it closes emphasis opened before the link (`marks`):
 * `https://example.com/a_` keeps its own. Counted once.
 */
export function linkOf(found: string, marks = ""): string {
  const counts = new Map<string, number>();
  for (const char of found) counts.set(char, (counts.get(char) ?? 0) + 1);
  let end = found.length;
  while (end > 0) {
    const last = found[end - 1]!;
    const open = PAIRS[last];
    work.steps++;
    if (".,;:!?".includes(last) || marks.includes(last)) end--;
    else if (open && (counts.get(open) ?? 0) < (counts.get(last) ?? 0)) {
      counts.set(last, counts.get(last)! - 1);
      end--;
    } else break;
  }
  return found.slice(0, end);
}
