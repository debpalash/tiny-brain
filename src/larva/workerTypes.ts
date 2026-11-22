import type { ServerMsg } from "../brainlink/protocol";

export type WorkerIn = { kind: "start"; url: string } | { kind: "stop" } | { kind: "send"; text: string };

export type WorkerOut =
  | { kind: "state"; state: "connecting" | "connected" | "offline" | "mismatch"; engineProtocol?: number }
  | { kind: "msg"; msg: ServerMsg }
  | { kind: "frame"; buffer: ArrayBuffer; seq: number; simTime: number };
