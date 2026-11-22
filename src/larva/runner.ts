import { create } from "zustand";
import { onFrame, recordVerdict, send, useLarva, activity } from "./link";
import { startRun, tickRun } from "./sequence";
import type { Plan, Run } from "./sequence";

interface RunnerState {
  name: string;
  label: string;
  progress: number;
  active: boolean;
}

export const useRunner = create<RunnerState>(() => ({ name: "", label: "", progress: 0, active: false }));

let run: Run | null = null;
let lastShown = -1;

function tick(): void {
  if (!run) return;
  const t = tickRun(run, activity.simTime);
  for (const s of t.due) {
    if (s.msg) send(s.msg);
    if (s.record !== undefined) {
      const st = useLarva.getState().stats;
      if (st) recordVerdict(s.record, st.approach);
    }
  }
  run = t.run;
  // Update the UI at most about 10 times per second.
  const bucket = Math.floor(t.progress * 20);
  if (run === null) {
    useRunner.setState({ active: false, progress: t.cancelled ? 0 : 1, label: "" });
    lastShown = -1;
  } else if (bucket !== lastShown) {
    lastShown = bucket;
    useRunner.setState({ progress: t.progress, label: t.label });
  }
}

let started = false;
/** Hook the runner to activity frames (they carry simulated time at up to 30 per second). */
export function initRunner(): () => void {
  if (started) return () => {};
  started = true;
  const off = onFrame(tick);
  return () => {
    off();
    started = false;
    run = null;
    useRunner.setState({ active: false, progress: 0, label: "", name: "" });
  };
}

export function startPlan(plan: Plan): void {
  run = startRun(plan, activity.simTime);
  lastShown = -1;
  useRunner.setState({ name: plan.name, active: true, progress: 0, label: plan.steps[0]?.label ?? "" });
  tick();
}

export function cancelPlan(): void {
  if (!run) return;
  run = null;
  send({ type: "clearStimuli" });
  useRunner.setState({ active: false, progress: 0, label: "" });
}
