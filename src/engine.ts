import { createEngine } from "./sim/createEngine";
import type { Engine } from "./sim/types";

/** The single simulation instance shared by every view. */
export const engine: Engine = createEngine();
