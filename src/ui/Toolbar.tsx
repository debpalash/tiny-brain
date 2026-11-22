import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { engine } from "../engine";
import type { Pairing } from "../sim/types";
import { useEngineVersion, useUi } from "../uiStore";
import type { Tool } from "../uiStore";
import { stepSpeed } from "./controls";
import {
  ClearIcon,
  EraseIcon,
  FoodIcon,
  MoreIcon,
  PauseIcon,
  PlayIcon,
  ResetIcon,
  ScentIcon,
  SelectIcon,
  ToxinIcon,
} from "./icons";
import { useDismiss } from "./useDismiss";

const TOOLS: { id: Tool; label: string; tip: string; icon: ReactNode }[] = [
  { id: "food", label: "Food", tip: "Drop food: the cell will try to reach it", icon: <FoodIcon /> },
  { id: "toxin", label: "Toxin", tip: "Drop toxin: the cell will try to avoid it", icon: <ToxinIcon /> },
  {
    id: "scent",
    label: "Scent",
    tip: "Drop a scent: a smell that means nothing until the cell learns what it predicts",
    icon: <ScentIcon />,
  },
  { id: "erase", label: "Erase", tip: "Remove food or toxin", icon: <EraseIcon /> },
  { id: "select", label: "Select", tip: "Pick a cell to see its brain", icon: <SelectIcon /> },
];

const PAIRINGS: { id: Pairing; label: string; tip: string }[] = [
  { id: "none", label: "None", tip: "Scent is dropped only by you" },
  { id: "food", label: "Food", tip: "Food smells: the cell can learn to follow the smell to food" },
  { id: "toxin", label: "Toxin", tip: "Toxin smells: the cell can learn to avoid the smell" },
];

function PairingControl() {
  useEngineVersion();
  return (
    <div className="ui-pairing ui-group" role="group" aria-label="Scent comes with">
      <span className="ui-cap">Scent comes with:</span>
      <div className="ui-segment ui-speeds">
        {PAIRINGS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="ui-seg-btn ui-tip"
            data-tip={p.tip}
            aria-pressed={engine.pairing === p.id}
            onClick={() => engine.setPairing(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function OverflowMenu() {
  useEngineVersion();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setConfirm(false);
  }, []);
  useDismiss(open, close, wrap, trigger);

  const items = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? [],
    ).filter((el) => el.offsetParent !== null);
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open, confirm]);

  const onMenuKey = (e: ReactKeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (i + 1) % list.length;
    else if (e.key === "ArrowUp") next = (i - 1 + list.length) % list.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = list.length - 1;
    else if (e.key === "Tab") {
      close();
      return;
    }
    if (next >= 0) {
      e.preventDefault();
      list[next].focus();
    }
  };

  const run = (fn: () => void) => {
    fn();
    close();
    trigger.current?.focus();
  };

  return (
    <div className="ui-pop-wrap" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="ui-btn ui-icon-btn ui-tip"
        data-tip="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreIcon />
      </button>
      {open && (
        <div ref={menu} className="ui-menu ui-panel" role="menu" aria-label="More actions" onKeyDown={onMenuKey}>
          {confirm ? (
            <>
              <p className="ui-cap ui-menu-note">Reset and lose current progress?</p>
              <button type="button" role="menuitem" className="ui-menu-item" onClick={() => run(() => engine.reset())}>
                <ResetIcon /> Yes, reset
              </button>
              <button type="button" role="menuitem" className="ui-menu-item" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" className="ui-menu-item" onClick={() => run(() => engine.clearSources())}>
                <ClearIcon /> Clear dish
              </button>
              <button type="button" role="menuitem" className="ui-menu-item" onClick={() => setConfirm(true)}>
                <ResetIcon /> Reset...
              </button>
              <div className="ui-menu-pairing" role="group" aria-label="Scent comes with">
                <p className="ui-cap ui-menu-note">Scent comes with</p>
                {PAIRINGS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={engine.pairing === p.id}
                    title={p.tip}
                    className="ui-menu-item"
                    onClick={() => run(() => engine.setPairing(p.id))}
                  >
                    <span className="ui-radio" aria-hidden="true" />
                    {p.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Toolbar() {
  const tool = useUi((s) => s.tool);
  const paused = useUi((s) => s.paused);
  const speed = useUi((s) => s.speed);

  return (
    <div className="ui-toolbar ui-panel" role="toolbar" aria-label="Dish controls">
      <div className="ui-group" role="group" aria-label="Tool">
        {TOOLS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            className="ui-btn ui-tool ui-tip"
            data-tool={t.id}
            data-tip={`${t.tip} (${i + 1})`}
            aria-label={t.label}
            aria-pressed={tool === t.id}
            aria-keyshortcuts={String(i + 1)}
            onClick={() => useUi.getState().setTool(t.id)}
          >
            {t.icon}
            {tool === t.id && <span className="ui-btn-label">{t.label}</span>}
          </button>
        ))}
      </div>
      <span className="ui-sep ui-pairing" aria-hidden="true" />
      <PairingControl />
      <span className="ui-sep" aria-hidden="true" />
      <div className="ui-group ui-joined">
        <button
          type="button"
          className="ui-btn ui-icon-btn ui-tip"
          data-tip={paused ? "Play (Space)" : "Pause (Space)"}
          aria-label={paused ? "Play" : "Pause"}
          aria-keyshortcuts="Space"
          onClick={() => useUi.getState().setPaused(!paused)}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button
          type="button"
          className="ui-btn ui-speed ui-num ui-tip"
          data-tip="Speed: click to go faster, Shift+click slower ([ ] too)"
          aria-label={`Speed ${speed}x. Activate to change.`}
          onClick={(e) => stepSpeed(e.shiftKey ? -1 : 1, !e.shiftKey)}
        >
          {speed}x
        </button>
      </div>
      <span className="ui-sep" aria-hidden="true" />
      <OverflowMenu />
    </div>
  );
}
