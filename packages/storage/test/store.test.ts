import { nodeDriver } from "../src/node.ts";
import { storeContract } from "./store.contract.ts";

storeContract("node:sqlite", () => nodeDriver());
