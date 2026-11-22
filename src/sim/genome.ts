import { N, NEURON, WEIGHT_MAX } from "./types";
import type { Genome } from "./types";
import type { Rng } from "./rng";

/** Fraction of connections that can learn in a random genome. */
const PLASTIC_DENSITY = 0.08;
export const TAU_MIN = 0.05;
export const TAU_MAX = 5;

const clampW = (w: number) => Math.max(-WEIGHT_MAX, Math.min(WEIGHT_MAX, w));
const clampTau = (t: number) => Math.max(TAU_MIN, Math.min(TAU_MAX, t));

export function emptyGenome(): Genome {
  return {
    weights: new Float32Array(N * N),
    bias: new Float32Array(N),
    tau: new Float32Array(N).fill(1),
    plastic: new Float32Array(N * N),
  };
}

export function cloneGenome(g: Genome): Genome {
  return {
    weights: g.weights.slice(),
    bias: g.bias.slice(),
    tau: g.tau.slice(),
    plastic: g.plastic.slice(),
  };
}

/** Tunable numbers of the hand-designed chemotaxis circuit. */
export const DESIGN = {
  sensBias: -3.0,
  kinGain: 3.617,
  toxBias: -5,
  toxGain: 8,
  memToKin: 8,
  kinToMem: 8,
  memSelf: 4.0,
  memBias: -6,
  memTau: 2.5,
  kinSelf: 1.5,
  kinBias: 3.487,
  fastTau: 0.13,
  kinToMsg: -8,
  msgSelf: 1.5,
  msgBias: 3.25,
  msgToTumble: 7.746,
  tumbleBias: -4.4,
  toxMsg: 0,
  runBias: 0.3,
  hungerToRun: 1.5,
};

/**
 * Hand-designed chemotaxis with integral feedback, like the real E. coli circuit.
 *   FOOD (+) and TOXIN (-) push KINASE up when life improves.
 *   KINASE excites MEMORY; MEMORY (a slow, self-sustaining integrator) inhibits KINASE.
 *   So MEMORY creeps until KINASE returns to its resting level at any background
 *   concentration: only CHANGES are reported (exact adaptation).
 *   MESSENGER inverts KINASE; TUMBLE follows MESSENGER, so improving means fewer tumbles.
 */
export function designedGenome(): Genome {
  const g = emptyGenome();
  const w = (from: number, to: number, v: number) => {
    g.weights[from * N + to] = v;
  };
  const D = DESIGN;
  g.tau.set([0.1, 0.1, 0.5, D.memTau, D.fastTau, D.fastTau, D.fastTau, 0.3, 0.1]);
  g.bias[NEURON.SCENT] = D.sensBias;
  g.bias[NEURON.FOOD] = D.sensBias;
  g.bias[NEURON.TOXIN] = D.toxBias;
  g.bias[NEURON.ENERGY] = -1;
  g.bias[NEURON.MEMORY] = D.memBias;
  g.bias[NEURON.KINASE] = D.kinBias;
  g.bias[NEURON.MESSENGER] = D.msgBias;
  g.bias[NEURON.TUMBLE] = D.tumbleBias;
  g.bias[NEURON.RUN] = D.runBias;
  w(NEURON.FOOD, NEURON.KINASE, D.kinGain);
  w(NEURON.TOXIN, NEURON.KINASE, -D.toxGain);
  w(NEURON.KINASE, NEURON.MEMORY, D.kinToMem);
  w(NEURON.MEMORY, NEURON.MEMORY, D.memSelf);
  w(NEURON.KINASE, NEURON.KINASE, D.kinSelf);
  w(NEURON.MESSENGER, NEURON.MESSENGER, D.msgSelf);
  w(NEURON.MEMORY, NEURON.KINASE, -D.memToKin);
  w(NEURON.TOXIN, NEURON.MESSENGER, D.toxMsg);
  w(NEURON.KINASE, NEURON.MESSENGER, D.kinToMsg);
  w(NEURON.MESSENGER, NEURON.TUMBLE, D.msgToTumble);
  w(NEURON.ENERGY, NEURON.RUN, D.hungerToRun);
  // SCENT is silent at birth (weight 0) but its path into KINASE can learn: positive = treat as food.
  g.plastic[NEURON.SCENT * N + NEURON.KINASE] = 1;
  return g;
}

export function randomGenome(rng: Rng): Genome {
  const g = emptyGenome();
  for (let i = 0; i < N * N; i++) g.weights[i] = clampW(rng.gauss() * 2.5);
  for (let i = 0; i < N; i++) {
    g.bias[i] = rng.gauss() * 1.2;
    g.tau[i] = clampTau(Math.exp(rng.range(Math.log(0.1), Math.log(3))));
  }
  for (let i = 0; i < N * N; i++)
    if (rng.next() < PLASTIC_DENSITY) g.plastic[i] = rng.range(0.2, 1);
  return g;
}

/** Uniform crossover of two parents, gene by gene. */
export function crossoverGenome(a: Genome, b: Genome, rng: Rng): Genome {
  const g = cloneGenome(a);
  for (let i = 0; i < N * N; i++) if (rng.next() < 0.5) g.weights[i] = b.weights[i] as number;
  for (let i = 0; i < N; i++) {
    if (rng.next() < 0.5) g.bias[i] = b.bias[i] as number;
    if (rng.next() < 0.5) g.tau[i] = b.tau[i] as number;
  }
  for (let i = 0; i < N * N; i++) if (rng.next() < 0.5) g.plastic[i] = b.plastic[i] as number;
  return g;
}

/** Gaussian mutation; `scale` anneals the step size over generations. */
export function mutateGenome(src: Genome, rng: Rng, scale = 1): Genome {
  const g = cloneGenome(src);
  for (let i = 0; i < N * N; i++) {
    if (rng.next() < 0.2)
      g.weights[i] = clampW((g.weights[i] as number) + rng.gauss() * 0.8 * scale);
  }
  for (let i = 0; i < N; i++) {
    if (rng.next() < 0.3) g.bias[i] = (g.bias[i] as number) + rng.gauss() * 0.4 * scale;
    if (rng.next() < 0.3)
      g.tau[i] = clampTau((g.tau[i] as number) * Math.exp(rng.gauss() * 0.25 * scale));
  }
  for (let i = 0; i < N * N; i++) {
    if (rng.next() >= 0.05) continue;
    const p = g.plastic[i] as number;
    // mostly nudge existing rates; occasionally switch a connection on or off
    if (p > 0)
      g.plastic[i] =
        rng.next() < 0.3 ? 0 : Math.min(2, Math.max(0.05, p + rng.gauss() * 0.3 * scale));
    else if (rng.next() < 0.25) g.plastic[i] = rng.range(0.2, 1);
  }
  return g;
}
