import { useLarva } from "./link";
import { verdictOf } from "./sentence";

const W = 240;
const H = 30;

/** Approach / avoid meter with a short history line, plus the verdicts recorded by Test runs. */
export function Meter() {
  const stats = useLarva((s) => s.stats);
  const history = useLarva((s) => s.history);
  const verdicts = useLarva((s) => s.verdicts);
  const hello = useLarva((s) => s.hello);
  if (!stats || !hello) return null;
  const a = Math.max(-1, Math.min(1, stats.approach));
  const points = history
    .map((v, i) => `${((i / Math.max(1, history.length - 1)) * W).toFixed(1)},${(H / 2 - Math.max(-1, Math.min(1, v)) * (H / 2 - 2)).toFixed(1)}`)
    .join(" ");
  const name = (id: number) => hello.odours.find((o) => o.id === id)?.label ?? "Odour";
  return (
    <section className="lv-meter" aria-label="The brain's verdict">
      <div className="lv-meter-head">
        <span>Verdict</span>
        <span className="lv-num lv-dim">
          {verdictOf(a)} {a >= 0 ? "+" : ""}
          {a.toFixed(2)}
        </span>
      </div>
      <div className="lv-meter-bar" role="img" aria-label={`approach ${a.toFixed(2)} on a scale from -1 avoid to +1 approach`}>
        <span className="lv-meter-mid" />
        <span className="lv-meter-dot" style={{ left: `${(a + 1) * 50}%` }} />
      </div>
      <div className="lv-meter-ends lv-dim">
        <span>avoid</span>
        <span>approach</span>
      </div>
      <svg className="lv-hist" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="lv-hist-zero" />
        {history.length > 1 && <polyline points={points} className="lv-hist-line" />}
      </svg>
      {verdicts.length > 0 && (
        <ul className="lv-verdicts">
          {verdicts.slice(-4).map((v, i, all) => (
            <li key={verdicts.length - all.length + i}>
              <span>{name(v.odour)}</span>
              <span className="lv-num">
                {verdictOf(v.approach)} {v.approach >= 0 ? "+" : ""}
                {v.approach.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
