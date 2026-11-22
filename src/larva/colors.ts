import type { GroupKind } from "../brainlink/protocol";
import { theme } from "../theme";

/** Muted base colour per group kind, all from the shared theme. */
export const KIND_COLOR: Record<GroupKind, string> = {
  sensor: theme.sensor,
  inter: theme.inter,
  motor: theme.motor,
  reward: theme.scent,
  other: theme.textDim,
};

/** Plain words for each kind, used in the pathway strip tooltips. */
export const KIND_WORD: Record<GroupKind, string> = {
  sensor: "senses",
  inter: "thinking",
  motor: "action",
  reward: "reward signal",
  other: "other",
};
