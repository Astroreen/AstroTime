import { renderToString } from "react-dom/server";
import { expect, test } from "vite-plus/test";

import { App } from "./app.tsx";

test("the app renders its name", () => {
  expect(renderToString(<App />)).toContain("AstroTime");
});
