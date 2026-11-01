// The question before a password is saved unprotected (docs/plans/desktop.md#D74).
import { expect, test } from "vite-plus/test";

import { UnprotectedPrompt } from "../src/accounts/unprotected.ts";

test("each question waits for its answer, one after another, and the dialog hears when to show", async () => {
  const prompt = new UnprotectedPrompt();
  const heard: boolean[] = [];
  prompt.subscribe(() => heard.push(prompt.asking));
  expect(prompt.asking).toBe(false);
  prompt.answer("unprotected");

  const first = prompt.ask();
  const second = prompt.ask();
  expect(prompt.asking).toBe(true);
  prompt.answer("until-quit");
  expect(await first).toBe("until-quit");
  expect(prompt.asking).toBe(true);
  prompt.answer("unprotected");
  expect(await second).toBe("unprotected");
  expect(prompt.asking).toBe(false);
  expect(heard).toEqual([true, true, false]);
});
