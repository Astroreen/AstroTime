import { expect, test } from "vite-plus/test";

import { webDriver } from "../src/web/index.ts";
import { storeContract } from "./store.contract.ts";

// Each test gets its own database on OPFS, so none sees another's rows.
let n = 0;
storeContract("sqlite-wasm on OPFS", () => webDriver(`test-${Date.now()}-${n++}`));

test("a second open of a database another worker holds fails instead of hanging", async () => {
  const name = `held-${Date.now()}`;
  const first = await webDriver(name);
  await expect(webDriver(name)).rejects.toThrow();
  await first.close();
});
