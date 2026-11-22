import { useEffect, useRef, useState } from "react";

/** Returns `value`, but never changes more often than once per `ms`. */
export function useHeld<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const changedAt = useRef(0);
  useEffect(() => {
    if (value === shown) return;
    const wait = Math.max(0, changedAt.current + ms - performance.now());
    const id = window.setTimeout(() => {
      changedAt.current = performance.now();
      setShown(value);
    }, wait);
    return () => window.clearTimeout(id);
  }, [value, shown, ms]);
  return shown;
}
