import { engine } from "../engine";
import { useUi } from "../uiStore";

export const SPEEDS = [1, 2, 4, 8, 16];

/** dir +1 = faster, -1 = slower; wraps when `wrap` is set. */
export function stepSpeed(dir: 1 | -1, wrap = false): void {
  const ui = useUi.getState();
  const speed = ui.speed;
  let i = SPEEDS.indexOf(speed);
  if (i < 0) i = 0;
  i += dir;
  if (wrap) i = (i + SPEEDS.length) % SPEEDS.length;
  ui.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i))]);
}

export function toggleMode(): void {
  engine.setMode(engine.mode === "solo" ? "evolution" : "solo");
}
