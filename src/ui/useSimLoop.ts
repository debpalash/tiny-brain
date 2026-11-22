import { useEffect } from "react";
import { engine } from "../engine";
import { useUi } from "../uiStore";

const MAX_FRAME = 0.1;
const MAX_CHUNK = 0.1;

/** Drives engine.step from requestAnimationFrame at `speed` x real time. */
export function useSimLoop(): void {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const real = Math.min(MAX_FRAME, Math.max(0, (now - last) / 1000));
      last = now;
      const { paused, speed } = useUi.getState();
      if (paused) return;
      let remaining = real * speed;
      while (remaining > 1e-6) {
        const chunk = Math.min(MAX_CHUNK, remaining);
        engine.step(chunk);
        remaining -= chunk;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}
