import type { LinkPartner } from "../brainlink/protocol";
import { selectNeuron, useLarva } from "./link";
import { useState } from "react";

function Partners({ title, list, limit }: { title: string; list: LinkPartner[]; limit: number }) {
  const names = useLarva((s) => s.neurons?.name);
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, limit);
  return (
    <div className="lv-partners">
      <div className="lv-sub">{title}</div>
      {list.length === 0 && <p className="lv-dim">None.</p>}
      <ul>
        {shown.map((p) => (
          <li key={p.neuron}>
            <button type="button" className="lv-link-btn" onClick={() => selectNeuron(p.neuron)}>
              {names?.[p.neuron] ?? `#${p.neuron}`}
            </button>
            <span className="lv-num lv-dim">
              {p.synapses} syn · {p.strength.toFixed(2)}×
            </span>
          </li>
        ))}
      </ul>
      {list.length > limit && (
        <button type="button" className="lv-link-btn lv-dim" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
}

export function InspectorTab() {
  const selected = useLarva((s) => s.selected);
  const detail = useLarva((s) => s.detail);
  const neurons = useLarva((s) => s.neurons);
  const hello = useLarva((s) => s.hello);
  if (selected === null || !neurons || !hello) {
    return <p className="lv-hint">Click a neuron in the 3D view to see what it listens to and who it talks to.</p>;
  }
  const g = hello.groups.find((x) => x.id === neurons.group[selected]);
  const signText = neurons.sign[selected] > 0 ? "excites its targets" : "calms its targets";
  return (
    <div>
      <div className="lv-ihead">
        <strong>{neurons.name[selected]}</strong>
        <button type="button" className="lv-link-btn lv-dim" onClick={() => selectNeuron(null)}>
          Clear
        </button>
      </div>
      <p className="lv-dim">
        {g ? `${g.label} (${g.scientific})` : "Unknown group"} · {neurons.side[selected] < 0 ? "left" : neurons.side[selected] > 0 ? "right" : "centre"}
        {neurons.hasPosition[selected] === 0 ? " · position unknown" : ""}
      </p>
      <p className="lv-dim">
        {signText}
        {neurons.signKnown[selected] === 0 ? " (assumed, not measured)" : ""}
      </p>
      {detail && detail.neuron === selected ? (
        <>
          <p>
            Firing <span className="lv-num">{detail.rateHz.toFixed(1)} Hz</span> · {detail.inDegree} inputs · {detail.outDegree} outputs
          </p>
          <Partners title="Listens most to" list={detail.inputs} limit={5} />
          <Partners title="Talks most to" list={detail.outputs} limit={5} />
          <p className="lv-dim lv-note">syn = synapses in the connectome; × = current strength vs. start.</p>
        </>
      ) : (
        <p className="lv-dim">Loading…</p>
      )}
    </div>
  );
}
