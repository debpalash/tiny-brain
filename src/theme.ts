/**
 * SHARED CONTRACT. Owned by the project lead.
 *
 * Look (revised after first user review): a calm textbook diagram, not a light show.
 * Muted, low-saturation colours on a dark neutral ground. Nothing glows to white.
 * Colour carries meaning and is used sparingly:
 *   green = food / senses, rose = toxin, amber = "excites", blue = "calms".
 */
export const theme = {
  bg: "#0c1014",
  panel: "#12171d",
  panelBorder: "#222b35",
  text: "#d5dce3",
  textDim: "#8391a0",
  accent: "#6fb3a8", // the selected cell, primary actions
  food: "#7fae86",
  toxin: "#c0707f",
  scent: "#b3ac7c", // neutral smell: means nothing until learned
  excite: "#d3a15f", // positive weights: "excites"
  inhibit: "#6e97c8", // negative weights: "calms"
  // The three roles a beginner needs: senses -> thinking -> actions.
  sensor: "#7fae86",
  inter: "#a79bc4",
  motor: "#d3a15f",
  dish: "#10161c",
  dishRim: "#2a3642",
  fontUi: "'Inter', system-ui, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, monospace",
} as const;
