// The context library's routes (docs/README.md#how-knowledge-is-arranged): every
// relative Markdown link leads to a file that exists, and every page under docs/
// is reachable from the trailhead, AGENTS.md.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

const root = resolve(import.meta.dirname, "..");
const LINK = /\]\(([^)\s]+)\)|`((?:\.\.\/|docs\/)[^`\s#]+\.md)(?:#[^`]*)?`/g;

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

function routes(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(LINK)]
    .map((match) => (match[1] ?? match[2] ?? "").split("#")[0] ?? "")
    .filter((target) => target !== "" && !/^[a-z]+:/.test(target))
    .map((target) =>
      target.startsWith("docs/") ? join(root, target) : resolve(dirname(file), target),
    );
}

const pages = [
  join(root, "AGENTS.md"),
  join(root, "GLOSSARY.md"),
  join(root, "README.md"),
  ...markdownFiles(join(root, "docs")),
];

test("every route leads to a file that exists", () => {
  const broken = pages.flatMap((page) =>
    routes(page)
      .filter((target) => !existsSync(target))
      .map((target) => `${relative(root, page)} → ${relative(root, target)}`),
  );
  expect(broken).toEqual([]);
});

test("every page under docs/ is reachable from AGENTS.md", () => {
  const reached = new Set<string>();
  const queue = [join(root, "AGENTS.md")];
  while (queue.length > 0) {
    const page = queue.pop()!;
    if (reached.has(page) || !page.endsWith(".md") || !existsSync(page)) continue;
    reached.add(page);
    queue.push(...routes(page));
  }
  const unreached = markdownFiles(join(root, "docs"))
    .filter((page) => !reached.has(page))
    .map((page) => relative(root, page));
  expect(unreached).toEqual([]);
});
