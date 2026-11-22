import type { NeuronsMsg } from "../brainlink/protocol";

/** Radius (scene units) the known-position brain is scaled to fit. */
export const BRAIN_RADIUS = 10;

export interface Layout {
  /** xyz per neuron, scene units. */
  positions: Float32Array;
  radius: number;
  unknownCount: number;
  /** Centre of the "position unknown" patch, or null when every neuron has a position. */
  unknownCenter: [number, number, number] | null;
  /** +1 when left-side neurons sit at -x (camera looks from +z), -1 when mirrored, 0 when unknown. */
  viewSign: 1 | -1 | 0;
}

/**
 * Rescale and centre the known positions, and put neurons with unknown position on a flat grid to the
 * side (never mixed into the real coordinates). Allocation: one Float32Array, once per neuron table.
 */
export function layoutNeurons(n: NeuronsMsg): Layout {
  const count = n.group.length;
  const positions = new Float32Array(count * 3);
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  let known = 0;
  for (let i = 0; i < count; i++) {
    if (n.hasPosition[i] === 0) continue;
    known++;
    minX = Math.min(minX, n.x[i]);
    maxX = Math.max(maxX, n.x[i]);
    minY = Math.min(minY, n.y[i]);
    maxY = Math.max(maxY, n.y[i]);
    minZ = Math.min(minZ, n.z[i]);
    maxZ = Math.max(maxZ, n.z[i]);
  }
  const cx = known ? (minX + maxX) / 2 : 0;
  const cy = known ? (minY + maxY) / 2 : 0;
  const cz = known ? (minZ + maxZ) / 2 : 0;
  const half = known ? Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2 : 1;
  const k = BRAIN_RADIUS / (half > 0 ? half : 1);

  const unknown = count - known;
  const cols = Math.max(1, Math.ceil(Math.sqrt(unknown)));
  const rows = Math.max(1, Math.ceil(unknown / cols));
  const gap = Math.min((BRAIN_RADIUS * 2) / Math.max(cols, rows), BRAIN_RADIUS * 0.12);
  const gx = -BRAIN_RADIUS * 2.2;
  let u = 0;
  let sumL = 0,
    nL = 0,
    sumR = 0,
    nR = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    if (n.hasPosition[i] === 0) {
      positions[o] = gx;
      positions[o + 1] = ((rows - 1) / 2 - Math.floor(u / cols)) * gap;
      positions[o + 2] = ((u % cols) - (cols - 1) / 2) * gap;
      u++;
    } else {
      positions[o] = (n.x[i] - cx) * k;
      positions[o + 1] = (n.y[i] - cy) * k;
      positions[o + 2] = (n.z[i] - cz) * k;
      if (n.side[i] < 0) {
        sumL += positions[o];
        nL++;
      } else if (n.side[i] > 0) {
        sumR += positions[o];
        nR++;
      }
    }
  }
  const viewSign: Layout["viewSign"] = nL && nR ? (sumL / nL < sumR / nR ? 1 : -1) : 0;
  return {
    positions,
    radius: BRAIN_RADIUS,
    unknownCount: unknown,
    unknownCenter: unknown ? [gx, 0, 0] : null,
    viewSign,
  };
}
