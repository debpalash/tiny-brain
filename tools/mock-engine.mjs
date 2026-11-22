#!/usr/bin/env node
// Mock brain engine: speaks src/brainlink/protocol.ts with fake but plausible data.
// Plain Node, no dependencies (a tiny WebSocket server is built in). Usage: node tools/mock-engine.mjs [port]
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const PORT = Number(process.argv[2] ?? 8787);
const PROTOCOL = 1;
const MAGIC = 0x314e5242;
const FULL_SCALE_HZ = 50;

// ---- fake network: 3,016 neurons in 6 groups
const groups = [
  { id: 0, label: "Smell sensors", scientific: "Olfactory receptor neurons", description: "Detect smells in the air.", kind: "sensor", count: 160, stimulable: true },
  { id: 1, label: "Relay neurons", scientific: "Projection neurons", description: "Pass smell signals on to the memory cells.", kind: "inter", count: 240, stimulable: true },
  { id: 2, label: "Memory cells", scientific: "Kenyon cells", description: "Each smell activates its own small set; this is where memories are stored.", kind: "inter", count: 2100, stimulable: false },
  { id: 3, label: "Output neurons", scientific: "Mushroom body output neurons", description: "Turn memory into approach or avoid.", kind: "motor", count: 120, stimulable: false },
  { id: 4, label: "Reward neurons", scientific: "Dopaminergic neurons", description: "Carry the teaching signal for reward and punishment.", kind: "reward", count: 80, stimulable: true },
  { id: 5, label: "Other neurons", scientific: "Other mushroom body neurons", description: "Support cells of the circuit.", kind: "other", count: 316, stimulable: false },
];
const N = groups.reduce((a, g) => a + g.count, 0); // 3016
const pathways = [
  { id: 0, label: "Sensors to relay", fromGroup: 0, toGroup: 1, synapses: 5000, plastic: false },
  { id: 1, label: "Relay to memory", fromGroup: 1, toGroup: 2, synapses: 9000, plastic: false },
  { id: 2, label: "Memory to output", fromGroup: 2, toGroup: 3, synapses: 40000, plastic: true },
  { id: 3, label: "Reward to memory-output", fromGroup: 4, toGroup: 3, synapses: 2000, plastic: false },
];
const odours = [
  { id: 0, label: "Odour A", sensors: 40 },
  { id: 1, label: "Odour B", sensors: 40 },
];

let seedState = 12345;
const rnd = () => ((seedState = (seedState * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

const grp = [], side = [], X = [], Y = [], Z = [], hasPos = [], sign = [], signKnown = [], name = [];
const centres = [[0, -60, 0], [0, -20, 10], [0, 20, 0], [0, 55, -10], [0, 10, 40], [0, 30, 30]];
const groupStart = [];
for (const g of groups) {
  groupStart.push(grp.length);
  for (let i = 0; i < g.count; i++) {
    const s = rnd() < 0.5 ? -1 : 1;
    const c = centres[g.id];
    grp.push(g.id);
    side.push(s);
    X.push(s * (10 + Math.abs(gauss()) * 18));
    Y.push(c[1] + gauss() * 14);
    Z.push(c[2] + gauss() * 14);
    hasPos.push(rnd() < 0.06 ? 0 : 1);
    sign.push(g.kind === "other" && rnd() < 0.4 ? -1 : 1);
    signKnown.push(rnd() < 0.8 ? 1 : 0);
    name.push(`${g.scientific.split(" ")[0]}-${g.id}-${i}`);
  }
}
for (let i = 0; i < N; i++) if (!hasPos[i]) { X[i] = 0; Y[i] = 0; Z[i] = 0; }
const r2 = (v) => Math.round(v * 100) / 100;

const hello = {
  type: "hello", protocol: PROTOCOL,
  network: {
    name: "Fly larva mushroom body (mock)", neurons: N, synapses: 56000,
    source: "MOCK DATA: random, not a real connectome",
    caveats: ["This is a mock engine with invented data.", "Excitatory/inhibitory signs are assumed, not measured."],
  },
  dtMs: 0.5, groups, pathways, odours,
};
const neuronsMsg = { type: "neurons", group: grp, side, x: X.map(r2), y: Y.map(r2), z: Z.map(r2), hasPosition: hasPos, sign, signKnown, name };

// ---- fake dynamics
const sim = {
  t: 0, paused: false, learning: true, speed: 1,
  odour: null, odourLeft: 0, reward: 0, rewardLeft: 0, stim: [],
  w: [0, 0], // learned value per odour, -1..1
  rate: new Float32Array(N),
  inspect: null,
};
const odourSet = odours.map((o) => {
  const s = new Set();
  while (s.size < o.sensors) s.add(groupStart[0] + Math.floor(rnd() * groups[0].count));
  return s;
});
const memorySets = odours.map(() => {
  const s = new Set();
  while (s.size < 200) s.add(groupStart[2] + Math.floor(rnd() * groups[2].count));
  return s;
});

function groupMean(g) {
  let a = 0;
  for (let i = groupStart[g]; i < groupStart[g] + groups[g].count; i++) a += sim.rate[i];
  return a / groups[g].count;
}
function approach() {
  if (sim.odour === null) return 0;
  const target = sim.w[sim.odour];
  return Math.max(-1, Math.min(1, target));
}

function step(dt) {
  if (sim.paused) return;
  sim.t += dt;
  if (sim.odour !== null) { sim.odourLeft -= dt; if (sim.odourLeft <= 0) sim.odour = null; }
  if (sim.rewardLeft > 0) { sim.rewardLeft -= dt; if (sim.rewardLeft <= 0) sim.reward = 0; }
  sim.stim = sim.stim.filter((s) => (s.left -= dt) > 0);
  if (sim.learning && sim.odour !== null && sim.reward !== 0) {
    sim.w[sim.odour] += (sim.reward - sim.w[sim.odour]) * Math.min(1, dt * 0.5);
  }
  const k = Math.min(1, dt / 0.1);
  for (let i = 0; i < N; i++) {
    const g = grp[i];
    let target = 1 + rnd() * 2; // spontaneous
    if (sim.odour !== null) {
      if (g === 0 && odourSet[sim.odour].has(i)) target = 35 + rnd() * 10;
      else if (g === 1) target = 6 + (sim.odour !== null ? 14 : 0) * rnd();
      else if (g === 2 && memorySets[sim.odour].has(i)) target = 25 + rnd() * 8;
      else if (g === 3) target = 6 + Math.abs(sim.w[sim.odour]) * 25 * rnd();
    }
    if (g === 4 && sim.reward !== 0) target = 30 + rnd() * 10;
    for (const s of sim.stim) if (s.group === g) target = Math.max(target, s.rateHz * (0.7 + rnd() * 0.3));
    sim.rate[i] += (target - sim.rate[i]) * k;
  }
}

function statsMsg() {
  return {
    type: "stats", simTime: sim.t, realtimeFactor: sim.paused ? 0 : sim.speed, paused: sim.paused, learning: sim.learning, speed: sim.speed,
    groupRateHz: groups.map((g) => groupMean(g.id)),
    pathwayStrength: [1, 1, 1 - 0.5 * Math.abs(approach() || Math.max(...sim.w.map(Math.abs))), 1],
    reward: sim.reward, approach: approach(), odour: sim.odour, odourSecondsLeft: Math.max(0, sim.odourLeft),
    stimuli: sim.stim.map((s) => ({ group: s.group, rateHz: s.rateHz, secondsLeft: s.left })),
  };
}

function detailMsg(n) {
  const partners = (dir) =>
    Array.from({ length: 12 }, (_, k) => ({ neuron: Math.floor(rnd() * N), synapses: 12 - k, strength: r2(1 - 0.4 * Math.abs(sim.w[0]) * (dir ? 1 : 0.5)) }));
  return { type: "neuronDetail", neuron: n, rateHz: sim.rate[n], inputs: partners(1), outputs: partners(0), inDegree: 80, outDegree: 60 };
}

function activityFrame(seq) {
  const b = Buffer.alloc(20 + N);
  b.writeUInt32LE(MAGIC, 0);
  b.writeUInt32LE(seq >>> 0, 4);
  b.writeDoubleLE(sim.t, 8);
  b.writeUInt32LE(N, 16);
  for (let i = 0; i < N; i++) b[20 + i] = Math.round(255 * Math.min(1, sim.rate[i] / FULL_SCALE_HZ));
  return b;
}

function onClient(m, ws) {
  switch (m.type) {
    case "setPaused": sim.paused = !!m.paused; break;
    case "setSpeed": sim.speed = Number(m.speed) || 1; break;
    case "setLearning": sim.learning = !!m.on; break;
    case "stimulate": sim.stim.push({ group: m.group, rateHz: m.rateHz, left: m.seconds }); break;
    case "odour": sim.odour = m.odour; sim.odourLeft = m.seconds; break;
    case "reward": sim.reward = m.value; sim.rewardLeft = m.seconds; break;
    case "clearStimuli": sim.odour = null; sim.reward = 0; sim.rewardLeft = 0; sim.stim = []; break;
    case "inspect": sim.inspect = m.neuron; if (m.neuron !== null) ws.sendText(JSON.stringify(detailMsg(m.neuron))); break;
    case "forget": sim.w = [0, 0]; break;
    case "reset": sim.t = 0; sim.w = [0, 0]; sim.odour = null; sim.reward = 0; sim.stim = []; sim.rate.fill(1); break;
  }
}

// ---- minimal WebSocket server (RFC 6455, enough for one browser tab)
function encode(opcode, payload) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | opcode; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
  return Buffer.concat([head, payload]);
}

let viewer = null;
const server = createServer((_, res) => { res.writeHead(426); res.end("WebSocket only"); });
server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) return socket.destroy();
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  if (viewer) viewer.socket.destroy();
  const ws = { socket, alive: true, seq: 0,
    sendText: (s) => socket.writable && socket.write(encode(1, Buffer.from(s))),
    sendBin: (b) => socket.writable && socket.write(encode(2, b)) };
  viewer = ws;
  let buf = Buffer.alloc(0);
  socket.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15;
      let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const masked = (buf[1] & 128) !== 0;
      if (buf.length < off + (masked ? 4 : 0) + len) return;
      const mask = masked ? buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      const p = Buffer.from(buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
      buf = buf.subarray(off + len);
      if (op === 8) return socket.end();
      if (op === 9) socket.write(encode(10, p));
      if (op === 1) { try { onClient(JSON.parse(p.toString()), ws); } catch { /* ignore bad client message */ } }
    }
  });
  const gone = () => { ws.alive = false; if (viewer === ws) viewer = null; };
  socket.on("close", gone);
  socket.on("error", gone);
  ws.sendText(JSON.stringify(hello));
  ws.sendText(JSON.stringify(neuronsMsg));
});

let last = Date.now(), frames = 0, lastDetail = 0, lastStats = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000) * sim.speed;
  last = now;
  step(dt);
  if (!viewer || !viewer.alive) return;
  viewer.sendBin(activityFrame(frames++));
  if (now - lastStats >= 200) { lastStats = now; viewer.sendText(JSON.stringify(statsMsg())); }
  if (sim.inspect !== null && now - lastDetail >= 1000) { lastDetail = now; viewer.sendText(JSON.stringify(detailMsg(sim.inspect))); }
}, 33);

server.listen(PORT, "127.0.0.1", () => console.log(`mock engine on ws://127.0.0.1:${PORT} (${N} neurons)`));
