import { useEffect, useRef } from "react";

const KEY = "bacteria-brain:guide-seen";

const SHORTCUTS: [string, string][] = [
  ["1-5", "Choose a tool"],
  ["Space", "Play or pause"],
  ["[ ]", "Slower or faster"],
  ["E", "Switch mode"],
  ["B", "Show or hide the brain"],
  ["?", "Open this guide"],
  ["Esc", "Close menus and popovers"],
];

export function guideSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function Guide({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* storage unavailable */
    }
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    const focusables = () =>
      Array.from(root?.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])") ?? []);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const f = focusables();
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (!root?.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);

  return (
    <div className="ui-scrim" onMouseDown={onClose}>
      <div
        ref={ref}
        className="ui-guide ui-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ui-guide-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="ui-guide-title">How to read this</h2>
        <p>
          A bacterium has no neurons. It decides where to swim with a tiny chemical circuit. Here it
          is drawn as 8 neurons. The dish is on the left; the brain of the selected cell is on the
          right, with senses on one side and actions on the other. The brain can also change with
          experience: a first step from a fixed circuit toward a brain that learns.
        </p>
        <h3>Modes</h3>
        <ul className="ui-plain">
          <li>
            <strong>One cell:</strong> a single cell with a hand-wired brain. Drop food and watch it
            find its way.
          </li>
          <li>
            <strong>Evolution:</strong> many cells with random brains. The best food-finders have
            offspring with small mutations. Score = food eaten minus toxin damage.
          </li>
        </ul>
        <h3>Dish colours</h3>
        <ul className="ui-legend-list">
          <li>
            <span className="ui-swatch ui-swatch-food" aria-hidden="true" />
            <span>
              <strong>Green, soft circle:</strong> food. Cells want to reach it.
            </span>
          </li>
          <li>
            <span className="ui-swatch ui-swatch-toxin" aria-hidden="true" />
            <span>
              <strong>Rose, ringed with a cross:</strong> toxin. Cells want to avoid it.
            </span>
          </li>
        </ul>
        <h3>Try this</h3>
        <ol>
          <li>Drop food far from the cell and watch how it finds it.</li>
          <li>Select a cell, then force the Tumble neuron on and off.</li>
          <li>Switch to Evolution and compare generation 1 with generation 30.</li>
          <li>
            Teach it: set scent to come with food, let the cell eat a few times, then drop a scent
            on its own far from the cell and watch it follow. Press Forget in the brain panel and
            compare.
          </li>
        </ol>
        <h3>Shortcuts</h3>
        <table className="ui-keys">
          <tbody>
            {SHORTCUTS.map(([k, d]) => (
              <tr key={d}>
                <th scope="row">
                  <kbd className="ui-kbd">{k}</kbd>
                </th>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="ui-btn ui-btn-primary ui-guide-close" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
