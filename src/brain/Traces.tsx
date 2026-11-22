import { useEffect, useRef, useState } from "react";
import { engine } from "../engine";
import { N } from "../sim/types";
import type { NeuronKind } from "../sim/types";
import { theme } from "../theme";
import { useUi } from "../uiStore";
import { activeNeuron, hasScentLearning, neuronIndex, useAttention } from "./attention";

const SECONDS = 10;
const RATE = 30;
const CAP = SECONDS * RATE;
const LABEL_W = 104;
const VAL_W = 34;
const STRIP = N; // pseudo-row index for the "Tumbling now" strip

interface Item {
  y: number;
  h: number;
  /** neuron index, STRIP, or -1 for a group header */
  idx: number;
  title?: string;
}
interface Layout {
  items: Item[];
  h: number;
  dense: boolean;
}

const GROUP_TITLE: Record<NeuronKind, string> = {
  sensor: "Senses: what the cell feels now",
  inter: "Thinking: memory and comparison",
  motor: "Actions: what the cell does",
};
const kindColor: Record<NeuronKind, string> = { sensor: theme.sensor, inter: theme.inter, motor: theme.motor };

function buildLayout(all: boolean, scent: boolean): Layout {
  const items: Item[] = [];
  let y = 0;
  const row = all ? 24 : 40;
  const add = (idx: number, h = row) => {
    items.push({ y, h, idx });
    y += h;
  };
  if (!all) {
    for (const id of scent ? (["FOOD", "SCENT", "KINASE", "TUMBLE"] as const) : (["FOOD", "KINASE", "TUMBLE"] as const)) {
      const i = neuronIndex(id);
      if (i >= 0) add(i);
    }
    add(STRIP, 32);
  } else {
    for (const kind of ["sensor", "inter", "motor"] as const) {
      const rows = engine.neurons.filter((n) => n.kind === kind);
      if (rows.length === 0) continue;
      items.push({ y, h: 20, idx: -1, title: GROUP_TITLE[kind] });
      y += 20;
      for (const n of rows) add(n.index);
      if (kind === "motor") add(STRIP, 24);
    }
  }
  return { items, h: y, dense: all };
}

export function ActivityTab() {
  const [all, setAll] = useState(false);
  const scent = hasScentLearning(engine.selected());
  return (
    <div>
      <div className="brain-bar">
        <span className="brain-dim">Last 10 seconds. Click a row to inspect it.</span>
        <button type="button" className="brain-link" aria-pressed={all} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : "Show all"}
        </button>
      </div>
      <Traces all={all} scent={scent} />
    </div>
  );
}

function Traces({ all, scent }: { all: boolean; scent: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layRef = useRef<Layout>(buildLayout(false, scent));
  const tumbleIdx = neuronIndex("TUMBLE");

  useEffect(() => {
    layRef.current = buildLayout(all, scent);
  }, [all, scent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const buf = new Float32Array((N + 1) * CAP);
    const alpha = new Float32Array(N + 1).fill(1);
    let head = 0;
    let count = 0;
    let key = "";
    let lastT = -1;
    let w = 0;
    let appliedH = -1;
    let dpr = 1;
    let raf = 0;
    let last = performance.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clipped = new Map<string, string>();

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      w = Math.max(200, Math.floor(r.width));
      appliedH = -1;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const fit = (text: string, maxW: number): string => {
      const k = `${text}|${maxW}|${ctx.font}`;
      const hit = clipped.get(k);
      if (hit !== undefined) return hit;
      let t = text;
      while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
      const out = t === text ? t : `${t.trimEnd()}...`;
      clipped.set(k, out);
      return out;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const b = engine.selected();
      if (!b) return;
      const lay = layRef.current;
      if (lay.h !== appliedH) {
        appliedH = lay.h;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(lay.h * dpr);
        canvas.style.height = `${lay.h}px`;
      }
      const k = `${b.id}:${engine.generation}`;
      const t = engine.time;
      if (k !== key || t < lastT) {
        key = k;
        head = 0;
        count = 0;
        lastT = -1;
      }
      if (lastT < 0 || t - lastT >= 1 / RATE) {
        if (t !== lastT) {
          for (let i = 0; i < N; i++) buf[i * CAP + head] = b.act[i];
          buf[N * CAP + head] = b.tumbling ? 1 : 0;
          head = (head + 1) % CAP;
          if (count < CAP) count++;
        }
        lastT = t;
      }

      const focus = useUi.getState().focusNeuron;
      const act = activeNeuron();
      const guide = useAttention.getState().guide;
      const step = reduce ? 1 : Math.min(1, dt / 0.14);
      for (let r = 0; r <= N; r++) {
        let target = 1;
        if (act !== null) target = r === act || (r === STRIP && act === tumbleIdx) ? 1 : 0.35;
        else if (guide) target = guide.includes(r) || (r === STRIP && tumbleIdx >= 0 && guide.includes(tumbleIdx)) ? 1 : 0.35;
        alpha[r] += (target - alpha[r]) * step;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, lay.h);
      ctx.textBaseline = "middle";
      const px0 = LABEL_W + 8;
      const pw = w - px0 - VAL_W - 6;
      const dx = pw / (CAP - 1);

      for (const it of lay.items) {
        if (it.idx === -1) {
          ctx.globalAlpha = 1;
          ctx.textAlign = "left";
          ctx.font = `11px ${theme.fontUi}`;
          ctx.fillStyle = theme.textDim;
          ctx.fillText(it.title as string, 0, it.y + 12);
          continue;
        }
        const r = it.idx;
        const info = r < N ? engine.neurons[r] : null;
        const col = info ? kindColor[info.kind] : theme.accent;
        const mid = it.y + it.h / 2;
        const pad = lay.dense ? 4 : 8;
        const top = it.y + pad;
        const h = it.h - 2 * pad;
        ctx.globalAlpha = alpha[r];
        if (info && focus === r) {
          ctx.fillStyle = theme.accent;
          ctx.fillRect(0, it.y + 3, 2, it.h - 6);
        }
        ctx.strokeStyle = theme.panelBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, it.y + it.h - 0.5);
        ctx.lineTo(w, it.y + it.h - 0.5);
        ctx.stroke();

        ctx.font = `12px ${theme.fontUi}`;
        ctx.textAlign = "left";
        ctx.fillStyle = theme.text;
        ctx.fillText(fit(info ? info.label : "Tumbling now", LABEL_W), 8, mid);

        const cur = count > 0 ? buf[r * CAP + ((head - 1 + CAP) % CAP)] : 0;
        ctx.font = `11px ${theme.fontMono}`;
        ctx.textAlign = "right";
        ctx.fillStyle = theme.textDim;
        ctx.fillText(info ? cur.toFixed(2) : cur > 0.5 ? "yes" : "no", w, mid);

        if (count < 2) continue;
        const startX = px0 + (CAP - count) * dx;
        const base = top + h;
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        if (!info) {
          ctx.globalAlpha = alpha[r] * 0.5;
          for (let s = 0; s < count; s++) {
            if (buf[r * CAP + ((head - count + s + CAP * 2) % CAP)] > 0.5) {
              ctx.fillRect(startX + s * dx, top, Math.max(dx, 1), h);
            }
          }
          continue;
        }
        ctx.beginPath();
        for (let s = 0; s < count; s++) {
          const v = buf[r * CAP + ((head - count + s + CAP * 2) % CAP)];
          const x = startX + s * dx;
          const y = base - v * h;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 1;
        ctx.stroke();
        if (info.kind === "motor") {
          ctx.lineTo(startX + (count - 1) * dx, base);
          ctx.lineTo(startX, base);
          ctx.closePath();
          ctx.globalAlpha = alpha[r] * 0.1;
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const rowAt = (clientY: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const y = clientY - canvas.getBoundingClientRect().top;
    for (const it of layRef.current.items) {
      if (it.idx >= 0 && it.idx < N && y >= it.y && y < it.y + it.h) return it.idx;
    }
    return -1;
  };

  return (
    <canvas
      ref={canvasRef}
      className="brain-traces"
      aria-label="Neuron activity over the last ten seconds. Click a row to inspect that neuron."
      onClick={(e) => {
        const row = rowAt(e.clientY);
        if (row < 0) return;
        const ui = useUi.getState();
        ui.setFocusNeuron(ui.focusNeuron === row ? null : row);
      }}
      onPointerMove={(e) => {
        const row = rowAt(e.clientY);
        useAttention.getState().setHot(row < 0 ? null : row);
      }}
      onPointerLeave={() => useAttention.getState().setHot(null)}
    />
  );
}
