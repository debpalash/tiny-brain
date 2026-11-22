import type { ReactNode } from "react";
import { ModeSwitch } from "./ModeSwitch";
import { StatusStrip } from "./StatusStrip";
import { ViewSwitch } from "./ViewSwitch";
import type { View } from "./view";

interface Props {
  view: View;
  onView: (v: View) => void;
  /** Bacterium view only. */
  onGuide?: () => void;
  /** Replaces the bacterium status strip (used by the larva view). */
  right?: ReactNode;
}

export function TopBar({ view, onView, onGuide, right }: Props) {
  return (
    <header className="ui-topbar">
      <div className="ui-top-left">
        <h1 className="ui-title">Bacteria Brain</h1>
        <ViewSwitch view={view} onView={onView} />
        {onGuide && (
          <button
            type="button"
            className="ui-btn ui-icon-btn ui-help ui-tip"
            data-tip="Guide and shortcuts (?)"
            data-tip-pos="down"
            aria-label="Open guide"
            aria-haspopup="dialog"
            onClick={onGuide}
          >
            ?
          </button>
        )}
      </div>
      {view === "bacterium" ? <ModeSwitch /> : <div />}
      <div className="ui-top-right">{right ?? <StatusStrip />}</div>
    </header>
  );
}
