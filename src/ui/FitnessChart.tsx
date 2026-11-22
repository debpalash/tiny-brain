import type { GenerationStats } from "../sim/types";

const W = 260;
const H = 96;
const PAD = { l: 34, r: 8, t: 8, b: 16 };

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

export function FitnessChart({ history }: { history: readonly GenerationStats[] }) {
  const n = history.length;
  if (n === 0) {
    return <p className="ui-muted ui-chart-empty">No generations finished yet.</p>;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const g of history) {
    lo = Math.min(lo, g.best, g.mean);
    hi = Math.max(hi, g.best, g.mean);
  }
  if (hi - lo < 1e-6) {
    const pad = Math.max(1, Math.abs(hi) * 0.1);
    lo -= pad;
    hi += pad;
  }
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * ih;
  const line = (pick: (g: GenerationStats) => number) =>
    history.map((g, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(pick(g)).toFixed(1)}`).join("");
  const last = history[n - 1];
  const first = history[0].generation;
  const lastGen = last.generation;

  return (
    <figure className="ui-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Fitness by generation. Latest best ${fmt(last.best)}, mean ${fmt(last.mean)}.`}
      >
        <line className="ui-chart-grid" x1={PAD.l} x2={W - PAD.r} y1={y(hi)} y2={y(hi)} />
        <line className="ui-chart-grid" x1={PAD.l} x2={W - PAD.r} y1={y(lo)} y2={y(lo)} />
        <text className="ui-chart-text" x={PAD.l - 4} y={y(hi) + 3} textAnchor="end">
          {fmt(hi)}
        </text>
        <text className="ui-chart-text" x={PAD.l - 4} y={y(lo) + 3} textAnchor="end">
          {fmt(lo)}
        </text>
        <text className="ui-chart-text" x={PAD.l} y={H - 3} textAnchor={n === 1 ? "middle" : "start"}>
          {n === 1 ? `gen ${first}` : first}
        </text>
        {n > 1 && (
          <text className="ui-chart-text" x={W - PAD.r} y={H - 3} textAnchor="end">
            {lastGen}
          </text>
        )}
        {n > 1 && (
          <>
            <path className="ui-chart-mean" d={line((g) => g.mean)} />
            <path className="ui-chart-best" d={line((g) => g.best)} />
          </>
        )}
        <circle className="ui-chart-dot-mean" cx={x(n - 1)} cy={y(last.mean)} r="2.5" />
        <circle className="ui-chart-dot-best" cx={x(n - 1)} cy={y(last.best)} r="2.5" />
      </svg>
      <figcaption className="ui-chart-legend">
        <span>
          <svg width="18" height="6" aria-hidden="true">
            <line x1="0" x2="18" y1="3" y2="3" className="ui-chart-best" />
          </svg>
          Best <b className="ui-num">{fmt(last.best)}</b>
        </span>
        <span>
          <svg width="18" height="6" aria-hidden="true">
            <line x1="0" x2="18" y1="3" y2="3" className="ui-chart-mean" />
          </svg>
          Mean <b className="ui-num">{fmt(last.mean)}</b>
        </span>
      </figcaption>
    </figure>
  );
}
