import type { HelloMsg, StatsMsg } from "../brainlink/protocol";

export const VERDICT_EDGE = 0.15;

export type Verdict = "approach" | "avoid" | "indifferent";

export function verdictOf(approach: number): Verdict {
  return approach > VERDICT_EDGE ? "approach" : approach < -VERDICT_EDGE ? "avoid" : "indifferent";
}

export interface SavedVerdict {
  odour: number;
  approach: number;
}

/** Strength of the first plastic pathway (1 = unchanged), or null if there is none. */
export function plasticStrength(hello: HelloMsg, stats: StatsMsg): number | null {
  const i = hello.pathways.findIndex((p) => p.plastic);
  return i >= 0 && i < stats.pathwayStrength.length ? stats.pathwayStrength[i] : null;
}

/** One plain sentence saying what is happening right now. */
export function liveSentence(hello: HelloMsg | null, stats: StatsMsg | null, last: SavedVerdict | null = null): string {
  if (!hello || !stats) return "Waiting for the brain to report.";
  if (stats.paused) return "Paused. Nothing is changing until you press play.";
  const name = (id: number | null): string => hello.odours.find((o) => o.id === id)?.label ?? "a smell";
  const v = verdictOf(stats.approach);
  const REWARD_EDGE = 0.05;
  if (stats.odour !== null) {
    const n = name(stats.odour);
    if (Math.abs(stats.reward) > REWARD_EDGE) {
      const kind = stats.reward > 0 ? "Reward" : "Punishment";
      if (!stats.learning) return `${kind} given with ${n}, but learning is off, so nothing is remembered.`;
      const s = plasticStrength(hello, stats);
      const trend = s === null || Math.abs(s - 1) < 0.001 ? "changing" : s < 1 ? "weakening" : "strengthening";
      return `${kind} given with ${n}: the link from memory cells to output neurons is ${trend}.`;
    }
    if (v === "indifferent") return `Smelling ${n}. The brain is indifferent to it.`;
    return `Smelling ${n}. The brain leans towards ${v === "approach" ? "approaching" : "avoiding"} it.`;
  }
  if (Math.abs(stats.reward) > REWARD_EDGE) {
    return `${stats.reward > 0 ? "Reward" : "Punishment"} given without a smell, so there is nothing to link it to.`;
  }
  if (stats.stimuli.length > 0) {
    const g = hello.groups.find((x) => x.id === stats.stimuli[0].group);
    return `Driving ${g ? g.label.toLowerCase() : "a group"} directly.`;
  }
  if (last) {
    const lv = verdictOf(last.approach);
    return `Verdict on ${name(last.odour)}: ${lv}.`;
  }
  return "Resting. Present a smell to see what the brain makes of it.";
}
