import { lazy, Suspense, useCallback, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { BrainPanel } from "../brain/BrainPanel";
import { WorldScene } from "../scene/WorldScene";
import { theme } from "../theme";
import { ErrorBoundary } from "./ErrorBoundary";
import { Guide, guideSeen } from "./Guide";
import { ChevronIcon } from "./icons";
import { Toolbar } from "./Toolbar";
import { TopBar } from "./TopBar";
import { useShortcuts } from "./useShortcuts";
import { useSimLoop } from "./useSimLoop";
import { loadView, saveView } from "./view";
import type { View } from "./view";
import "./ui.css";

const LarvaApp = lazy(() => import("../larva/LarvaApp").then((m) => ({ default: m.LarvaApp })));

const vars = {
  "--bg": theme.bg,
  "--panel": theme.panel,
  "--border": theme.panelBorder,
  "--text": theme.text,
  "--dim": theme.textDim,
  "--accent": theme.accent,
  "--food": theme.food,
  "--toxin": theme.toxin,
  "--excite": theme.excite,
  "--inhibit": theme.inhibit,
  "--font-ui": theme.fontUi,
  "--font-mono": theme.fontMono,
} as CSSProperties;

export function App() {
  const [view, setView] = useState<View>(loadView);
  const onView = useCallback((v: View) => {
    saveView(v);
    setView(v);
  }, []);
  if (view === "larva") {
    return (
      <Suspense fallback={null}>
        <LarvaApp view={view} onView={onView} />
      </Suspense>
    );
  }
  return <BacteriumApp view={view} onView={onView} />;
}

function BacteriumApp({ view, onView }: { view: View; onView: (v: View) => void }) {
  useSimLoop();
  const [open, setOpen] = useState(true);
  const [guide, setGuide] = useState(() => !guideSeen());
  const rootRef = useRef<HTMLDivElement>(null);
  const closeGuide = useCallback(() => setGuide(false), []);
  const openGuide = useCallback(() => setGuide(true), []);
  const toggleBrain = useCallback(() => setOpen((o) => !o), []);
  useShortcuts({ toggleBrain, openGuide });

  const setDish = (active: boolean) => {
    if (rootRef.current) rootRef.current.dataset.dish = active ? "on" : "off";
  };

  return (
    <div ref={rootRef} className="ui-root" style={vars} data-panel={open ? "open" : "closed"} data-dish="off">
      <main className="ui-stage">
        <TopBar view={view} onView={onView} onGuide={openGuide} />
        <div className="ui-dish">
          <div className="ui-canvas" onPointerEnter={() => setDish(true)} onPointerLeave={() => setDish(false)}>
            <ErrorBoundary label="dish">
              <WorldScene />
            </ErrorBoundary>
          </div>
          <Toolbar />
        </div>
      </main>
      <div className="ui-side-wrap">
        <button
          type="button"
          className="ui-edge-toggle"
          title={open ? "Hide brain (B)" : "Show brain (B)"}
          aria-expanded={open}
          aria-controls="ui-brain"
          aria-label={open ? "Hide brain panel" : "Show brain panel"}
          onClick={toggleBrain}
        >
          <span className="ui-toggle-wide">
            <ChevronIcon dir={open ? "right" : "left"} />
          </span>
          <span className="ui-toggle-narrow">
            <ChevronIcon dir={open ? "down" : "up"} />
          </span>
        </button>
        <aside id="ui-brain" className="ui-side" aria-label="Brain" aria-hidden={!open} inert={!open}>
          <div className="ui-side-inner">
            <ErrorBoundary label="brain view">
              <BrainPanel />
            </ErrorBoundary>
          </div>
        </aside>
      </div>
      {guide && <Guide onClose={closeGuide} />}
    </div>
  );
}
