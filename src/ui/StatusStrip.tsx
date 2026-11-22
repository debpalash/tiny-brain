import { useRef, useState } from "react";
import { engine } from "../engine";
import { useEngineVersion } from "../uiStore";
import type { GenerationStats } from "../sim/types";
import { ChevronIcon } from "./icons";
import { FitnessChart } from "./FitnessChart";
import { useDismiss } from "./useDismiss";
import { useHeld } from "./useHeld";
import { usePoll } from "./usePoll";

const HZ = 4;
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

function Bar({ value, label, warn }: { value: number; label: string; warn?: boolean }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      className="ui-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <div className={warn ? "ui-bar-fill ui-bar-warn" : "ui-bar-fill"} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

const readSolo = () => {
  const b = engine.selected();
  return b ? ([1, Math.round(b.energy * 100), b.tumbling, b.alive, b.foodEaten] as const) : ([0, 0, false, false, 0] as const);
};

function Solo() {
  const [has, energy, tumbling, alive, eaten] = usePoll(readSolo, HZ);
  const tumble = useHeld(tumbling, 500);
  if (!has) return <span className="ui-cap">Select a cell to see its energy</span>;
  return (
    <>
      <span className="ui-stat">
        <span className="ui-cap">Energy</span>
        <Bar value={energy / 100} label="Energy" warn={energy < 25} />
        <span className="ui-num ui-pct">{energy}%</span>
      </span>
      <span className="ui-num">
        <span className="ui-cap">Eaten </span>
        {Math.floor(eaten)}
      </span>
      <span className="ui-state ui-narrow-hide">
        {!alive ? "Out of energy" : tumble ? "Tumbling" : "Swimming straight"}
      </span>
    </>
  );
}

function Sparkline({ history }: { history: readonly GenerationStats[] }) {
  const W = 48;
  const H = 16;
  if (history.length < 2) {
    return (
      <svg width={W} height={H} aria-hidden="true">
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="ui-spark-empty" />
      </svg>
    );
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const g of history) {
    lo = Math.min(lo, g.best);
    hi = Math.max(hi, g.best);
  }
  const span = hi - lo || 1;
  const d = history
    .map((g, i) => {
      const x = (i / (history.length - 1)) * (W - 2) + 1;
      const y = H - 2 - ((g.best - lo) / span) * (H - 4);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join("");
  return (
    <svg width={W} height={H} aria-hidden="true">
      <path d={d} className="ui-spark" />
    </svg>
  );
}

const readEvo = () =>
  [Math.ceil(engine.generationTimeLeft), engine.generationLength, engine.bacteria.filter((b) => b.alive).length] as const;

function Evolution() {
  const [left, length, alive] = usePoll(readEvo, HZ);
  const total = engine.bacteria.length;
  const history = engine.history;
  const last = history.length ? history[history.length - 1] : null;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  useDismiss(open, close, wrap, trigger);

  return (
    <>
      <span className="ui-stat">
        <span className="ui-num">Gen {engine.generation}</span>
      </span>
      <span className="ui-stat ui-narrow-hide" title="Time left in this generation">
        <Bar value={length > 0 ? left / length : 0} label="Generation time left" />
        <span className="ui-num ui-secs">{left}s</span>
      </span>
      <span className="ui-num">
        {alive}/{total}
        <span className="ui-cap"> alive</span>
      </span>
      <span className="ui-num ui-narrow-hide">
        <span className="ui-cap">Best </span>
        {last ? fmt(last.best) : "-"}
      </span>
      <span className="ui-pop-wrap ui-narrow-hide" ref={wrap}>
        <button
          ref={trigger}
          type="button"
          className="ui-btn ui-tip ui-tip-end"
          data-tip="Fitness chart"
          data-tip-pos="down"
          aria-label="Fitness chart"
          aria-expanded={open}
          aria-controls="ui-chart-pop"
          onClick={() => setOpen(!open)}
        >
          <Sparkline history={history} />
          <ChevronIcon dir="down" />
        </button>
        {open && (
          <div id="ui-chart-pop" className="ui-pop ui-panel" role="region" aria-label="Fitness by generation">
            <p className="ui-cap">Score = food eaten minus toxin damage</p>
            <FitnessChart history={history} />
          </div>
        )}
      </span>
      <button type="button" className="ui-btn ui-narrow-hide" onClick={() => engine.nextGeneration()}>
        Next
      </button>
    </>
  );
}

export function StatusStrip() {
  useEngineVersion();
  return (
    <div className="ui-status" aria-label="Status">
      <div className="ui-status-items">{engine.mode === "solo" ? <Solo /> : <Evolution />}</div>
    </div>
  );
}
