import type { NeuronInfo } from "./types";

export const NEURONS: readonly NeuronInfo[] = [
  {
    index: 0,
    id: "FOOD",
    label: "Food sensor",
    description: "Smells food. The stronger the food scent right here, the more active it is.",
    kind: "sensor",
    layout: { x: -1, y: -0.7 },
  },
  {
    index: 1,
    id: "TOXIN",
    label: "Toxin sensor",
    description: "Detects poison in the water. It fires harder the closer the cell gets to toxin.",
    kind: "sensor",
    layout: { x: -1, y: -0.05 },
  },
  {
    index: 2,
    id: "ENERGY",
    label: "Hunger",
    description: "Feels how empty the cell's energy tank is. Hungrier means more active.",
    kind: "sensor",
    layout: { x: -1, y: 0.65 },
  },
  {
    index: 3,
    id: "MEMORY",
    label: "Memory",
    description: "A slow neuron that remembers what the food smell was like a few seconds ago.",
    kind: "inter",
    layout: { x: -0.35, y: -0.6 },
  },
  {
    index: 4,
    id: "KINASE",
    label: "Better or worse?",
    description: "Compares the smell now with the memory: active when things are improving.",
    kind: "inter",
    layout: { x: -0.1, y: 0.1 },
  },
  {
    index: 5,
    id: "MESSENGER",
    label: "Messenger",
    description:
      "Passes the verdict on to the motors, flipping it so 'worse' means 'change course'.",
    kind: "inter",
    layout: { x: 0.4, y: -0.1 },
  },
  {
    index: 6,
    id: "TUMBLE",
    label: "Tumble",
    description: "When active the cell stops and spins to pick a new random direction.",
    kind: "motor",
    layout: { x: 1, y: -0.45 },
  },
  {
    index: 7,
    id: "RUN",
    label: "Run",
    description: "Sets how fast the cell swims in a straight line.",
    kind: "motor",
    layout: { x: 1, y: 0.5 },
  },
  {
    index: 8,
    id: "SCENT",
    label: "Scent sensor",
    description:
      "Smells a neutral scent that means nothing at birth; the cell can learn what it predicts.",
    kind: "sensor",
    layout: { x: -1, y: 0.3 },
  },
];
