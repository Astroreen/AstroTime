// The React Compiler's bail-outs in the UI (design D194). A component it
// cannot prove safe is left unmemoized, with no error at build: it renders
// all of its tree again on every render, and costs more CPU and battery
// (foundation D181, D182). This reads its diagnostics for every module of
// `@astrotime/ui` and holds them to the ones known and chosen: a new one
// fails here, where it can be fixed or chosen too.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { transformSync } from "oxc-transform-react";
import { expect, test } from "vite-plus/test";

const ui = fileURLToPath(new URL("../../../packages/ui/src/", import.meta.url));

/**
 * The bail-outs known, by module. Those chosen: components left unmemoized
 * on purpose (`"use no memo"`, each says why), their memos too heavy for
 * the first load (foundation D145), and the draft's hook, which reads its
 * form from a ref on purpose. The rest were there when this check came
 * (design D194's Deferred: each to look at, in its owner's area); a new one
 * fails here.
 */
const KNOWN: Record<string, readonly string[]> = {
  "app.tsx": ["Cannot access refs during render"],
  "components/accounts-context.tsx": [
    "(BuildHIR::lowerStatement) Handle TryStatement with a finalizer ('finally') clause",
    "(BuildHIR::lowerExpression) Handle UpdateExpression to variables captured within lambdas.",
  ],
  "components/attachments-field.tsx": Array<string>(2).fill(
    "(BuildHIR::lowerStatement) Support ThrowStatement inside of try/catch",
  ),
  "components/calendar-screen.tsx": [
    "(BuildHIR::lowerExpression) Handle Import expressions",
    ...Array<string>(4).fill("Existing memoization could not be preserved"),
  ],
  "components/celebration.ts": ["(BuildHIR::lowerExpression) Handle Import expressions"],
  // The draft is made from the form as it is when where it is drawn
  // changes, read from a ref, not anew with each letter typed (design
  // D155); in the editor's own chunk, not the first load.
  "components/draft-aside.ts": Array<string>(5).fill("Cannot access refs during render"),
  "components/tasks-screen.tsx": ["(BuildHIR::lowerExpression) Handle Import expressions"],
  "components/time-grid.tsx": ["This value cannot be modified"],
};

function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return modules(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

test("the React Compiler memoizes every component of the UI but those chosen not to be", () => {
  const found: Record<string, string[]> = {};
  for (const path of modules(ui)) {
    const { errors } = transformSync(path, readFileSync(path, "utf8"), {
      reactCompiler: { reportDiagnostics: true },
    });
    // An error, or advice on syntax it cannot compile yet (`??=` in a
    // component, `import()`): either way the component is left unmemoized.
    const bailouts = errors
      .filter((error) => error.severity === "Error" || error.severity === "Advice")
      .map((error) => error.message);
    if (bailouts.length > 0) found[relative(ui, path)] = bailouts;
  }
  expect(found).toEqual(KNOWN);
});
