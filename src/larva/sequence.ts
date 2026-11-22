import type { ClientMsg } from "../brainlink/protocol";

/** One timed action inside a plan. Times are simulated seconds from the start of the run. */
export interface Step {
  at: number;
  /** What is going on from this step until the next one (shown with the progress bar). */
  label: string;
  msg?: ClientMsg;
  /** Record the brain's current verdict for this odour id. */
  record?: number;
}

export interface Plan {
  name: string;
  duration: number;
  steps: Step[];
}

export interface Run {
  plan: Plan;
  t0: number;
  next: number;
}

export interface Tick {
  /** Updated run, or null when finished or cancelled. */
  run: Run | null;
  /** Steps whose time has come, in order. */
  due: Step[];
  progress: number;
  label: string;
  /** True when the run ended because simulated time went backwards (reset). */
  cancelled: boolean;
}

export const ODOUR_SECONDS = 6;
export const REWARD_AT = 3;
export const REWARD_SECONDS = 3;
export const TEST_SECONDS = 4;
export const TEST_READ_AT = 3.5;

export function teachPlan(odour: { id: number; label: string }, valence: 1 | -1): Plan {
  const what = valence > 0 ? "Reward" : "Punishment";
  return {
    name: `Teach: ${odour.label} + ${what.toLowerCase()}`,
    duration: ODOUR_SECONDS,
    steps: [
      { at: 0, label: `Smelling ${odour.label}`, msg: { type: "odour", odour: odour.id, seconds: ODOUR_SECONDS } },
      {
        at: REWARD_AT,
        label: `${what} with ${odour.label}`,
        msg: { type: "reward", value: valence, seconds: REWARD_SECONDS },
      },
    ],
  };
}

export function testPlan(odour: { id: number; label: string }): Plan {
  return {
    name: `Test: ${odour.label}`,
    duration: TEST_SECONDS,
    steps: [
      { at: 0, label: `Smelling ${odour.label}`, msg: { type: "odour", odour: odour.id, seconds: TEST_SECONDS } },
      { at: TEST_READ_AT, label: "Reading the verdict", record: odour.id },
    ],
  };
}

export function startRun(plan: Plan, simTime: number): Run {
  return { plan, t0: simTime, next: 0 };
}

export function tickRun(run: Run, simTime: number): Tick {
  const elapsed = simTime - run.t0;
  if (elapsed < 0) return { run: null, due: [], progress: 0, label: "", cancelled: true };
  const { steps, duration } = run.plan;
  let next = run.next;
  const due: Step[] = [];
  while (next < steps.length && steps[next].at <= elapsed) due.push(steps[next++]);
  const cur = next > 0 ? steps[next - 1].label : "";
  const progress = Math.min(1, elapsed / duration);
  const done = next >= steps.length && elapsed >= duration;
  return { run: done ? null : { ...run, next }, due, progress, label: cur, cancelled: false };
}
