/**
 * SHARED CONTRACT. Owned by the project lead. Do not change without asking.
 *
 * The simulation is a 2D world living on the XZ plane (three.js Y is up).
 * Everything here is plain mutable data, read every frame by the renderers.
 */

/** Number of neurons in every brain. */
export const N = 9;

/**
 * Neuron indices. The layout mirrors the real E. coli chemotaxis circuit:
 * receptors -> kinase (compared against a slow memory) -> messenger -> flagellar motor.
 */
export const NEURON = {
  FOOD: 0, // input: attractant receptor (local food concentration, 0..1)
  TOXIN: 1, // input: repellent receptor (local toxin concentration, 0..1)
  ENERGY: 2, // input: internal hunger signal (1 - energy)
  MEMORY: 3, // slow neuron: "methylation" memory of recent concentration
  KINASE: 4, // compares now vs memory: is life getting better or worse?
  MESSENGER: 5, // relays the kinase verdict to the motors (CheY-P analogue)
  TUMBLE: 6, // output: probability of tumbling (random reorientation)
  RUN: 7, // output: swim speed
  SCENT: 8, // input: a neutral smell (0..1). Means nothing at birth; its meaning is LEARNED.
} as const;

export type NeuronKind = "sensor" | "inter" | "motor";

export interface NeuronInfo {
  index: number;
  id: keyof typeof NEURON;
  label: string;
  /** One plain sentence shown in the UI. */
  description: string;
  kind: NeuronKind;
  /** Suggested layout position for brain diagrams, each in -1..1 (x: left=inputs, right=outputs). */
  layout: { x: number; y: number };
}

/**
 * Continuous-time recurrent neural network genome.
 *   tau[i] * dy[i]/dt = -y[i] + sum_j( weights[j*N + i] * act[j] ) + input[i]
 *   act[i] = sigmoid(y[i] + bias[i])          (always 0..1)
 * weights[from * N + to]; positive = excitatory, negative = inhibitory.
 * Weights are kept within [-WEIGHT_MAX, WEIGHT_MAX].
 */
export interface Genome {
  weights: Float32Array; // length N*N
  bias: Float32Array; // length N
  tau: Float32Array; // length N, seconds
  /**
   * Which connections can learn during a lifetime. length N*N, same indexing as weights.
   * 0 = fixed wiring, > 0 = learning-rate multiplier for that connection. Inherited and mutated
   * like the rest of the genome. The designed genome marks only the SCENT pathway as plastic.
   */
  plastic: Float32Array;
}

export const WEIGHT_MAX = 8;

export interface Bacterium {
  id: number;
  x: number;
  z: number;
  /** Radians. Swim direction is (cos(heading), sin(heading)) in (x, z). */
  heading: number;
  /** Current speed in world units per second. */
  speed: number;
  tumbling: boolean;
  /** 0..1. Drains over time, refilled by eating. At 0 the cell is dead. */
  energy: number;
  alive: boolean;
  /** The INBORN brain. Not changed by learning; this is what offspring inherit. */
  genome: Genome;
  /**
   * The LIVE weights the brain actually runs on: inborn weights plus everything learned so far.
   * length N*N, same indexing as genome.weights. Views must draw these, and may compare with
   * genome.weights to show what experience has changed.
   */
  w: Float32Array;
  /**
   * Current reward signal, roughly -1..1: positive while eating, negative while being hurt by
   * toxin, decaying to 0 within about a second. This is what drives learning (dopamine analogue).
   */
  reward: number;
  /** Neuron internal state, length N. */
  y: Float32Array;
  /** Neuron activations 0..1, length N. This is what the brain view shows. */
  act: Float32Array;
  /** Per-neuron override: null = free, number = activation forced to that value (0..1). Length N. */
  clamp: (number | null)[];
  /** Score for evolution: food eaten minus toxin damage. */
  fitness: number;
  foodEaten: number;
  /** Recent positions, newest last: [x0, z0, x1, z1, ...]. Capped by the engine. */
  trail: number[];
  /** 0..1 hue for telling lineages apart. */
  hue: number;
}

/** "scent" is a neutral smell: it neither feeds nor hurts. Cells can only learn what it predicts. */
export type SourceKind = "food" | "toxin" | "scent";

/**
 * What the scent comes with. When not "none", every food (or toxin) source that appears, whether
 * spawned by the engine or dropped by the user, gets a scent source at the same spot with a
 * larger radius (the smell carries further than the thing itself), removed together with it.
 */
export type Pairing = "none" | "food" | "toxin";

export interface Source {
  id: number;
  kind: SourceKind;
  x: number;
  z: number;
  /** Gaussian spread in world units. */
  radius: number;
  /** Peak concentration 0..1. Food shrinks as it is eaten; removed at 0. */
  strength: number;
}

export interface GenerationStats {
  generation: number;
  best: number;
  mean: number;
  worst: number;
}

export type Mode = "solo" | "evolution";

/** World is a disc centered on the origin. Cells bounce off the wall. */
export const WORLD_RADIUS = 40;

export interface Engine {
  // ---- live state (mutable, read every frame, never replaced object identity for arrays) ----
  readonly bacteria: Bacterium[];
  readonly sources: Source[];
  readonly neurons: readonly NeuronInfo[];
  readonly history: GenerationStats[];
  readonly mode: Mode;
  readonly generation: number;
  /** Simulated seconds since last reset. */
  readonly time: number;
  /** Seconds left in the current generation (evolution mode), else 0. */
  readonly generationTimeLeft: number;
  /** Length of a generation in simulated seconds. */
  readonly generationLength: number;
  readonly selectedId: number | null;
  /**
   * Increments on every STRUCTURAL change: selection, mode, new generation, genome edit,
   * clamp change, source added/removed, reset, learning/pairing change, and whenever any live
   * weight of the SELECTED bacterium has drifted by 0.25 or more since the last increment
   * (so diagrams can refresh as learning progresses). Not incremented by ordinary stepping.
   */
  readonly version: number;

  // ---- simulation ----
  /** Advance by dt simulated seconds (sub-steps internally; safe for dt up to ~0.25). */
  step(dt: number): void;
  /** Concentrations at a point (each roughly 0..1). */
  sample(x: number, z: number): { food: number; toxin: number; scent: number };

  // ---- shape the world ----
  addSource(kind: SourceKind, x: number, z: number): Source;
  removeSource(id: number): void;
  clearSources(): void;

  // ---- poke the brain (all act on the selected bacterium; no-op if none) ----
  select(id: number | null): void;
  selected(): Bacterium | null;
  /** value null releases the neuron; 1 = stimulate, 0 = silence. */
  setClamp(neuron: number, value: number | null): void;
  /** Sets the inborn weight AND the live weight of that connection (discarding what it learned). */
  setWeight(from: number, to: number, value: number): void;
  /** Restore the hand-designed chemotaxis genome on the selected bacterium. */
  resetBrain(): void;
  /** Replace the selected bacterium's genome with random weights. */
  scrambleBrain(): void;

  // ---- learning (rung 2: the brain changes with experience) ----
  /** When false, live weights stay frozen at their current values. Default true. */
  readonly learning: boolean;
  setLearning(on: boolean): void;
  readonly pairing: Pairing;
  /** Changes what scent comes with; applies to existing sources immediately. */
  setPairing(pairing: Pairing): void;
  /** Selected bacterium forgets everything it learned: live weights return to the inborn ones. */
  forget(): void;

  // ---- modes ----
  /**
   * "solo": one bacterium with the designed brain (selected automatically).
   * "evolution": a population of random brains; generations advance automatically
   * when the timer runs out, and stats are pushed to `history`.
   */
  setMode(mode: Mode): void;
  /** End the current generation now and breed the next one. */
  nextGeneration(): void;
  /** Reset the current mode to its starting state. */
  reset(): void;

  /** Called after every structural change (same moments `version` increments). */
  subscribe(listener: () => void): () => void;
}
