import { create } from "zustand";
import { DEFAULT_URL } from "../brainlink/protocol";
import type { ClientMsg, HelloMsg, NeuronDetailMsg, NeuronsMsg, StatsMsg } from "../brainlink/protocol";
import { ACTIVITY_HEADER_BYTES } from "../brainlink/protocol";
import type { SavedVerdict } from "./sentence";
import type { WorkerIn, WorkerOut } from "./workerTypes";

export type ConnState = "connecting" | "connected" | "offline" | "mismatch";

/** How many stats samples (about 5 per second) the approach history keeps. */
export const HISTORY_LEN = 240;

interface LarvaState {
  conn: ConnState;
  /** Protocol version the engine reported when it did not match ours. */
  engineProtocol: number | null;
  hello: HelloMsg | null;
  neurons: NeuronsMsg | null;
  stats: StatsMsg | null;
  detail: NeuronDetailMsg | null;
  error: string | null;
  /** Neuron chosen for inspection (click), or null. */
  selected: number | null;
  /** Neuron under the pointer, or null. */
  hovered: number | null;
  /** Group emphasised everywhere; every other group is dimmed. */
  focusGroup: number | null;
  /** Recent `approach` samples, oldest first. */
  history: number[];
  /** Last verdict recorded by a Test run. */
  verdict: SavedVerdict | null;
  /** Verdicts recorded per odour id, oldest first: the before/after record. */
  verdicts: { odour: number; approach: number }[];
}

export const useLarva = create<LarvaState>(() => ({
  conn: "connecting",
  engineProtocol: null,
  hello: null,
  neurons: null,
  stats: null,
  detail: null,
  error: null,
  selected: null,
  hovered: null,
  focusGroup: null,
  history: [],
  verdict: null,
  verdicts: [],
}));

/**
 * The newest activity frame. Read it inside useFrame / rAF; it never goes through React state.
 * `bytes` is a view into the transferred buffer (no copy); `version` bumps on every new frame.
 */
export const activity: { bytes: Uint8Array | null; seq: number; simTime: number; version: number } = {
  bytes: null,
  seq: -1,
  simTime: 0,
  version: 0,
};

const frameListeners = new Set<() => void>();
/** Called (outside React) whenever a newer activity frame has been stored. */
export function onFrame(fn: () => void): () => void {
  frameListeners.add(fn);
  return () => frameListeners.delete(fn);
}

let worker: Worker | null = null;

export function send(msg: ClientMsg): void {
  const m: WorkerIn = { kind: "send", text: JSON.stringify(msg) };
  worker?.postMessage(m);
}

function resetData(): void {
  activity.bytes = null;
  activity.seq = -1;
  useLarva.setState({
    hello: null,
    neurons: null,
    stats: null,
    detail: null,
    selected: null,
    hovered: null,
    focusGroup: null,
    history: [],
    verdict: null,
    verdicts: [],
    error: null,
  });
}

function handle(m: WorkerOut): void {
  if (m.kind === "state") {
    if (m.state === "offline" || m.state === "mismatch" || m.state === "connecting") resetData();
    useLarva.setState({ conn: m.state, engineProtocol: m.engineProtocol ?? null });
    return;
  }
  if (m.kind === "frame") {
    if (m.buffer.byteLength < ACTIVITY_HEADER_BYTES) return;
    activity.bytes = new Uint8Array(m.buffer, ACTIVITY_HEADER_BYTES);
    activity.seq = m.seq;
    activity.simTime = m.simTime;
    activity.version++;
    for (const f of frameListeners) f();
    return;
  }
  const msg = m.msg;
  switch (msg.type) {
    case "hello":
      resetData();
      useLarva.setState({ hello: msg });
      break;
    case "neurons": {
      const h = useLarva.getState().hello;
      if (h && msg.group.length === h.network.neurons) useLarva.setState({ neurons: msg });
      break;
    }
    case "stats": {
      const s = useLarva.getState();
      // Simulated time going backwards means a reset: start the history again.
      const rewound = s.stats !== null && msg.simTime < s.stats.simTime - 0.5;
      const prev = rewound ? [] : s.history;
      const history = prev.length >= HISTORY_LEN ? prev.slice(prev.length - HISTORY_LEN + 1) : prev.slice();
      history.push(msg.approach);
      useLarva.setState(rewound ? { stats: msg, history, verdict: null, verdicts: [] } : { stats: msg, history });
      break;
    }
    case "neuronDetail":
      if (msg.neuron === useLarva.getState().selected) useLarva.setState({ detail: msg });
      break;
    case "error":
      useLarva.setState({ error: msg.message });
      break;
  }
}

/** Start the connection (idempotent). Call `disconnect` when the larva view goes away. */
export function connect(url: string = DEFAULT_URL): void {
  if (worker) return;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerOut>) => handle(e.data);
  const m: WorkerIn = { kind: "start", url };
  worker.postMessage(m);
}

export function disconnect(): void {
  if (!worker) return;
  const m: WorkerIn = { kind: "stop" };
  worker.postMessage(m);
  worker.terminate();
  worker = null;
  useLarva.setState({ conn: "connecting" });
  resetData();
}

// ----------------------------------------------------------------- selection helpers

export function selectNeuron(n: number | null): void {
  const s = useLarva.getState();
  if (s.selected === n) return;
  useLarva.setState({ selected: n, detail: null });
  send({ type: "inspect", neuron: n });
}

export function setHovered(n: number | null): void {
  if (useLarva.getState().hovered !== n) useLarva.setState({ hovered: n });
}

export function toggleFocusGroup(g: number): void {
  useLarva.setState((s) => ({ focusGroup: s.focusGroup === g ? null : g }));
}

export function recordVerdict(odour: number, approach: number): void {
  useLarva.setState((s) => ({
    verdict: { odour, approach },
    verdicts: [...s.verdicts.slice(-19), { odour, approach }],
  }));
}
