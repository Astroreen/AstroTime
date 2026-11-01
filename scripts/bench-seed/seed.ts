// The page `bench-cold-start.ts` fills the web store from, on the app's own
// origin, so the app opens the same store: the big calendar, once.
import { Store } from "../../packages/storage/src/index.ts";
import { webDriver } from "../../packages/storage/src/web/index.ts";
import { fill } from "../big-calendar.ts";

const store = await Store.open(await webDriver("astrotime"));
if ((await store.accounts()).length === 0) await fill(store);
await store.close();
document.title = "filled";
