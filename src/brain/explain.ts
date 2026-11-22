/** Plain-language description of what the cell is doing. Pure: easy to read and tweak. */

export interface Held {
  id: string;
  label: string;
  on: boolean;
}

export interface Snapshot {
  alive: boolean;
  tumbling: boolean;
  foodNow: number;
  foodThen: number; // about one second ago
  toxinNow: number;
  toxinThen: number;
  kinaseNow: number;
  kinaseAvg: number; // average over the last few seconds
  scentNow: number;
  /** Live minus inborn weight of the Scent to Kinase link (0 when there is no scent neuron). */
  scentLearned: number;
  /** Change of that live weight over about two seconds. */
  scentRise: number;
}

export type Situation = "dead" | "toxin" | "worse" | "tumbling" | "rising" | "falling" | "scentLearning" | "scentHurt" | "scentFollow" | "scentAvoid" | "calm";

/** A piece of the sentence; `n` names the neuron it talks about (matches NeuronInfo.id). */
export interface Part {
  t: string;
  n?: string;
}

/**
 * Hysteresis: each pair is [enter, stay]. A situation is entered at the first (stricter)
 * threshold and kept until the signal falls back below the second (looser) one.
 */
const TREND = [0.012, 0.005]; // food change per second that counts as rising / falling
const TOXIN_LEVEL = [0.3, 0.18];
const KINASE_DROP = [0.03, 0.015];
const SCENT_RISE = [0.1, 0.04]; // live-weight change over ~2 s that counts as "learning right now"
const SCENT_LEARNED = [0.5, 0.3]; // learned offset that counts as "has learned"
const SCENT_PRESENT = 0.1;

export function classify(s: Snapshot, prev: Situation): Situation {
  const dFood = s.foodNow - s.foodThen;
  const dToxin = s.toxinNow - s.toxinThen;
  const pick = (pair: number[], was: boolean) => (was ? pair[1] : pair[0]);
  if (!s.alive) return "dead";
  if (s.toxinNow > pick(TOXIN_LEVEL, prev === "toxin") && dToxin > -(prev === "toxin" ? 0.02 : 0.01)) return "toxin";
  if (s.tumbling) {
    const bad =
      dFood < -pick(TREND, prev === "worse") || s.kinaseNow < s.kinaseAvg - pick(KINASE_DROP, prev === "worse");
    return bad ? "worse" : "tumbling";
  }
  if (s.scentRise > pick(SCENT_RISE, prev === "scentLearning")) return "scentLearning";
  if (s.scentRise < -pick(SCENT_RISE, prev === "scentHurt")) return "scentHurt";
  if (s.scentNow > SCENT_PRESENT) {
    if (s.scentLearned > pick(SCENT_LEARNED, prev === "scentFollow")) return "scentFollow";
    if (s.scentLearned < -pick(SCENT_LEARNED, prev === "scentAvoid")) return "scentAvoid";
  }
  if (dFood > pick(TREND, prev === "rising")) return "rising";
  if (dFood < -pick(TREND, prev === "falling")) return "falling";
  return "calm";
}

export function sentence(sit: Situation, held: Held[]): Part[] {
  let parts: Part[];
  switch (sit) {
    case "dead":
      parts = [{ t: "This cell has run out of energy." }];
      break;
    case "toxin":
      parts = [{ t: "Toxin", n: "TOXIN" }, { t: " nearby: it turns away more often." }];
      break;
    case "worse":
      parts = [
        { t: "Things are getting worse", n: "KINASE" },
        { t: ", so it " },
        { t: "tumbles", n: "TUMBLE" },
        { t: " to try a new direction." },
      ];
      break;
    case "tumbling":
      parts = [{ t: "It is " }, { t: "tumbling", n: "TUMBLE" }, { t: " to pick a new direction." }];
      break;
    case "rising":
      parts = [
        { t: "Food", n: "FOOD" },
        { t: " is getting stronger, so it keeps " },
        { t: "swimming", n: "RUN" },
        { t: " straight." },
      ];
      break;
    case "scentLearning":
      parts = [
        { t: "It just ate while smelling the " },
        { t: "scent", n: "SCENT" },
        { t: ", so scent now means \"food nearby\"." },
      ];
      break;
    case "scentHurt":
      parts = [
        { t: "It was hurt while smelling the " },
        { t: "scent", n: "SCENT" },
        { t: ", so it is learning to avoid it." },
      ];
      break;
    case "scentFollow":
      parts = [
        { t: "It follows the " },
        { t: "scent", n: "SCENT" },
        { t: " because it has learned scent leads to food." },
      ];
      break;
    case "scentAvoid":
      parts = [{ t: "It has learned to avoid the " }, { t: "scent", n: "SCENT" }, { t: "." }];
      break;
    case "falling":
      parts = [{ t: "Food", n: "FOOD" }, { t: " is fading, so it will soon tumble to look for a better direction." }];
      break;
    default:
      parts = [{ t: "Nothing is changing, so it wanders." }];
  }
  if (held.length > 0) {
    parts.push({ t: " You are holding " });
    held.slice(0, 2).forEach((h, k) => {
      if (k > 0) parts.push({ t: " and " });
      parts.push({ t: h.label, n: h.id }, { t: h.on ? " on" : " off" });
    });
    if (held.length > 2) parts.push({ t: ` and ${held.length - 2} more` });
    parts.push({ t: "." });
  }
  return parts;
}
