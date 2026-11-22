/// Web Worker: owns the WebSocket so parsing and socket I/O never touch the render thread.
/// Keeps only the NEWEST binary frame and forwards it at most ~60 times a second.
import { PROTOCOL_VERSION } from "../brainlink/protocol";
import { parseActivityFrame, parseServerMsg } from "./frames";
import type { WorkerIn, WorkerOut } from "./workerTypes";

interface Scope {
  postMessage(m: WorkerOut, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
}
const ctx = self as unknown as Scope;

let url = "";
let ws: WebSocket | null = null;
let wanted = false;
let expected = -1;
let backoff = 500;
let retry: ReturnType<typeof setTimeout> | undefined;
let pending: { buf: ArrayBuffer; seq: number; simTime: number } | null = null;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let lastState: WorkerOut | null = null;
let lastSeq = -1;

function state(s: "connecting" | "connected" | "offline" | "mismatch", engineProtocol?: number): void {
  if (lastState && lastState.kind === "state" && lastState.state === s && lastState.engineProtocol === engineProtocol) return;
  lastState = { kind: "state", state: s, engineProtocol };
  ctx.postMessage(lastState);
}

function flush(): void {
  flushTimer = undefined;
  if (!pending) return;
  const p = pending;
  pending = null;
  ctx.postMessage({ kind: "frame", buffer: p.buf, seq: p.seq, simTime: p.simTime }, [p.buf]);
}

function scheduleRetry(): void {
  if (!wanted || retry !== undefined) return;
  retry = setTimeout(() => {
    retry = undefined;
    open();
  }, backoff);
  backoff = Math.min(5000, Math.round(backoff * 1.7));
}

function open(): void {
  if (!wanted) return;
  expected = -1;
  lastSeq = -1;
  if (lastState === null) state("connecting");
  let sock: WebSocket;
  try {
    sock = new WebSocket(url);
  } catch {
    state("offline");
    scheduleRetry();
    return;
  }
  sock.binaryType = "arraybuffer";
  ws = sock;
  sock.onmessage = (e: MessageEvent<unknown>) => {
    if (sock !== ws) return;
    if (typeof e.data === "string") {
      const r = parseServerMsg(e.data);
      if (!r.ok) return;
      if (r.msg.type === "hello") {
        if (r.msg.protocol !== PROTOCOL_VERSION) {
          state("mismatch", r.msg.protocol);
          wanted = true;
          backoff = 5000;
          sock.close();
          return;
        }
        expected = r.msg.network.neurons;
        backoff = 500;
        state("connected");
      }
      ctx.postMessage({ kind: "msg", msg: r.msg });
    } else if (e.data instanceof ArrayBuffer) {
      const r = parseActivityFrame(e.data, expected);
      if (!r.ok) return;
      // Same sequence or older (after a restart the sequence may restart: allow when it drops a lot).
      if (r.seq <= lastSeq && lastSeq - r.seq < 1000) return;
      lastSeq = r.seq;
      pending = { buf: e.data, seq: r.seq, simTime: r.simTime };
      flushTimer ??= setTimeout(flush, 16);
    }
  };
  sock.onclose = () => {
    if (sock !== ws) return;
    ws = null;
    pending = null;
    if (lastState?.kind === "state" && lastState.state !== "mismatch") state("offline");
    scheduleRetry();
  };
  sock.onerror = () => {
    // onclose always follows; nothing to log, the engine being absent is a normal state.
  };
}

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.kind === "start") {
    url = m.url;
    wanted = true;
    backoff = 500;
    open();
  } else if (m.kind === "stop") {
    wanted = false;
    clearTimeout(retry);
    retry = undefined;
    clearTimeout(flushTimer);
    flushTimer = undefined;
    const s = ws;
    ws = null;
    s?.close();
  } else if (m.kind === "send") {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(m.text);
  }
};
