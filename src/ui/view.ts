export type View = "bacterium" | "larva";

const KEY = "brain-view";

export function loadView(): View {
  try {
    return localStorage.getItem(KEY) === "larva" ? "larva" : "bacterium";
  } catch {
    return "bacterium";
  }
}

export function saveView(v: View): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // storage unavailable: the choice just won't be remembered
  }
}
