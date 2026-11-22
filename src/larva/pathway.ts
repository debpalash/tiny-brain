import type { GroupKind, HelloMsg } from "../brainlink/protocol";

export interface Stage {
  /** Index into hello.groups. */
  group: number;
  role: "sensor" | "relay" | "memory" | "output" | "reward";
  /** Plain name used when the engine group label is missing a better one. */
  kind: GroupKind;
}

export interface Strip {
  /** Left-to-right main path (some may be missing). */
  main: Stage[];
  reward: Stage | null;
  /** Index into hello.pathways of the learnable link (memory -> output), or -1. */
  plasticPathway: number;
}

/** Work out the sensors -> relay -> memory -> output strip, plus reward, from the group list. */
export function buildStrip(hello: HelloMsg): Strip {
  const idx = (id: number): number => hello.groups.findIndex((g) => g.id === id);
  const plasticPathway = hello.pathways.findIndex((p) => p.plastic);
  const plastic = plasticPathway >= 0 ? hello.pathways[plasticPathway] : null;
  const memory = plastic ? idx(plastic.fromGroup) : -1;
  const output = plastic ? idx(plastic.toGroup) : -1;
  const sensor = hello.groups.findIndex((g) => g.kind === "sensor");
  const reward = hello.groups.findIndex((g) => g.kind === "reward");
  let relay = -1;
  if (memory >= 0) {
    const into = hello.pathways.find((p) => p.toGroup === hello.groups[memory].id && idx(p.fromGroup) !== sensor);
    relay = into ? idx(into.fromGroup) : -1;
    if (relay < 0 && sensor >= 0) {
      const via = hello.pathways.find((p) => idx(p.fromGroup) === sensor && idx(p.toGroup) !== memory);
      relay = via ? idx(via.toGroup) : -1;
    }
  }
  const stage = (group: number, role: Stage["role"]): Stage[] =>
    group >= 0 ? [{ group, role, kind: hello.groups[group].kind }] : [];
  return {
    main: [...stage(sensor, "sensor"), ...stage(relay, "relay"), ...stage(memory, "memory"), ...stage(output, "output")],
    reward: reward >= 0 ? { group: reward, role: "reward", kind: "reward" } : null,
    plasticPathway,
  };
}
