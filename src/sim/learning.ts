import { N, WEIGHT_MAX } from "./types";
import type { Bacterium } from "./types";

/**
 * Lifetime learning: a reward-modulated Hebbian rule with an eligibility trace.
 *
 *   trace[j]   = low-pass (traceTau) of max(0, act[j] - slowBaseline[j])     ("pre-synaptic activity above its baseline")
 *   dw[j->i]/t = rate * plastic[j->i] * reward * trace[j]  (soft-bounded towards +/-WEIGHT_MAX)
 *
 * Without a post-synaptic term the eligibility of every connection leaving neuron j is the same
 * number, so one trace per neuron is stored instead of N*N of them (identical maths, 9 floats).
 */
export const LEARN = {
  /** Reward decays to 0 with this time constant (s). */
  rewardTau: 0.4,
  /** Reward per unit of food intake rate (food units/s; the peak rate is EAT_RATE = 0.6). */
  eatGain: 3.3,
  /** Negative reward per unit of toxin concentration. */
  toxGain: 2.5,
  /** Eligibility trace time constant (s). */
  traceTau: 2,
  /** Time constant of the slow baseline that pre-synaptic activity is compared against (s). */
  baseTau: 20,
  /** Weight change per second at plastic = 1, reward = 1, trace = 1. */
  rate: 40,
  /** Activity changes smaller than this are ignored (far-field noise of the log receptor). */
  /** Learning pushes a weight towards +/-softMax (hard limit is WEIGHT_MAX). */
  softMax: 6,
  devDeadband: 0.03,
  /** Rewards weaker than this do not teach. */
  rewardDeadband: 0.1,
};

export interface LearnState {
  trace: Float32Array;
  base: Float32Array;
}

const states = new WeakMap<Bacterium, LearnState>();

export function learnState(b: Bacterium): LearnState {
  let s = states.get(b);
  if (!s) {
    s = { trace: new Float32Array(N), base: new Float32Array(N) };
    states.set(b, s);
  }
  return s;
}

/** Forget transient learning state (reward, traces); baselines start at the current activity. */
export function resetLearnState(b: Bacterium): void {
  const s = learnState(b);
  s.trace.fill(0);
  s.base.set(b.act);
  b.reward = 0;
}

/** Low-pass the reward: positive while eating (intake in food units/s), negative in toxin. */
export function stepReward(b: Bacterium, h: number, intakeRate: number, toxin: number): void {
  const drive = LEARN.eatGain * intakeRate - LEARN.toxGain * (toxin > 0.001 ? toxin : 0);
  let r = b.reward + h * (drive - b.reward / LEARN.rewardTau);
  if (r > 1) r = 1;
  else if (r < -1) r = -1;
  b.reward = Math.abs(r) < 1e-4 ? 0 : r;
}

/** Update traces every step; change live weights only when `learning`. Allocation-free. */
export function stepLearning(b: Bacterium, s: LearnState, h: number, learning: boolean): void {
  const { act } = b;
  const { trace, base } = s;
  const kt = h / LEARN.traceTau;
  const kb = h / LEARN.baseTau;
  for (let j = 0; j < N; j++) {
    const a = act[j] as number;
    const bj = base[j] as number;
    const d = a - bj;
    const dev =
      d > LEARN.devDeadband
        ? d - LEARN.devDeadband
        : d < -LEARN.devDeadband
          ? d + LEARN.devDeadband
          : 0;
    trace[j] = (trace[j] as number) + kt * (dev - (trace[j] as number));
    base[j] = bj + kb * (a - bj);
  }
  const raw = b.reward;
  const reward =
    raw > LEARN.rewardDeadband
      ? raw - LEARN.rewardDeadband
      : raw < -LEARN.rewardDeadband
        ? raw + LEARN.rewardDeadband
        : 0;
  if (!learning || reward === 0) return;
  const { plastic } = b.genome;
  const w = b.w;
  const k = LEARN.rate * reward * h;
  for (let j = 0; j < N; j++) {
    const e = trace[j] as number;
    if (e < 1e-4 && e > -1e-4) continue;
    for (let i = 0; i < N; i++) {
      const p = plastic[j * N + i] as number;
      if (p <= 0) continue;
      const idx = j * N + i;
      const cur = w[idx] as number;
      let dw = k * p * e;
      // soft bound: learning slows as a weight nears its limit
      const room = 1 - (dw > 0 ? cur : -cur) / LEARN.softMax;
      dw *= room > 0 ? room : 0;
      const v = cur + dw;
      w[idx] = v > WEIGHT_MAX ? WEIGHT_MAX : v < -WEIGHT_MAX ? -WEIGHT_MAX : v;
    }
  }
}
