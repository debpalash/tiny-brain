import { useEffect, useState } from "react";

/** Re-reads `read` at `hz` and re-renders only when the numeric tuple changes. */
export function usePoll<T extends readonly (number | boolean)[]>(read: () => T, hz = 10): T {
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = read();
      setValue((prev) =>
        prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next,
      );
    }, 1000 / hz);
    return () => window.clearInterval(id);
  }, [read, hz]);
  return value;
}
