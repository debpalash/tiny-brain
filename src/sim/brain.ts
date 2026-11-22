import { N, NEURON } from "./types";
import type { Bacterium, Genome } from "./types";

export const BRAIN_DT = 1 / 60;

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

const next = new Float32Array(N);
const input = new Float32Array(N);

export const SENSOR = { gain: 0.5, offset: 0.0005 };

/** Receptor scaling: logarithmic (like real bacteria) so faint far-away gradients are still visible. */
export function sensorGain(c: number): number {
  return SENSOR.gain * Math.log(1 + (c < 0 ? 0 : c) / SENSOR.offset);
}

/** One CTRNN Euler step of length h. */
export function stepBrain(
  b: Bacterium,
  food: number,
  toxin: number,
  scent: number,
  h: number,
): void {
  const { bias, tau } = b.genome;
  const weights = b.w;
  const { y, act, clamp } = b;
  input[NEURON.FOOD] = sensorGain(food);
  input[NEURON.TOXIN] = sensorGain(toxin);
  input[NEURON.SCENT] = sensorGain(scent);
  input[NEURON.ENERGY] = 3 * (1 - b.energy);
  for (let i = 0; i < N; i++) {
    let sum = input[i] as number;
    for (let j = 0; j < N; j++) sum += (weights[j * N + i] as number) * (act[j] as number);
    const yi = (y[i] as number) + (h / (tau[i] as number)) * (sum - (y[i] as number));
    y[i] = yi;
    next[i] = sigmoid(yi + (bias[i] as number));
  }
  for (let i = 0; i < N; i++) {
    const c = clamp[i];
    act[i] = c === null || c === undefined ? (next[i] as number) : c;
  }
}

/** Let the brain settle on constant inputs so cells do not start with a big transient. */
export function settleBrain(
  b: Bacterium,
  food: number,
  toxin: number,
  scent: number,
  seconds: number,
): void {
  const steps = Math.round(seconds / BRAIN_DT);
  for (let i = 0; i < steps; i++) stepBrain(b, food, toxin, scent, BRAIN_DT);
}

export function copyGenomeInto(dst: Genome, src: Genome): void {
  dst.weights.set(src.weights);
  dst.bias.set(src.bias);
  dst.tau.set(src.tau);
  dst.plastic.set(src.plastic);
}
