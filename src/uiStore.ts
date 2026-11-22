/**
 * SHARED CONTRACT. Owned by the project lead. UI-only state (the simulation lives in `engine`).
 */
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { engine } from "./engine";

/** What a click on the dish does. */
export type Tool = "food" | "toxin" | "scent" | "erase" | "select";

interface UiState {
  paused: boolean;
  /** Simulation speed multiplier: 1, 2, 4, 8, 16. */
  speed: number;
  tool: Tool;
  /** Neuron highlighted in the brain panel (inspector target), or null. */
  focusNeuron: number | null;
  setPaused(paused: boolean): void;
  setSpeed(speed: number): void;
  setTool(tool: Tool): void;
  setFocusNeuron(neuron: number | null): void;
}

export const useUi = create<UiState>((set) => ({
  paused: false,
  speed: 1,
  tool: "food",
  focusNeuron: null,
  setPaused: (paused) => set({ paused }),
  setSpeed: (speed) => set({ speed }),
  setTool: (tool) => set({ tool }),
  setFocusNeuron: (focusNeuron) => set({ focusNeuron }),
}));

/**
 * Re-renders the calling component on every STRUCTURAL engine change
 * (selection, mode, generation, genome edit, sources...). Returns engine.version.
 * For per-frame values (positions, activations) read `engine` inside useFrame / rAF instead.
 */
export function useEngineVersion(): number {
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.version,
  );
}
