// scripts/ci/check-pr-body.sh against descriptions it must pass and fail
// (docs/plans/foundation.md#D312).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";

const root = resolve(import.meta.dirname, "../..");
const script = resolve(root, "scripts/ci/check-pr-body.sh");

function check(description: string): { ok: boolean; out: string } {
  const run = spawnSync("bash", [script], {
    env: { ...process.env, PR_BODY: description },
    encoding: "utf8",
  });
  return { ok: run.status === 0, out: run.stdout + run.stderr };
}

const picture =
  "![after](https://github.com/Astroreen/AstroTime/blob/assets/pr-1/after.png?raw=true)";

function body(changes = `1. **The week starts on Monday.**\n\n   ${picture}`, steps = 2): string {
  return [
    "A Russian user saw the week start on Sunday. Now it starts on Monday (D1).",
    "",
    "## What changed",
    "",
    changes,
    "",
    "## Risk",
    "",
    "**Low** — could break: the week view. Undo: revert the PR.",
    "",
    "## How to check",
    "",
    ...Array.from({ length: steps }, (_, i) => `${i + 1}. Open the week view.`),
    "",
    "<details><summary>Proof</summary>",
    "",
    "```",
    "/home/runner/output.log → fine inside a code block",
    "```",
    "",
    "</details>",
  ].join("\n");
}

test("the short shape with an uploaded picture passes", () => {
  expect(check(body())).toMatchObject({ ok: true });
});

test("the template itself passes", () => {
  const template = readFileSync(resolve(root, ".github/pull_request_template.md"), "utf8");
  expect(check(template)).toMatchObject({ ok: true });
});

test.each([
  ["/home/me/shots/after.png", "/home/me/shots/after.png"],
  ["/Users/me/after.png", "/Users/me/after.png"],
  ["/tmp/shots/after.webm", "/tmp/shots/after.webm"],
  ["~/shots/after.jpg", "~/shots/after.jpg"],
  ["file:///srv/after.png", "file:///srv/after.png"],
])("a path on a disk fails, even beside an uploaded picture: %s", (path, shown) => {
  const result = check(body(`1. **Monday.**\n\n   ${picture} ![before](${path})`));
  expect(result.ok).toBe(false);
  expect(result.out).toContain(shown);
});

test("a bare picture name fails when no picture is shown", () => {
  const result = check(body("1. **Monday.** See `after-week.png`."));
  expect(result.ok).toBe(false);
  expect(result.out).toContain("after-week.png");
});

test("a config path that is not a picture passes", () => {
  expect(check(body("1. **Monday.** Read from `~/.config/astrotime`."))).toMatchObject({
    ok: true,
  });
});

test("the old long shape fails and names what is missing", () => {
  const old = "Builds PR 5.\n\n## What changed\n- a\n\n## Tests\n- b\n\n## Screenshots\n";
  const result = check(old);
  expect(result.ok).toBe(false);
  expect(result.out).toContain('no "## Risk" section');
  expect(result.out).toContain("## Tests, ## Screenshots");
});

test("a Risk without how to undo fails", () => {
  const result = check(body().replace("Undo: revert the PR.", ""));
  expect(result.out).toContain("does not say how to undo");
});

test("more than five How to check steps fail", () => {
  const result = check(body(undefined, 6));
  expect(result.ok).toBe(false);
  expect(result.out).toContain('6 steps in "## How to check"');
});

test("more than 300 words outside <details> fail", () => {
  const result = check(body(`1. **Monday.** ${"word ".repeat(320)}`));
  expect(result.ok).toBe(false);
  expect(result.out).toMatch(/\d+ words outside <details>/);
});
