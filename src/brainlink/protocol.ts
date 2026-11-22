/**
 * SHARED CONTRACT. Owned by the project lead. Do not change without asking.
 *
 * Wire protocol between the native brain engine (C++, `native/`) and this web app.
 * The engine is the WebSocket SERVER on ws://127.0.0.1:8787 and serves one viewer at a time.
 * The C++ side mirrors this file in `native/src/protocol.h`; the two must be changed together.
 *
 * Two kinds of message:
 *   - TEXT frames: JSON, one object per frame, discriminated by `type`. Low rate.
 *   - BINARY frames: live activity, little-endian, layout in ACTIVITY_FRAME below. Up to 30 per second.
 *     The viewer must always draw the NEWEST frame and drop older ones (never queue).
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_URL = "ws://127.0.0.1:8787";

/** Broad role of a group of neurons. Drives colour and column in the viewer. */
export type GroupKind = "sensor" | "inter" | "motor" | "reward" | "other";

/** A named set of neurons the user can understand and act on (e.g. "Smell sensors", "Kenyon cells"). */
export interface NeuronGroup {
  id: number;
  /** Plain-language label shown in the UI. */
  label: string;
  /** Scientific name, shown secondary (e.g. "Olfactory receptor neurons"). */
  scientific: string;
  /** One plain sentence: what this group does. */
  description: string;
  kind: GroupKind;
  count: number;
  /** Whether the user may stimulate this group directly. */
  stimulable: boolean;
}

/** A learnable pathway whose strength the viewer can chart (e.g. Kenyon cells -> output neurons). */
export interface Pathway {
  id: number;
  label: string;
  fromGroup: number;
  toGroup: number;
  synapses: number;
  plastic: boolean;
}

/** A smell the user can present (e.g. "Odour A"). Neutral at the start; its meaning is learned. */
export interface Odour {
  id: number;
  label: string;
  /** How many smell-sensor neurons it activates. */
  sensors: number;
}

// ---------------------------------------------------------------- server -> viewer (JSON)

/** First message after connect. */
export interface HelloMsg {
  type: "hello";
  protocol: number;
  network: {
    name: string;
    neurons: number;
    synapses: number;
    /** Where the wiring came from, shown in the UI, e.g. "Winding et al. 2023". */
    source: string;
    /** Honest notes for the UI, e.g. "Excitatory/inhibitory signs are assumed, not measured". */
    caveats: string[];
  };
  /** Simulation timestep in milliseconds. */
  dtMs: number;
  groups: NeuronGroup[];
  pathways: Pathway[];
  /** Smells the user can present. Each one activates its own subset of the smell sensors. */
  odours: Odour[];
}

/**
 * Static per-neuron table, sent once right after `hello`. Parallel arrays of length `neurons`.
 * Positions are in the dataset's own units, already centred on the origin; the viewer rescales.
 * `hasPosition[i] === 0` means the position is unknown (the viewer must lay such neurons out
 * itself and say so; it must not pretend they are real coordinates).
 */
export interface NeuronsMsg {
  type: "neurons";
  group: number[];
  /** -1 left, 0 centre/unknown, 1 right. */
  side: number[];
  x: number[];
  y: number[];
  z: number[];
  hasPosition: number[];
  /** 1 excitatory, -1 inhibitory, as used by the simulation. */
  sign: number[];
  /** 1 if `sign` comes from data, 0 if it is an assumption. */
  signKnown: number[];
  name: string[];
}

/** About 5 per second while running. Everything the status strip and charts need. */
export interface StatsMsg {
  type: "stats";
  simTime: number;
  /** Simulated seconds per wall-clock second actually achieved. */
  realtimeFactor: number;
  paused: boolean;
  learning: boolean;
  /** Target speed: simulated seconds per wall second (the engine may fall short). */
  speed: number;
  /** Mean firing rate in Hz of each group, same order as `hello.groups`. */
  groupRateHz: number[];
  /** Mean weight of each pathway relative to its starting value (1 = unchanged). */
  pathwayStrength: number[];
  /** Current reward signal, -1..1 (positive = reward being given, negative = punishment). */
  reward: number;
  /**
   * The brain's current verdict on what it smells, -1..1: positive = "approach", negative = "avoid",
   * near 0 = indifferent. Read out from the mushroom-body output neurons. It is the engine's
   * summary of the output neurons, not a measured behaviour.
   */
  approach: number;
  /** Odour being presented right now (id from `hello.odours`), or null. */
  odour: number | null;
  odourSecondsLeft: number;
  /** Active group stimuli, so the UI can show what is being applied right now. */
  stimuli: { group: number; rateHz: number; secondsLeft: number }[];
}

export interface LinkPartner {
  neuron: number;
  /** Synapse count from the connectome. */
  synapses: number;
  /** Current weight relative to its starting value (1 = unchanged). */
  strength: number;
}

/** Reply to `inspect`, then resent about once a second while that neuron stays inspected. */
export interface NeuronDetailMsg {
  type: "neuronDetail";
  neuron: number;
  rateHz: number;
  /** Strongest incoming and outgoing partners, at most 12 each, strongest first. */
  inputs: LinkPartner[];
  outputs: LinkPartner[];
  inDegree: number;
  outDegree: number;
}

export interface ErrorMsg {
  type: "error";
  message: string;
}

export type ServerMsg = HelloMsg | NeuronsMsg | StatsMsg | NeuronDetailMsg | ErrorMsg;

// ---------------------------------------------------------------- viewer -> server (JSON)

export type ClientMsg =
  | { type: "setPaused"; paused: boolean }
  /** Simulated seconds per wall second: 0.1, 0.25, 0.5, 1, 2, 4. */
  | { type: "setSpeed"; speed: number }
  | { type: "setLearning"; on: boolean }
  /** Drive every neuron of a group with extra input spikes at `rateHz` for `seconds`. */
  | { type: "stimulate"; group: number; rateHz: number; seconds: number }
  /** Present one odour (id from `hello.odours`) for `seconds`. Replaces any odour already present. */
  | { type: "odour"; odour: number; seconds: number }
  /** Deliver reward (value > 0) or punishment (value < 0), -1..1, for `seconds`. */
  | { type: "reward"; value: number; seconds: number }
  /** Stop all stimuli and reward. */
  | { type: "clearStimuli" }
  /** Start (or with null, stop) streaming `neuronDetail` for one neuron. */
  | { type: "inspect"; neuron: number | null }
  /** Forget everything learned: weights back to their starting values. Activity keeps running. */
  | { type: "forget" }
  /** Restart the simulation from time 0 with starting weights. */
  | { type: "reset" };

// ---------------------------------------------------------------- binary activity frame

/**
 * BINARY frame layout (little-endian):
 *   offset 0   u32  magic      = ACTIVITY_MAGIC
 *   offset 4   u32  sequence   increments by 1 per frame sent
 *   offset 8   f64  simTime    simulated seconds
 *   offset 16  u32  count      number of neurons (== hello.network.neurons)
 *   offset 20  u8[count]       activity per neuron, 0..255
 *
 * activity = round(255 * min(1, rate / ACTIVITY_FULL_SCALE_HZ)) where `rate` is the neuron's
 * firing rate smoothed over about 100 ms of simulated time. It is a display value, not data.
 */
export const ACTIVITY_MAGIC = 0x314e5242; // "BRN1"
export const ACTIVITY_HEADER_BYTES = 20;
export const ACTIVITY_FULL_SCALE_HZ = 50;
