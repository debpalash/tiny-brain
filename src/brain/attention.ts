import { create } from "zustand";
import { engine } from "../engine";
import type { NEURON } from "../sim/types";
import { useUi } from "../uiStore";

/** Transient attention state shared by the diagram, the traces and the sentence. */
interface Attention {
  /** Neuron under the pointer or keyboard focus. */
  hot: number | null;
  /** Neurons to highlight while a Guide step is hovered. */
  guide: number[] | null;
  showWeak: boolean;
  setHot: (n: number | null) => void;
  setGuide: (n: number[] | null) => void;
  setShowWeak: (v: boolean) => void;
}

export const useAttention = create<Attention>((set) => ({
  hot: null,
  guide: null,
  showWeak: false,
  setHot: (hot) => set((s) => (s.hot === hot ? s : { hot })),
  setGuide: (guide) => set({ guide }),
  setShowWeak: (showWeak) => set({ showWeak }),
}));

/** The one neuron that is emphasised right now (hover beats selection), or null. */
export function activeNeuron(): number | null {
  return useAttention.getState().hot ?? useUi.getState().focusNeuron;
}

export function neuronIndex(id: keyof typeof NEURON): number {
  return engine.neurons.findIndex((n) => n.id === id);
}

export const ROLE_NAME = { sensor: "Sense", inter: "Thinking", motor: "Action" } as const;

/** True when the cell has any learnable link leaving the Scent sensor. */
export function hasScentLearning(b: { genome: { plastic: Float32Array } } | null): boolean {
  const si = neuronIndex("SCENT");
  if (!b || si < 0) return false;
  for (let j = 0; j < engine.neurons.length; j++) if (b.genome.plastic[si * engine.neurons.length + j] > 0) return true;
  return false;
}
