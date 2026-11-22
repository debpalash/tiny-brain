import { useEffect, useRef, useState } from "react";
import { engine } from "../engine";
import { N } from "../sim/types";

export function ActionsMenu() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    setConfirm(false);
    if (refocus) btn.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const releaseAll = () => {
    const b = engine.selected();
    if (!b) return;
    for (let i = 0; i < N; i++) if (b.clamp[i] !== null) engine.setClamp(i, null);
  };

  return (
    <div
      className="brain-menuwrap"
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={btn}
        type="button"
        className="brain-iconbtn"
        aria-label="Brain actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ...
      </button>
      {open && (
        <div className="brain-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              engine.resetBrain();
              close(true);
            }}
          >
            Restore designed brain
          </button>
          {confirm ? (
            <div className="brain-confirm" role="group" aria-label="Confirm randomise">
              <span>Replace all connections?</span>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  engine.scrambleBrain();
                  close(true);
                }}
              >
                Randomise
              </button>
              <button type="button" role="menuitem" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" role="menuitem" onClick={() => setConfirm(true)}>
              Randomise brain
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              releaseAll();
              close(true);
            }}
          >
            Let all run
          </button>
        </div>
      )}
    </div>
  );
}
