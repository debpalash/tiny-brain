import type { Source } from "./types";

/** Concentrations of food, toxin and scent at a point: sum of Gaussian blobs, clamped to 1. */
export function sampleSources(
  sources: readonly Source[],
  x: number,
  z: number,
  out: { food: number; toxin: number; scent: number },
) {
  let food = 0;
  let toxin = 0;
  let scent = 0;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i] as Source;
    const dx = x - s.x;
    const dz = z - s.z;
    const c = s.strength * Math.exp(-(dx * dx + dz * dz) / (2 * s.radius * s.radius));
    if (s.kind === "food") food += c;
    else if (s.kind === "toxin") toxin += c;
    else scent += c;
  }
  out.food = food > 1 ? 1 : food;
  out.toxin = toxin > 1 ? 1 : toxin;
  out.scent = scent > 1 ? 1 : scent;
  return out;
}

/** Food is only eaten inside this fraction of a source's radius. */
export const EAT_RADIUS_FRAC = 0.6;
export const EAT_RATE = 0.6; // food units per second at a source's peak
export const ENERGY_PER_FOOD = 0.5;
export const SOURCE_DEPLETION = 0.05; // fraction of strength lost per unit eaten
/** Evolution dishes are far more crowded, so blobs are tougher: fitness should measure skill, not who ate last. */
export const SOURCE_DEPLETION_EVOLUTION = 0.006;
export const TOXIN_ENERGY_DRAIN = 0.25; // energy per second at full toxin
export const TOXIN_FITNESS_DRAIN = 0.25;
