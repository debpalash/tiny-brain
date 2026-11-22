import { useState } from "react";
import { send, useLarva } from "./link";
import { cancelPlan, startPlan, useRunner } from "./runner";
import { teachPlan, testPlan } from "./sequence";

const SMELL_SECONDS = 4;
const REWARD_SECONDS = 2;

export function Controls() {
  const hello = useLarva((s) => s.hello);
  const stats = useLarva((s) => s.stats);
  const run = useRunner();
  const [pick, setPick] = useState<number | null>(null);
  if (!hello || !stats) return null;
  const odour = hello.odours.find((o) => o.id === pick) ?? hello.odours[0];
  if (!odour) return null;
  const busy = run.active;
  return (
    <section className="lv-controls" aria-label="Controls">
      <div className="lv-sub">Smell</div>
      <div className="lv-chips" role="radiogroup" aria-label="Smell to use">
        {hello.odours.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.id === odour.id}
            className="lv-chip"
            title={`${o.sensors} smell sensors respond to this smell`}
            onClick={() => setPick(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {busy ? (
        <div className="lv-run" role="status">
          <div className="lv-run-head">
            <span>{run.name}</span>
            <button type="button" className="lv-btn" onClick={cancelPlan}>
              Cancel
            </button>
          </div>
          <div className="lv-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(run.progress * 100)}>
            <span style={{ width: `${run.progress * 100}%` }} />
          </div>
          <span className="lv-dim">{run.label}</span>
        </div>
      ) : (
        <>
          <div className="lv-row">
            <button
              type="button"
              className="lv-btn"
              title={`Present ${odour.label} for ${SMELL_SECONDS} seconds`}
              onClick={() => send({ type: "odour", odour: odour.id, seconds: SMELL_SECONDS })}
            >
              Smell it
            </button>
            <button
              type="button"
              className="lv-btn"
              title="Present the smell and write down the brain's verdict"
              onClick={() => startPlan(testPlan(odour))}
            >
              Test
            </button>
            <button
              type="button"
              className="lv-btn"
              title="Reward signal on its own"
              onClick={() => send({ type: "reward", value: 1, seconds: REWARD_SECONDS })}
            >
              Reward
            </button>
            <button
              type="button"
              className="lv-btn"
              title="Punishment signal on its own"
              onClick={() => send({ type: "reward", value: -1, seconds: REWARD_SECONDS })}
            >
              Punish
            </button>
          </div>
          <div className="lv-row">
            <button
              type="button"
              className="lv-btn lv-primary"
              disabled={!stats.learning}
              title={stats.learning ? "Present the smell, then reward it" : "Turn learning on first"}
              onClick={() => startPlan(teachPlan(odour, 1))}
            >
              Teach: {odour.label} + reward
            </button>
            <button
              type="button"
              className="lv-btn"
              disabled={!stats.learning}
              title={stats.learning ? "Present the smell, then punish it" : "Turn learning on first"}
              onClick={() => startPlan(teachPlan(odour, -1))}
            >
              + punishment
            </button>
          </div>
        </>
      )}

      <details className="lv-more">
        <summary>More controls</summary>
        <div className="lv-row">
          <label className="lv-check">
            <input type="checkbox" checked={stats.learning} onChange={(e) => send({ type: "setLearning", on: e.target.checked })} />
            Learning
          </label>
          <button type="button" className="lv-btn" title="Weights back to their starting values" onClick={() => send({ type: "forget" })}>
            Forget
          </button>
          <button type="button" className="lv-btn" title="Restart from time 0" onClick={() => send({ type: "reset" })}>
            Reset
          </button>
          <button type="button" className="lv-btn" onClick={() => send({ type: "clearStimuli" })}>
            Stop all
          </button>
        </div>
      </details>
    </section>
  );
}
