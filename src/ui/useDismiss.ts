import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * Closes a popover/menu on Escape (returning focus to the trigger) or on a press outside.
 * `ref` must contain both the trigger and the popup.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  ref: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        trigger.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, close, ref, trigger]);
}
