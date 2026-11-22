import { describe, expect, it } from "vite-plus/test";
import { ACTIVITY_HEADER_BYTES, ACTIVITY_MAGIC } from "../brainlink/protocol";
import type { HelloMsg, StatsMsg } from "../brainlink/protocol";
import { parseActivityFrame, parseServerMsg } from "./frames";
import { layoutNeurons } from "./layout";
import { buildStrip } from "./pathway";
import { liveSentence, verdictOf } from "./sentence";
import { startRun, teachPlan, testPlan, tickRun } from "./sequence";

function frame(count: number, magic = ACTIVITY_MAGIC, declared = count, bytes = count): ArrayBuffer {
  const b = new ArrayBuffer(ACTIVITY_HEADER_BYTES + bytes);
  const v = new DataView(b);
  v.setUint32(0, magic, true);
  v.setUint32(4, 7, true);
  v.setFloat64(8, 1.5, true);
  v.setUint32(16, declared, true);
  return b;
}

describe("parseActivityFrame", () => {
  it("accepts a good frame", () => {
    expect(parseActivityFrame(frame(10), 10)).toEqual({ ok: true, seq: 7, simTime: 1.5, count: 10 });
  });
  it("rejects bad magic", () => {
    expect(parseActivityFrame(frame(10, 0x1234), 10)).toEqual({ ok: false, reason: "magic" });
  });
  it("rejects a short buffer", () => {
    expect(parseActivityFrame(new ArrayBuffer(8), 10)).toEqual({ ok: false, reason: "short" });
  });
  it("rejects a wrong count or wrong length", () => {
    expect(parseActivityFrame(frame(10), 11)).toEqual({ ok: false, reason: "count" });
    expect(parseActivityFrame(frame(10, ACTIVITY_MAGIC, 10, 9), 10)).toEqual({ ok: false, reason: "count" });
    expect(parseActivityFrame(frame(10), -1)).toEqual({ ok: false, reason: "count" });
  });
});

const hello: HelloMsg = {
  type: "hello",
  protocol: 1,
  network: { name: "Larva", neurons: 4, synapses: 9, source: "Test", caveats: ["Signs assumed"] },
  dtMs: 0.5,
  groups: [
    { id: 0, label: "Smell sensors", scientific: "ORN", description: "", kind: "sensor", count: 1, stimulable: true },
    { id: 1, label: "Relay neurons", scientific: "PN", description: "", kind: "inter", count: 1, stimulable: false },
    { id: 2, label: "Memory cells", scientific: "KC", description: "", kind: "inter", count: 1, stimulable: false },
    { id: 3, label: "Output neurons", scientific: "MBON", description: "", kind: "motor", count: 1, stimulable: false },
    { id: 4, label: "Reward neurons", scientific: "DAN", description: "", kind: "reward", count: 1, stimulable: true },
  ],
  pathways: [
    { id: 0, label: "s>r", fromGroup: 0, toGroup: 1, synapses: 1, plastic: false },
    { id: 1, label: "r>m", fromGroup: 1, toGroup: 2, synapses: 1, plastic: false },
    { id: 2, label: "m>o", fromGroup: 2, toGroup: 3, synapses: 1, plastic: true },
  ],
  odours: [{ id: 0, label: "Odour A", sensors: 5 }],
};

const stats = (o: Partial<StatsMsg> = {}): StatsMsg => ({
  type: "stats",
  simTime: 0,
  realtimeFactor: 1,
  paused: false,
  learning: true,
  speed: 1,
  groupRateHz: [0, 0, 0, 0, 0],
  pathwayStrength: [1, 1, 1],
  reward: 0,
  approach: 0,
  odour: null,
  odourSecondsLeft: 0,
  stimuli: [],
  ...o,
});

describe("parseServerMsg", () => {
  it("parses a stats message", () => {
    const r = parseServerMsg(JSON.stringify(stats()));
    expect(r.ok && r.msg.type).toBe("stats");
  });
  it("parses hello", () => {
    expect(parseServerMsg(JSON.stringify(hello)).ok).toBe(true);
  });
  it("rejects garbage, unknown types and inconsistent tables", () => {
    expect(parseServerMsg("{nope").ok).toBe(false);
    expect(parseServerMsg("[]").ok).toBe(false);
    expect(parseServerMsg('{"type":"wat"}').ok).toBe(false);
    expect(parseServerMsg('{"type":"stats","simTime":1}').ok).toBe(false);
    const bad = { type: "neurons", group: [0, 1], side: [0], x: [], y: [], z: [], hasPosition: [], sign: [], signKnown: [], name: [] };
    expect(parseServerMsg(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe("liveSentence", () => {
  it("waits for data", () => {
    expect(liveSentence(null, null)).toMatch(/Waiting/);
  });
  it("describes smelling with an indifferent brain", () => {
    expect(liveSentence(hello, stats({ odour: 0 }))).toBe("Smelling Odour A. The brain is indifferent to it.");
  });
  it("describes a leaning verdict", () => {
    expect(liveSentence(hello, stats({ odour: 0, approach: -0.6 }))).toMatch(/avoiding/);
  });
  it("describes reward and the weakening link", () => {
    const s = liveSentence(hello, stats({ odour: 0, reward: 1, pathwayStrength: [1, 1, 0.9] }));
    expect(s).toBe("Reward given with Odour A: the link from memory cells to output neurons is weakening.");
  });
  it("is honest when learning is off or reward has no smell", () => {
    expect(liveSentence(hello, stats({ odour: 0, reward: 1, learning: false }))).toMatch(/learning is off/);
    expect(liveSentence(hello, stats({ reward: -1 }))).toMatch(/without a smell/);
  });
  it("reports a saved verdict at rest, and pause first", () => {
    expect(liveSentence(hello, stats(), { odour: 0, approach: 0.5 })).toBe("Verdict on Odour A: approach.");
    expect(liveSentence(hello, stats({ paused: true, odour: 0 }))).toMatch(/Paused/);
    expect(verdictOf(0.1)).toBe("indifferent");
  });
});

describe("sequence", () => {
  const odour = { id: 0, label: "Odour A" };
  it("teach: odour at once, reward later, then finishes", () => {
    let run = startRun(teachPlan(odour, 1), 10);
    let t = tickRun(run, 10);
    expect(t.due.map((s) => s.msg?.type)).toEqual(["odour"]);
    expect(t.progress).toBe(0);
    run = t.run!;
    t = tickRun(run, 12);
    expect(t.due).toEqual([]);
    run = t.run!;
    t = tickRun(run, 13.2);
    expect(t.due.map((s) => s.msg?.type)).toEqual(["reward"]);
    expect(t.label).toMatch(/Reward with Odour A/);
    run = t.run!;
    t = tickRun(run, 16);
    expect(t.run).toBeNull();
    expect(t.progress).toBe(1);
    expect(t.cancelled).toBe(false);
  });
  it("punishment sends a negative value", () => {
    const t = tickRun(startRun(teachPlan(odour, -1), 0), 100);
    expect(t.due.map((s) => (s.msg?.type === "reward" ? s.msg.value : null))).toEqual([null, -1]);
  });
  it("issues every due step once even after a long gap", () => {
    const t = tickRun(startRun(testPlan(odour), 0), 50);
    expect(t.due).toHaveLength(2);
    expect(t.due[1].record).toBe(0);
    expect(t.run).toBeNull();
  });
  it("cancels when simulated time goes backwards (reset)", () => {
    const t = tickRun(startRun(teachPlan(odour, 1), 20), 1);
    expect(t.cancelled).toBe(true);
    expect(t.run).toBeNull();
  });
});

describe("layout and strip", () => {
  it("separates unknown-position neurons and centres the rest", () => {
    const l = layoutNeurons({
      type: "neurons",
      group: [0, 0, 0],
      side: [-1, 1, 0],
      x: [100, 300, 0],
      y: [0, 0, 0],
      z: [0, 0, 0],
      hasPosition: [1, 1, 0],
      sign: [1, 1, 1],
      signKnown: [1, 1, 1],
      name: ["a", "b", "c"],
    });
    expect(l.unknownCount).toBe(1);
    expect(l.positions[0]).toBeCloseTo(-10);
    expect(l.positions[3]).toBeCloseTo(10);
    expect(l.positions[6]).toBeLessThan(-10);
    expect(l.viewSign).toBe(1);
  });
  it("builds the sensors > relay > memory > output strip with reward", () => {
    const s = buildStrip(hello);
    expect(s.main.map((x) => x.role)).toEqual(["sensor", "relay", "memory", "output"]);
    expect(s.reward?.role).toBe("reward");
    expect(s.plasticPathway).toBe(2);
  });
});
