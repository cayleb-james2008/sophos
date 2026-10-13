import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PIN_PATH = fileURLToPath(new URL("./runtime-pins.json", import.meta.url));
const pins = JSON.parse(readFileSync(PIN_PATH, "utf8"));

export const PRIME_AGENT_PIN = Object.freeze({ ...pins.primeAgent });
export const NODE_RUNTIME_PIN = Object.freeze({ ...pins.nodeRuntime });
