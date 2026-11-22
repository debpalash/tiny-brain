import { CanvasTexture, SRGBColorSpace } from "three";
import { theme } from "../theme";
import { WORLD_RADIUS } from "../sim/types";

/**
 * A concentration "map" disc, white on transparent: gaussian-ish soft fill out to 2 sigma
 * (texture edge) with three thin contour rings. Tinted per instance.
 */
export function makeFieldTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    for (let i = 0; i <= 24; i++) {
      const r = i / 24;
      const a = Math.exp(-((r * 2) ** 2) / 2) * (1 - r ** 6);
      g.addColorStop(r, `rgba(255,255,255,${a.toFixed(4)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5;
    for (const r of [0.3, 0.6, 0.96]) {
      ctx.beginPath();
      ctx.arc(c, c, r * c, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Scent: 4 thin dashed contour rings (white on transparent), outermost at 2 sigma. Tinted per instance. */
export function makeScentTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = size / 2;
    ctx.strokeStyle = "rgba(255,255,255,1)";
    ctx.lineWidth = 1.1;
    for (const r of [0.25, 0.5, 0.75, 0.97]) {
      ctx.setLineDash([2.5, 4 + r * 4]);
      ctx.beginPath();
      ctx.arc(c, c, r * c, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** The dish floor: flat neutral surface with a faint grid and rings. */
export function makeDishTexture(): CanvasTexture {
  const S = 1024;
  const c = S / 2;
  const k = c / WORLD_RADIUS;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = theme.dish;
    ctx.fillRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = "rgba(160,180,200,0.045)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let u = -WORLD_RADIUS; u <= WORLD_RADIUS; u += 5) {
      ctx.moveTo(c + u * k, 0);
      ctx.lineTo(c + u * k, S);
      ctx.moveTo(0, c + u * k);
      ctx.lineTo(S, c + u * k);
    }
    ctx.stroke();
    ctx.restore();
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
