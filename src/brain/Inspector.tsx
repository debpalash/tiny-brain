import { useEffect, useRef, useState } from "react";
import { engine } from "../engine";
import { N, WEIGHT_MAX } from "../sim/types";
import type { Bacterium, NeuronKind } from "../sim/types";
import { theme } from "../theme";
import { useUi } from "../uiStore";
import { ROLE_NAME } from "./attention";

const kindColor: Record<NeuronKind, string> = { sensor: theme.sensor, inter: theme.inter, motor: theme.motor };

/** What each neuron stands for in a real E. coli cell. Neurons missing here just show no line. */
const REAL: Partial<Record<string, string>> = {
  FOOD: "Tar and Tsr attractant receptors in the cell membrane.",
  TOXIN: "Receptors that sense repellents.",
  ENERGY: "The cell's energy state, which real E. coli also senses (energy taxis via Aer).",
  MEMORY: "Receptor methylation, added and removed by the CheR and CheB enzymes.",
  KINASE: "The CheA kinase, which becomes more or less active as the receptors change.",
  MESSENGER: "CheY-P, a small molecule that carries the signal to the motor.",
  TUMBLE: "The flagellar motor switching to clockwise rotation, which splays the flagella apart.",
  SCENT: "Real bacteria cannot learn within one lifetime like this; this is the first step beyond them, toward brains that change with experience.",
  RUN: "Flagella bundled together, turning counter-clockwise to push the cell forward.",
};

function WeightRow({
  text,
  w,
  inborn,
  plastic,
  onChange,
  label,
}: {
  text: string;
  w: number;
  inborn: number;
  plastic: boolean;
  onChange: (v: number) => void;
  label: string;
}) {
  const learned = Math.abs(w - inborn) >= 0.05;
  const c = Math.abs(w) < 0.005 ? theme.textDim : w > 0 ? theme.excite : theme.inhibit;
  const end = 50 + (w / WEIGHT_MAX) * 50;
  const lo = Math.min(50, end);
  const hi = Math.max(50, end);
  const fill = `linear-gradient(to right, transparent ${lo}%, ${c} ${lo}%, ${c} ${hi}%, transparent ${hi}%)`;
  return (
    <div className="brain-wrow">
      <span className="brain-wname" title={text}>
        {text}
      </span>
      <div className="brain-slidewrap">
        <input
          className="brain-slider"
          type="range"
          min={-WEIGHT_MAX}
          max={WEIGHT_MAX}
          step={0.1}
          value={w}
          aria-label={label}
          style={{ "--c": c, "--fill": fill } as React.CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(0)}
        />
      </div>
      <span className="brain-num" style={{ color: c }}>
        {w > 0 ? "+" : ""}
        {w.toFixed(1)}
      </span>
      {(plastic || learned) && (
        <span className="brain-wsub">
          {plastic && <span className="brain-chip2">can learn</span>}
          {learned && (
            <>
              <span className="brain-num">
                {inborn.toFixed(1)} {"->"} {w.toFixed(1)}
              </span>
              <span>learned</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}

const inText = (name: string, w: number) =>
  Math.abs(w) < 0.05 ? `${name}: no link` : w > 0 ? `${name} excites it` : `${name} calms it`;
const outText = (name: string, w: number) =>
  Math.abs(w) < 0.05 ? `No link to ${name}` : w > 0 ? `Excites ${name}` : `Calms ${name}`;

export function Inspector({ bact }: { bact: Bacterium }) {
  const focus = useUi((s) => s.focusNeuron);
  const [all, setAll] = useState(false);
  const liveRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (focus === null) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const b = engine.selected();
      if (b && liveRef.current) liveRef.current.textContent = b.act[focus].toFixed(2);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [focus]);

  if (focus === null) {
    return <p className="brain-hint">Select a neuron in the diagram or in the activity rows to see what it does and to poke it.</p>;
  }
  const info = engine.neurons[focus];
  const cl = bact.clamp[focus];
  const wts = bact.w;
  const inb = bact.genome.weights;
  const pl = bact.genome.plastic;
  const nz = (v: number) => Math.abs(v) >= 0.005;
  const real = REAL[info.id];

  const incoming: number[] = [];
  const outgoing: number[] = [];
  for (let j = 0; j < N; j++) {
    if (all || nz(wts[j * N + focus])) incoming.push(j);
    if (all || nz(wts[focus * N + j])) outgoing.push(j);
  }
  const nameOf = (j: number) => (j === focus ? "Itself" : engine.neurons[j].label);

  return (
    <div>
      <div className="brain-ihead">
        <strong>{info.label}</strong>
        <span className="brain-chip" style={{ color: kindColor[info.kind], borderColor: kindColor[info.kind] }}>
          {ROLE_NAME[info.kind]}
        </span>
        <span className="brain-num brain-ival" aria-label="Current activity">
          <span ref={liveRef}>0.00</span>
        </span>
      </div>
      <p className="brain-what">
        <span className="brain-cap">What it does. </span>
        {info.description}
      </p>
      {real && (
        <p className="brain-real">
          <span className="brain-cap">In a real bacterium: </span>
          {real}
        </p>
      )}
      <div className="brain-seg" role="group" aria-label={`Force ${info.label}`}>
        <button
          type="button"
          aria-pressed={cl !== null && cl > 0.5}
          aria-label={`Stimulate ${info.label}: hold it fully on`}
          onClick={() => engine.setClamp(focus, 1)}
        >
          Force on
        </button>
        <button
          type="button"
          aria-pressed={cl !== null && cl <= 0.5}
          aria-label={`Silence ${info.label}: hold it fully off`}
          onClick={() => engine.setClamp(focus, 0)}
        >
          Force off
        </button>
        <button type="button" aria-pressed={cl === null} aria-label={`Release ${info.label}`} onClick={() => engine.setClamp(focus, null)}>
          Let it run
        </button>
      </div>

      <div className="brain-bar brain-sub">
        <span>Listens to</span>
        <button type="button" className="brain-link" aria-pressed={all} onClick={() => setAll(!all)}>
          {all ? "Linked only" : "All links"}
        </button>
      </div>
      {incoming.length === 0 && <p className="brain-dim">No incoming links.</p>}
      {incoming.map((j) => (
        <WeightRow
          key={j}
          text={inText(nameOf(j), wts[j * N + focus])}
          w={wts[j * N + focus]}
          inborn={inb[j * N + focus]}
          plastic={pl[j * N + focus] > 0}
          label={`Weight from ${engine.neurons[j].label} to ${info.label}`}
          onChange={(v) => engine.setWeight(j, focus, v)}
        />
      ))}
      <div className="brain-bar brain-sub">
        <span>Talks to</span>
      </div>
      {outgoing.length === 0 && <p className="brain-dim">No outgoing links.</p>}
      {outgoing.map((j) => (
        <WeightRow
          key={j}
          text={outText(nameOf(j), wts[focus * N + j])}
          w={wts[focus * N + j]}
          inborn={inb[focus * N + j]}
          plastic={pl[focus * N + j] > 0}
          label={`Weight from ${info.label} to ${engine.neurons[j].label}`}
          onChange={(v) => engine.setWeight(focus, j, v)}
        />
      ))}
    </div>
  );
}
