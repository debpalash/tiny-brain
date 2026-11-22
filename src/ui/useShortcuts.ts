import { useEffect } from "react";
import { useUi } from "../uiStore";
import type { Tool } from "../uiStore";
import { stepSpeed, toggleMode } from "./controls";

export const TOOL_ORDER: Tool[] = ["food", "toxin", "scent", "erase", "select"];

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function useShortcuts(actions: { toggleBrain: () => void; openGuide: () => void }): void {
  const { toggleBrain, openGuide } = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const ui = useUi.getState();
      const toolIdx = ["1", "2", "3", "4", "5"].indexOf(e.key);
      if (toolIdx >= 0) {
        ui.setTool(TOOL_ORDER[toolIdx]);
      } else if (e.key === " ") {
        if (e.target instanceof HTMLButtonElement) return; // native button activation
        e.preventDefault();
        ui.setPaused(!ui.paused);
      } else if (e.key === "[") {
        stepSpeed(-1);
      } else if (e.key === "]") {
        stepSpeed(1);
      } else if (e.key === "e" || e.key === "E") {
        toggleMode();
      } else if (e.key === "b" || e.key === "B") {
        toggleBrain();
      } else if (e.key === "?") {
        e.preventDefault();
        openGuide();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleBrain, openGuide]);
}
