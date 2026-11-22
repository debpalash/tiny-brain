import { useEffect, useRef, useState } from "react";
import { Controls } from "./Controls";
import { GuideTab } from "./GuideTab";
import { InspectorTab } from "./Inspector";
import { Meter } from "./Meter";
import { Strip } from "./Strip";
import { send, useLarva } from "./link";
import { liveSentence } from "./sentence";

type Tab = "brain" | "neuron" | "guide";
const TABS: { id: Tab; label: string }[] = [
  { id: "brain", label: "Brain" },
  { id: "neuron", label: "Neuron" },
  { id: "guide", label: "Guide" },
];
const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];

export function Panel() {
  const hello = useLarva((s) => s.hello);
  const stats = useLarva((s) => s.stats);
  const verdict = useLarva((s) => s.verdict);
  const selected = useLarva((s) => s.selected);
  const [tab, setTab] = useState<Tab>("brain");
  const back = useRef<Tab>("brain");
  const tabNow = useRef<Tab>(tab);
  useEffect(() => {
    tabNow.current = tab;
  });

  // Selecting a neuron opens the Neuron tab; clearing it returns to where the user was.
  useEffect(
    () =>
      useLarva.subscribe((s, p) => {
        if (s.selected === p.selected) return;
        if (s.selected !== null && p.selected === null) {
          if (tabNow.current !== "neuron") back.current = tabNow.current;
          setTab("neuron");
        } else if (s.selected === null && tabNow.current === "neuron") setTab(back.current);
      }),
    [],
  );

  const idx = SPEEDS.indexOf(stats?.speed ?? 1);
  return (
    <div className="lv-root">
      <header className="lv-head">
        <strong>{hello?.network.name ?? "Fly larva brain"}</strong>
        <span className="lv-head-ctl">
          <button
            type="button"
            className="lv-btn"
            aria-pressed={stats?.paused ?? false}
            onClick={() => send({ type: "setPaused", paused: !(stats?.paused ?? false) })}
          >
            {stats?.paused ? "Play" : "Pause"}
          </button>
          <label className="lv-dim">
            <span className="lv-sr">Speed</span>
            <select
              className="lv-select"
              value={idx >= 0 ? SPEEDS[idx] : 1}
              onChange={(e) => send({ type: "setSpeed", speed: Number(e.target.value) })}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
        </span>
      </header>
      <p className="lv-sentence" aria-live="polite">
        {liveSentence(hello, stats, verdict)}
      </p>
      <div className="lv-tabs" role="tablist" aria-label="Brain details">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "neuron" && selected !== null ? " •" : ""}
          </button>
        ))}
      </div>
      <div className="lv-pane" role="tabpanel">
        {tab === "brain" && (
          <>
            <Strip />
            <Meter />
            <Controls />
          </>
        )}
        {tab === "neuron" && <InspectorTab />}
        {tab === "guide" && <GuideTab />}
      </div>
    </div>
  );
}
