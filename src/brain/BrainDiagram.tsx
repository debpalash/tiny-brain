import { useEffect, useMemo, useRef, useState } from "react";
import { engine } from "../engine";
import { N } from "../sim/types";
import type { NeuronKind } from "../sim/types";
import { theme } from "../theme";
import { useUi } from "../uiStore";
import { neuronIndex, useAttention } from "./attention";

const W = 300;
const R = 14;
const PITCH = 58;
const TOP = 26;
const STRONG = 1.0;
const WEAK = 0.15;
const LEARNED = 0.25;
const COL_X = [46, 150, 254];
const COLS: { title: string; x: number; kind: NeuronKind }[] = [
  { title: "Senses", x: 0, kind: "sensor" },
  { title: "Thinking", x: 104, kind: "inter" },
  { title: "Actions", x: 208, kind: "motor" },
];
const KIND_COLOR: Record<NeuronKind, string> = { sensor: theme.sensor, inter: theme.inter, motor: theme.motor };
const COL_OF: Record<NeuronKind, number> = { sensor: 0, inter: 1, motor: 2 };

interface Layout {
  x: number[];
  y: number[];
  col: number[];
  row: number[];
  groups: number[][]; // neuron indices per column, top to bottom
  H: number;
  laneTop: number;
  laneBottom: number;
}

/** Columns come from NeuronInfo.kind, rows from the neuron order, so extra neurons just fit. */
function makeLayout(): Layout {
  const groups: number[][] = [[], [], []];
  for (const n of engine.neurons) groups[COL_OF[n.kind]].push(n.index);
  const rows = Math.max(1, ...groups.map((g) => g.length));
  const avail = rows * PITCH;
  const x: number[] = [];
  const y: number[] = [];
  const col: number[] = [];
  const row: number[] = [];
  groups.forEach((g, c) => {
    const pitch = avail / g.length;
    g.forEach((i, k) => {
      x[i] = COL_X[c];
      y[i] = TOP + pitch * (k + 0.5);
      col[i] = c;
      row[i] = k;
    });
  });
  const H = TOP + avail + 8;
  return { x, y, col, row, groups, H, laneTop: 32, laneBottom: H - 5 };
}

interface Edge {
  from: number;
  to: number;
  strong: boolean;
  positive: boolean;
  width: number;
  d: string;
  tx: number;
  ty: number;
  dx: number;
  dy: number;
  learnable: boolean;
  learned: boolean;
  mid: [number, number];
}

function splitLabel(s: string): string[] {
  if (s.length <= 10) return [s];
  const mid = s.length / 2;
  let best = -1;
  for (let k = 0; k < s.length; k++) {
    if (s[k] === " " && (best < 0 || Math.abs(k - mid) < Math.abs(best - mid))) best = k;
  }
  return best < 0 ? [s] : [s.slice(0, best), s.slice(best + 1)];
}

function buildEdges(L: Layout, weights: Float32Array, inborn: Float32Array, plastic: Float32Array, showWeak: boolean): Edge[] {
  interface Raw {
    from: number;
    to: number;
    w: number;
    kind: "self" | "same" | "cross";
    s: number;
    learnable: boolean;
    learned: boolean;
  }
  const raws: Raw[] = [];
  for (let f = 0; f < N; f++) {
    for (let t = 0; t < N; t++) {
      const w = weights[f * N + t];
      if (Math.abs(w) < (showWeak ? WEAK : STRONG) && !(plastic[f * N + t] > 0)) continue;
      const cd = L.col[t] - L.col[f];
      raws.push({ from: f, to: t, w, kind: f === t ? "self" : cd === 0 ? "same" : "cross", s: Math.sign(cd),
        learnable: plastic[f * N + t] > 0,
        learned: Math.abs(w - inborn[f * N + t]) >= LEARNED,
      });
    }
  }
  const ports = new Map<number, Raw[]>();
  const addPort = (node: number, side: number, r: Raw) => {
    const key = node * 2 + (side > 0 ? 1 : 0);
    const l = ports.get(key);
    if (l) l.push(r);
    else ports.set(key, [r]);
  };
  for (const r of raws) {
    if (r.kind !== "cross") continue;
    addPort(r.from, r.s, r);
    addPort(r.to, -r.s, r);
  }
  const portPoint = (node: number, side: number, r: Raw): [number, number] => {
    const l = ports.get(node * 2 + (side > 0 ? 1 : 0)) as Raw[];
    const key = (p: Raw) => L.y[p.from === node ? p.to : p.from];
    const sorted = l.slice().sort((p, q) => key(p) - key(q));
    // Shrink the spacing when a node has many links on one side, so ports stay on the circle.
    const gap = Math.min(6, (2 * R * 0.85) / Math.max(1, sorted.length - 1));
    const off = (sorted.indexOf(r) - (sorted.length - 1) / 2) * gap;
    return [L.x[node] + side * Math.sqrt(R * R - off * off), L.y[node] + off];
  };

  const edges: Edge[] = [];
  for (const r of raws) {
    const a = Math.abs(r.w);
    const strong = a >= STRONG;
    const width = !strong ? 1 : a < 2.5 ? 1.2 : a < 5 ? 1.8 : 2.4;
    let d: string;
    let tx = 0;
    let ty = 0;
    let dx = 0;
    let dy = 0;
    const x = L.x[r.from];
    const y = L.y[r.from];
    if (r.kind === "self") {
      const ex = x + 6;
      const ey = y - R * 0.9;
      d = `M${x - 6} ${ey} C${x - 20} ${y - R - 22} ${x + 20} ${y - R - 22} ${ex} ${ey}`;
      dx = ex;
      dy = ey;
      tx = ex - (x + 20);
      ty = ey - (y - R - 22);
    } else if (r.kind === "same") {
      const down = L.y[r.to] > y;
      const side = down ? 1 : -1;
      const k = down ? 1 : -1;
      const sy = y + k * R * 0.55;
      const ey = L.y[r.to] - k * R * 0.55;
      const bulge = 36 + 5 * (Math.abs(L.row[r.to] - L.row[r.from]) - 1);
      const sx0 = x + side * R * 0.83;
      d = `M${sx0} ${sy} C${x + side * bulge} ${sy} ${x + side * bulge} ${ey} ${sx0} ${ey}`;
      dx = sx0;
      dy = ey;
      tx = -side;
    } else {
      const [x0, y0] = portPoint(r.from, r.s, r);
      const [x1, y1] = portPoint(r.to, -r.s, r);
      const ddx = x1 - x0;
      if (Math.abs(L.col[r.to] - L.col[r.from]) === 2) {
        const lane = (y0 + y1) / 2 <= L.H / 2 ? L.laneTop : L.laneBottom;
        const c = (lane - (y0 + y1) / 8) / 0.75;
        d = `M${x0} ${y0} C${x0 + r.s * 34} ${c} ${x1 - r.s * 34} ${c} ${x1} ${y1}`;
        tx = r.s * 34;
        ty = y1 - c;
      } else {
        d = `M${x0} ${y0} C${x0 + ddx * 0.5} ${y0} ${x1 - ddx * 0.5} ${y1} ${x1} ${y1}`;
        tx = ddx * 0.5;
      }
      dx = x1;
      dy = y1;
    }
    const len = Math.hypot(tx, ty) || 1;
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) as string[]).map(Number);
    const mid: [number, number] = [
      (nums[0] + 3 * nums[2] + 3 * nums[4] + nums[6]) / 8,
      (nums[1] + 3 * nums[3] + 3 * nums[5] + nums[7]) / 8,
    ];
    edges.push({
      from: r.from,
      to: r.to,
      strong,
      positive: r.w > 0,
      width,
      d,
      tx: tx / len,
      ty: ty / len,
      dx,
      dy,
      learnable: r.learnable,
      learned: r.learned,
      mid,
    });
  }
  edges.sort((p, q) => Number(p.strong) - Number(q.strong));
  return edges;
}

function EdgeTip({ e, color }: { e: Edge; color: string }) {
  const { dx, dy, tx, ty } = e;
  if (e.positive) {
    const bx = dx - tx * 6;
    const by = dy - ty * 6;
    return <polygon points={`${dx},${dy} ${bx - ty * 3},${by + tx * 3} ${bx + ty * 3},${by - tx * 3}`} fill={color} />;
  }
  return (
    <line
      x1={dx - ty * 4.5}
      y1={dy + tx * 4.5}
      x2={dx + ty * 4.5}
      y2={dy - tx * 4.5}
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    />
  );
}

export function BrainDiagram({ version }: { version: number }) {
  const focus = useUi((s) => s.focusNeuron);
  const hot = useAttention((s) => s.hot);
  const guide = useAttention((s) => s.guide);
  const showWeak = useAttention((s) => s.showWeak);
  const setHot = useAttention((s) => s.setHot);
  const [cur, setCur] = useState(0);
  const b = engine.selected();
  const selId = b ? b.id : -1;
  const L = useMemo(makeLayout, []);

  const edges = useMemo(() => {
    const c = engine.selected();
    return c ? buildEdges(L, c.w, c.genome.weights, c.genome.plastic, showWeak) : [];
    // version covers in-place genome edits; selId covers selection change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, selId, showWeak, L]);

  const active = hot ?? focus;
  const guideSet = useMemo(() => {
    if (!guide) return null;
    const s = new Uint8Array(N);
    for (const n of guide) s[n] = 1;
    return s;
  }, [guide]);

  const nodeOn = (i: number) => (active !== null ? i === active : guideSet ? guideSet[i] === 1 : true);
  const edgeOn = (e: Edge) =>
    active !== null ? e.from === active || e.to === active : guideSet ? guideSet[e.from] === 1 && guideSet[e.to] === 1 : true;
  const emphasising = active !== null || guideSet !== null;

  const svgRef = useRef<SVGSVGElement>(null);
  const gaugeRefs = useRef<(SVGRectElement | null)[]>([]);
  const flowRefs = useRef<(SVGPathElement | null)[]>([]);
  const pulseRef = useRef<SVGCircleElement>(null);
  const rewardRef = useRef<HTMLSpanElement>(null);
  const live = useRef({ edges, dimmed: new Uint8Array(0) });
  const tumbleIdx = useMemo(() => neuronIndex("TUMBLE"), []);

  useEffect(() => {
    const dimmed = new Uint8Array(edges.length);
    for (let k = 0; k < edges.length; k++) dimmed[k] = emphasising && !edgeOn(edges[k]) ? 1 : 0;
    live.current = { edges, dimmed };
  });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const offs: number[] = [];
    let lastTumble: boolean | null = null;
    let lastId = -1;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const c = engine.selected();
      if (!c) return;
      for (let i = 0; i < N; i++) {
        const rect = gaugeRefs.current[i];
        if (!rect) continue;
        const a = Math.min(1, Math.max(0, c.act[i]));
        rect.setAttribute("y", String(R - 2 * R * a));
        rect.setAttribute("height", String(2 * R * a + 0.5));
      }
      const rw = rewardRef.current;
      if (rw) {
        const v = Math.max(-1, Math.min(1, c.reward));
        rw.style.left = v >= 0 ? "50%" : `${50 + v * 50}%`;
        rw.style.width = `${Math.abs(v) * 50}%`;
        rw.style.background = v >= 0 ? theme.food : theme.toxin;
      }
      if (c.id !== lastId) {
        lastId = c.id;
        lastTumble = c.tumbling;
      } else if (c.tumbling !== lastTumble) {
        lastTumble = c.tumbling;
        if (!reduce && pulseRef.current) {
          pulseRef.current.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 300, easing: "ease-out" });
        }
      }
      const { edges: es, dimmed } = live.current;
      for (let k = 0; k < es.length; k++) {
        const p = flowRefs.current[k];
        if (!p) continue;
        const a = c.act[es[k].from];
        p.style.opacity = dimmed[k] ? "0" : String(reduce ? 0.25 : 0.04 + 0.3 * a);
        if (!reduce) {
          offs[k] = (offs[k] ?? 0) - dt * (5 + 20 * a);
          p.style.strokeDashoffset = String(offs[k]);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggleFocus = (i: number) => {
    const ui = useUi.getState();
    ui.setFocusNeuron(ui.focusNeuron === i ? null : i);
  };

  const move = (i: number, key: string) => {
    let target = -1;
    const g = L.groups[L.col[i]];
    if (key === "ArrowUp" || key === "ArrowDown") {
      target = g[L.row[i] + (key === "ArrowUp" ? -1 : 1)] ?? -1;
    } else {
      let c = L.col[i] + (key === "ArrowLeft" ? -1 : 1);
      while (c >= 0 && c < 3 && L.groups[c].length === 0) c += key === "ArrowLeft" ? -1 : 1;
      if (c >= 0 && c < 3) {
        let bd = Infinity;
        for (const j of L.groups[c]) {
          const dd = Math.abs(L.y[j] - L.y[i]);
          if (dd < bd) {
            bd = dd;
            target = j;
          }
        }
      }
    }
    if (target >= 0) svgRef.current?.querySelector<SVGGElement>(`[data-neuron="${target}"]`)?.focus();
  };

  const tabStop = focus ?? cur;

  return (
    <div>
      <div className="brain-reward" role="img" aria-label="Reward signal: green when something good happens, rose when something bad happens">
        <span>Reward</span>
        <span className="brain-rtrack">
          <span ref={rewardRef} className="brain-rfill" />
        </span>
      </div>
      <svg
        ref={svgRef}
        className="brain-svg"
        viewBox={`0 0 ${W} ${L.H}`}
        role="group"
        aria-label="Circuit diagram of the brain. Use arrow keys to move between neurons, Enter to select."
        onClick={(e) => {
          if (e.target === e.currentTarget) useUi.getState().setFocusNeuron(null);
        }}
      >
        {COLS.map((c) => (
          <g key={c.title} pointerEvents="none">
            <rect x={c.x} y={0} width={92} height={L.H} rx={6} fill="#ffffff" opacity={0.025} />
            <text x={c.x + 46} y={15} textAnchor="middle" className="brain-colhead">
              {c.title}
            </text>
          </g>
        ))}
        {edges.map((e, k) => {
          const color = e.positive ? theme.excite : theme.inhibit;
          const on = edgeOn(e) || !emphasising;
          const op = !e.strong ? (on ? (e.learnable ? 0.45 : 0.22) : 0.1) : on ? 0.85 : 0.2;
          return (
            <g key={`${e.from}-${e.to}`} pointerEvents="none" className="brain-fade" style={{ opacity: op }}>
              <path
                d={e.d}
                fill="none"
                stroke={color}
                strokeWidth={e.width}
                strokeLinecap="round"
                strokeDasharray={e.learnable ? "1.5 3" : undefined}
              />
              {e.strong && (
                <path
                  ref={(o) => {
                    flowRefs.current[k] = o;
                  }}
                  d={e.d}
                  fill="none"
                  stroke={theme.text}
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  strokeDasharray="0.1 12"
                  style={{ opacity: 0 }}
                />
              )}
              {e.strong && <EdgeTip e={e} color={color} />}
              {e.learned && <circle cx={e.mid[0]} cy={e.mid[1]} r={2.6} fill={theme.text} stroke={theme.bg} strokeWidth={1} />}
            </g>
          );
        })}
        {engine.neurons.map((n, i) => {
          const color = KIND_COLOR[n.kind];
          const cl = b ? b.clamp[i] : null;
          const lines = splitLabel(n.label);
          return (
            <g
              key={n.index}
              className="brain-node brain-fade"
              data-neuron={i}
              transform={`translate(${L.x[i]} ${L.y[i]})`}
              style={{ opacity: nodeOn(i) ? 1 : 0.35 }}
              tabIndex={tabStop === i ? 0 : -1}
              role="button"
              aria-pressed={focus === i}
              aria-label={`${n.label}. ${n.description}`}
              onPointerEnter={() => setHot(i)}
              onPointerLeave={() => {
                if (useAttention.getState().hot === i) setHot(null);
              }}
              onFocus={() => {
                setCur(i);
                setHot(i);
              }}
              onBlur={() => {
                if (useAttention.getState().hot === i) setHot(null);
              }}
              onClick={() => toggleFocus(i)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  toggleFocus(i);
                } else if (ev.key.startsWith("Arrow")) {
                  ev.preventDefault();
                  move(i, ev.key);
                }
              }}
            >
              <clipPath id={`brain-clip-${i}`}>
                <circle r={R - 1} />
              </clipPath>
              <circle r={R + 8} fill="transparent" />
              <circle r={R} fill={theme.bg} />
              <rect
                ref={(o) => {
                  gaugeRefs.current[i] = o;
                }}
                x={-R}
                y={R}
                width={2 * R}
                height={0}
                fill={color}
                opacity={0.5}
                clipPath={`url(#brain-clip-${i})`}
              />
              <circle r={R} fill="none" stroke={color} strokeWidth={1.3} />
              {i === tumbleIdx && (
                <circle ref={pulseRef} r={R + 3} fill="none" stroke={theme.text} strokeWidth={1.5} style={{ opacity: 0 }} />
              )}
              <circle className="brain-nring" r={R + 4} fill="none" stroke={theme.accent} strokeWidth={focus === i ? 1.6 : 0} />
              <text textAnchor="middle" className="brain-nlabel" fill={theme.text}>
                {lines.map((l, k) => (
                  <tspan key={l} x={0} y={R + 12 + k * 11}>
                    {l}
                  </tspan>
                ))}
              </text>
              {cl !== null && (
                <g transform={`translate(${R - 8} ${-R - 11})`} aria-hidden="true">
                  <rect width={32} height={13} rx={3} fill={theme.bg} stroke={cl > 0.5 ? theme.excite : theme.inhibit} strokeWidth={1} />
                  <path d="M5 6.5h5v4h-5zM6 6.5v-1.5a1.5 1.5 0 0 1 3 0v1.5" fill="none" stroke={theme.text} strokeWidth={0.9} />
                  <text x={13} y={9.7} className="brain-badge" fill={theme.text}>
                    {cl > 0.5 ? "on" : "off"}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div className="brain-key" aria-hidden="true">
        <svg width="22" height="8" viewBox="0 0 22 8">
          <path d="M1 4h14" stroke={theme.excite} strokeWidth="1.4" />
          <polygon points="21,4 14,1 14,7" fill={theme.excite} />
        </svg>
        excites
        <svg width="22" height="8" viewBox="0 0 22 8">
          <path d="M1 4h17" stroke={theme.inhibit} strokeWidth="1.4" />
          <path d="M19 0.5v7" stroke={theme.inhibit} strokeWidth="2" strokeLinecap="round" />
        </svg>
        calms
      </div>
    </div>
  );
}
