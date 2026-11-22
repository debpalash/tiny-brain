import type { View } from "./view";

const VIEWS: { id: View; label: string; tip: string }[] = [
  { id: "bacterium", label: "Bacterium", tip: "A single cell with a small hand-wired brain" },
  { id: "larva", label: "Fly larva", tip: "A real insect brain from a published connectome (needs the native engine)" },
];

export function ViewSwitch({ view, onView }: { view: View; onView: (v: View) => void }) {
  return (
    <div className="ui-segment" role="group" aria-label="View">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          className="ui-seg-btn ui-tip"
          data-tip={v.tip}
          data-tip-pos="down"
          aria-pressed={view === v.id}
          onClick={() => onView(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
