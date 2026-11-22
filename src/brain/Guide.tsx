import { useEffect } from "react";
import { engine } from "../engine";
import { theme } from "../theme";
import { useAttention } from "./attention";

interface Step {
  title: string;
  verb: string;
  pick: (n: (typeof engine.neurons)[number]) => boolean;
  text?: string;
}

const STEPS: Step[] = [
  { title: "Sense", verb: "report what the cell feels right now", pick: (n) => n.kind === "sensor" },
  { title: "Remember", verb: "follows the food smell slowly, so it holds what things were like a few seconds ago", pick: (n) => n.id === "MEMORY" },
  { title: "Compare", verb: "checks the smell now against memory, and the Messenger passes the verdict on", pick: (n) => n.id === "KINASE" || n.id === "MESSENGER" },
  { title: "Act", verb: "decide whether the cell spins toward a new direction or swims straight, and how fast", pick: (n) => n.kind === "motor" },
  {
    title: "Learn",
    verb: "",
    pick: (n) => n.id === "SCENT" || n.id === "KINASE",
    text: "When something good or bad happens, connections that were active just before get stronger or weaker, so the cell's past changes its future behaviour. Offspring inherit the inborn wiring, not what the parent learned.",
  },
];

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function Guide() {
  const setGuide = useAttention((s) => s.setGuide);
  const showWeak = useAttention((s) => s.showWeak);
  const setShowWeak = useAttention((s) => s.setShowWeak);
  useEffect(() => () => setGuide(null), [setGuide]);

  return (
    <div>
      <ol className="brain-steps">
        {STEPS.map((s, k) => {
          const ns = engine.neurons.filter(s.pick);
          const idx = ns.map((n) => n.index);
          return (
            <li
              key={s.title}
              tabIndex={0}
              onMouseEnter={() => setGuide(idx)}
              onMouseLeave={() => setGuide(null)}
              onFocus={() => setGuide(idx)}
              onBlur={() => setGuide(null)}
            >
              <span className="brain-stepn">{k + 1}</span>
              <span>
                <strong>{s.title}.</strong> {s.text ?? `${list(ns.map((n) => n.label))} ${s.verb}.`}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="brain-dim">Real bacteria do this with chemistry, proteins inside the cell, rather than neurons.</p>
      <div className="brain-legend">
        <span className="brain-leg">
          <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
            <path d="M1 5h15" stroke={theme.excite} strokeWidth="1.4" />
            <polygon points="22,5 15,1.8 15,8.2" fill={theme.excite} />
          </svg>
          Arrow: excites the next neuron
        </span>
        <span className="brain-leg">
          <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
            <path d="M1 5h19" stroke={theme.inhibit} strokeWidth="1.4" />
            <path d="M21 1v8" stroke={theme.inhibit} strokeWidth="2" strokeLinecap="round" />
          </svg>
          Bar: calms it
        </span>
        <span className="brain-leg">
          <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
            <path d="M1 5h22" stroke={theme.textDim} strokeWidth="1.4" strokeDasharray="1.5 3" />
          </svg>
          Dotted line: can learn
        </span>
        <span className="brain-leg">
          <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
            <path d="M1 5h22" stroke={theme.textDim} strokeWidth="1.4" />
            <circle cx="12" cy="5" r="2.6" fill={theme.text} stroke={theme.bg} />
          </svg>
          Dot on a line: learned
        </span>
        <span className="brain-leg">
          <svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true">
            <clipPath id="brain-leg-clip">
              <circle r="6.5" />
            </clipPath>
            <rect x="-7" y="0" width="14" height="7" fill={theme.inter} opacity="0.5" clipPath="url(#brain-leg-clip)" />
            <circle r="7" fill="none" stroke={theme.inter} strokeWidth="1.2" />
          </svg>
          Fill level: how active
        </span>
        <span className="brain-leg">
          <svg width="30" height="13" viewBox="0 0 32 13" aria-hidden="true">
            <rect width="32" height="13" rx="3" fill={theme.bg} stroke={theme.textDim} />
            <path d="M5 6.5h5v4h-5zM6 6.5v-1.5a1.5 1.5 0 0 1 3 0v1.5" fill="none" stroke={theme.text} strokeWidth="0.9" />
            <text x="13" y="9.7" className="brain-badge" fill={theme.text}>
              on
            </text>
          </svg>
          Lock: you are holding it on or off
        </span>
      </div>
      <label className="brain-toggle">
        <input className="brain-check" type="checkbox" checked={showWeak} onChange={(e) => setShowWeak(e.target.checked)} />
        Show weak links in the diagram
      </label>
    </div>
  );
}
