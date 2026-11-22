import "./brain.css";
import { useEffect, useRef, useState } from "react";
import { engine } from "../engine";
import { useEngineVersion, useUi } from "../uiStore";
import { ActionsMenu } from "./ActionsMenu";
import { BrainDiagram } from "./BrainDiagram";
import { Guide } from "./Guide";
import { Inspector } from "./Inspector";
import { LearningRow } from "./Learning";
import { Readout } from "./Readout";
import { ActivityTab } from "./Traces";

type Tab = "activity" | "neuron" | "guide";
const TABS: { id: Tab; label: string }[] = [
  { id: "activity", label: "Activity" },
  { id: "neuron", label: "Neuron" },
  { id: "guide", label: "Guide" },
];

export function BrainPanel() {
  const version = useEngineVersion();
  const b = engine.selected();
  const [tab, setTab] = useState<Tab>("activity");
  const returnTab = useRef<Tab>("activity");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabNow = useRef<Tab>(tab);
  useEffect(() => {
    tabNow.current = tab;
  });

  // Selecting a neuron opens the Neuron tab; clearing returns to where the user was.
  useEffect(
    () =>
      useUi.subscribe((s, p) => {
        if (s.focusNeuron === p.focusNeuron) return;
        if (s.focusNeuron !== null && p.focusNeuron === null) {
          if (tabNow.current !== "neuron") returnTab.current = tabNow.current;
          setTab("neuron");
        } else if (s.focusNeuron === null && tabNow.current === "neuron") {
          setTab(returnTab.current);
        }
      }),
    [],
  );

  if (!b) {
    return (
      <div className="brain-root">
        <div className="brain-empty">Select a bacterium</div>
      </div>
    );
  }

  const onTabKey = (e: React.KeyboardEvent, k: number) => {
    let n = -1;
    if (e.key === "ArrowRight") n = (k + 1) % TABS.length;
    else if (e.key === "ArrowLeft") n = (k + TABS.length - 1) % TABS.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = TABS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setTab(TABS[n].id);
    tabRefs.current[n]?.focus();
  };

  return (
    <div
      className="brain-root"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        const f = useUi.getState().focusNeuron;
        if (f === null) return;
        useUi.getState().setFocusNeuron(null);
        document.querySelector<SVGGElement>(`.brain-root [data-neuron="${f}"]`)?.focus();
      }}
    >
      <header className="brain-head">
        <span>
          <strong>Brain</strong> <span className="brain-num brain-dim">cell {b.id}</span>
        </span>
        <ActionsMenu />
      </header>
      <div className="brain-top">
        <Readout />
        <BrainDiagram version={version} />
        <LearningRow />
      </div>
      <div className="brain-tabs" role="tablist" aria-label="Brain details">
        {TABS.map((t, k) => (
          <button
            key={t.id}
            ref={(o) => {
              tabRefs.current[k] = o;
            }}
            type="button"
            role="tab"
            id={`brain-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`brain-pane-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, k)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="brain-pane">
        {/* Activity stays mounted so its 10 s history survives tab switches. */}
        <div role="tabpanel" id="brain-pane-activity" aria-labelledby="brain-tab-activity" hidden={tab !== "activity"}>
          <ActivityTab />
        </div>
        {tab === "neuron" && (
          <div role="tabpanel" id="brain-pane-neuron" aria-labelledby="brain-tab-neuron">
            <Inspector bact={b} />
          </div>
        )}
        {tab === "guide" && (
          <div role="tabpanel" id="brain-pane-guide" aria-labelledby="brain-tab-guide">
            <Guide />
          </div>
        )}
      </div>
    </div>
  );
}
