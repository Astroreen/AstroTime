import { webDriver } from "../src/web/index.ts";
import { storeContract } from "./store.contract.ts";

// Each test gets its own database on OPFS, so none sees another's rows.
let n = 0;
storeContract("sqlite-wasm on OPFS", () => webDriver(`test-${Date.now()}-${n++}`));
