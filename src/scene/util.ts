import { Color } from "three";
import type { Bacterium } from "../sim/types";
import { theme } from "../theme";

/** Use as `raycast` prop to make an object invisible to pointer events. */
export const noRaycast = (): void => {};

const ACCENT = new Color(theme.accent);

/** Display colour of a cell: calm and matte; lineage hue only subtly tints the population. */
export function cellColor(b: Bacterium, evolution: boolean, out: Color): Color {
  if (!b.alive) return out.setRGB(0.1, 0.11, 0.12);
  if (evolution) out.setHSL(b.hue, 0.3, 0.6);
  else out.copy(ACCENT);
  const e = Math.max(0, Math.min(1, b.energy));
  return out.multiplyScalar(0.55 + 0.45 * e);
}
