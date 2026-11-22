import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { ChevronIcon } from "../ui/icons";
import { TopBar } from "../ui/TopBar";
import type { View } from "../ui/view";
import { theme } from "../theme";
import { BrainScene } from "./BrainScene";
import { Offline } from "./Offline";
import { Panel } from "./Panel";
import { connect, disconnect, useLarva } from "./link";
import { initRunner } from "./runner";
import "./larva.css";

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

function StatusChip() {
  const conn = useLarva((s) => s.conn);
  const stats = useLarva((s) => s.stats);
  const text =
    conn === "connected"
      ? stats
        ? `Engine connected · ${stats.realtimeFactor.toFixed(1)}× real time`
        : "Engine connected"
      : conn === "connecting"
        ? "Connecting…"
        : conn === "mismatch"
          ? "Engine version mismatch"
          : "Engine not running";
  return (
    <span className="lv-chipstat" data-state={conn}>
      <span className="lv-dot" aria-hidden="true" />
      {text}
    </span>
  );
}

function Hover() {
  const hovered = useLarva((s) => s.hovered);
  const neurons = useLarva((s) => s.neurons);
  const hello = useLarva((s) => s.hello);
  if (hovered === null || !neurons || !hello) return null;
  const g = hello.groups.find((x) => x.id === neurons.group[hovered]);
  return (
    <div className="lv-hover">
      {neurons.name[hovered]} <span className="lv-dim">· {g?.label ?? "unknown group"}</span>
    </div>
  );
}

export function LarvaApp({ view, onView }: { view: View; onView: (v: View) => void }) {
  const [open, setOpen] = useState(true);
  const live = useLarva((s) => s.conn === "connected" && s.hello !== null && s.neurons !== null);
  const sided = useLarva((s) => s.neurons?.side.some((v) => v !== 0) ?? false);

  useEffect(() => {
    connect();
    const off = initRunner();
    return () => {
      off();
      disconnect();
    };
  }, []);

  return (
    <div className="ui-root" style={vars} data-panel={open && live ? "open" : "closed"} data-dish="off">
      <main className="ui-stage">
        <TopBar view={view} onView={onView} right={<StatusChip />} />
        <div className="ui-dish">
          <div className="ui-canvas">
            <ErrorBoundary label="brain view">{live ? <BrainScene /> : <Offline />}</ErrorBoundary>
          </div>
          {live && (
            <>
              <div className="lv-hint-bar lv-dim">Drag to turn · scroll to zoom · click a neuron to inspect</div>
              {sided && (
                <div className="lv-lr lv-dim" aria-hidden="true">
                  <span>Left</span>
                  <span>Right</span>
                </div>
              )}
              <Hover />
            </>
          )}
        </div>
      </main>
      {live && (
        <div className="ui-side-wrap">
          <button
            type="button"
            className="ui-edge-toggle"
            aria-expanded={open}
            aria-label={open ? "Hide brain panel" : "Show brain panel"}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="ui-toggle-wide">
              <ChevronIcon dir={open ? "right" : "left"} />
            </span>
            <span className="ui-toggle-narrow">
              <ChevronIcon dir={open ? "down" : "up"} />
            </span>
          </button>
          <aside className="ui-side" aria-label="Fly larva brain" aria-hidden={!open} inert={!open}>
            <div className="ui-side-inner">
              <ErrorBoundary label="brain panel">
                <Panel />
              </ErrorBoundary>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
