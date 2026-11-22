import { ACTIVITY_FULL_SCALE_HZ } from "../brainlink/protocol";
import type { HelloMsg, StatsMsg } from "../brainlink/protocol";
import { KIND_COLOR } from "./colors";
import { toggleFocusGroup, useLarva } from "./link";
import { buildStrip } from "./pathway";
import type { Stage } from "./pathway";
import { useMemo } from "react";

const ROLE_LABEL: Record<Stage["role"], string> = {
  sensor: "Smell sensors",
  relay: "Relay neurons",
  memory: "Memory cells",
  output: "Output neurons",
  reward: "Reward neurons",
};

function Box({ stage, hello, stats }: { stage: Stage; hello: HelloMsg; stats: StatsMsg }) {
  const focus = useLarva((s) => s.focusGroup);
  const g = hello.groups[stage.group];
  const rate = stats.groupRateHz[stage.group] ?? 0;
  const on = focus === g.id;
  const dim = focus !== null && !on;
  return (
    <button
      type="button"
      className="lv-box"
      data-dim={dim}
      data-on={on}
      aria-pressed={on}
      title={`${g.description}\nClick to focus this group in the 3D view.`}
      onClick={() => toggleFocusGroup(g.id)}
      style={{ "--k": KIND_COLOR[g.kind] } as React.CSSProperties}
    >
      <span className="lv-box-name">{ROLE_LABEL[stage.role]}</span>
      <span className="lv-box-sci">{g.scientific}</span>
      <span className="lv-rate" aria-hidden="true">
        <span style={{ width: `${Math.min(1, rate / ACTIVITY_FULL_SCALE_HZ) * 100}%` }} />
      </span>
      <span className="lv-box-num lv-num">{rate.toFixed(1)} Hz</span>
    </button>
  );
}

/** Smell sensors -> relay -> memory -> output, with reward feeding in at the memory -> output step. */
export function Strip() {
  const hello = useLarva((s) => s.hello);
  const stats = useLarva((s) => s.stats);
  const strip = useMemo(() => (hello ? buildStrip(hello) : null), [hello]);
  if (!hello || !stats || !strip) return null;
  const strength = strip.plasticPathway >= 0 ? stats.pathwayStrength[strip.plasticPathway] : null;
  return (
    <section className="lv-strip" aria-label="Pathway: from smell to decision">
      <div className="lv-strip-row">
        {strip.main.map((st, i) => (
          <div className="lv-strip-cell" key={st.role}>
            {i > 0 && (
              <span className="lv-arrow" aria-hidden="true">
                ›
              </span>
            )}
            <Box stage={st} hello={hello} stats={stats} />
          </div>
        ))}
      </div>
      {strip.reward && (
        <div className="lv-reward">
          <span className="lv-dim">teaches the memory → output link</span>
          <Box stage={strip.reward} hello={hello} stats={stats} />
        </div>
      )}
      {strength !== null && (
        <p className="lv-dim lv-note">
          Learnable link (memory → output): <span className="lv-num">{strength.toFixed(2)}×</span> its starting strength.
        </p>
      )}
    </section>
  );
}
