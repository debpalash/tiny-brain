import { engine } from "../engine";
import { useEngineVersion } from "../uiStore";
import type { Mode } from "../sim/types";

const MODES: { id: Mode; label: string; tip: string }[] = [
  { id: "solo", label: "One cell", tip: "One cell with a hand-wired brain (E)" },
  { id: "evolution", label: "Evolution", tip: "Many random brains that breed over generations (E)" },
];

export function ModeSwitch() {
  useEngineVersion();
  return (
    <div className="ui-segment" role="group" aria-label="Mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className="ui-seg-btn ui-tip"
          data-tip={m.tip}
          data-tip-pos="down"
          aria-pressed={engine.mode === m.id}
          onClick={() => engine.setMode(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
