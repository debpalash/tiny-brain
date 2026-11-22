import { ACTIVITY_HEADER_BYTES, ACTIVITY_MAGIC } from "../brainlink/protocol";
import type { ServerMsg } from "../brainlink/protocol";

export type FrameResult =
  | { ok: true; seq: number; simTime: number; count: number }
  | { ok: false; reason: "short" | "magic" | "count" };

/**
 * Validate a binary activity frame. `expectedCount` is `hello.network.neurons`.
 * On success the activity bytes are `new Uint8Array(buf, ACTIVITY_HEADER_BYTES, count)` (no copy).
 */
export function parseActivityFrame(buf: ArrayBuffer, expectedCount: number): FrameResult {
  if (buf.byteLength < ACTIVITY_HEADER_BYTES) return { ok: false, reason: "short" };
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== ACTIVITY_MAGIC) return { ok: false, reason: "magic" };
  const count = v.getUint32(16, true);
  if (count !== expectedCount || buf.byteLength !== ACTIVITY_HEADER_BYTES + count) return { ok: false, reason: "count" };
  return { ok: true, seq: v.getUint32(4, true), simTime: v.getFloat64(8, true), count };
}

export type MsgResult = { ok: true; msg: ServerMsg } | { ok: false; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
const numArr = (v: unknown, n?: number): boolean => isArr(v) && (n === undefined || v.length === n) && v.every(isNum);

/** Parse and shallowly validate one JSON text frame from the engine. Never throws. */
export function parseServerMsg(text: string): MsgResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not json" };
  }
  if (!isObj(raw) || typeof raw.type !== "string") return { ok: false, reason: "no type" };
  const kind = raw.type;
  const bad = (why: string): MsgResult => ({ ok: false, reason: `${kind}: ${why}` });
  switch (raw.type) {
    case "hello": {
      const n = raw.network;
      if (!isNum(raw.protocol)) return bad("protocol");
      if (!isObj(n) || !isNum(n.neurons) || typeof n.name !== "string") return bad("network");
      if (!isArr(raw.groups) || !isArr(raw.pathways) || !isArr(raw.odours)) return bad("lists");
      if (!isArr(n.caveats)) return bad("caveats");
      return { ok: true, msg: raw as unknown as ServerMsg };
    }
    case "neurons": {
      const n = isArr(raw.group) ? raw.group.length : -1;
      if (n < 0) return bad("group");
      for (const k of ["side", "x", "y", "z", "hasPosition", "sign", "signKnown"]) {
        if (!numArr(raw[k], n)) return bad(k);
      }
      if (!isArr(raw.name) || raw.name.length !== n) return bad("name");
      if (!numArr(raw.group)) return bad("group");
      return { ok: true, msg: raw as unknown as ServerMsg };
    }
    case "stats":
      if (!isNum(raw.simTime) || !numArr(raw.groupRateHz) || !numArr(raw.pathwayStrength)) return bad("fields");
      if (!isNum(raw.approach) || !isNum(raw.reward) || !isArr(raw.stimuli)) return bad("fields");
      return { ok: true, msg: raw as unknown as ServerMsg };
    case "neuronDetail":
      if (!isNum(raw.neuron) || !isArr(raw.inputs) || !isArr(raw.outputs)) return bad("fields");
      return { ok: true, msg: raw as unknown as ServerMsg };
    case "error":
      if (typeof raw.message !== "string") return bad("message");
      return { ok: true, msg: raw as unknown as ServerMsg };
    default:
      return { ok: false, reason: "unknown type" };
  }
}
