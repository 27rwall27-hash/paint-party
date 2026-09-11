import * as THREE from "three";
import { INGREDIENTS, type Glyph } from "./constants.ts";

const INGREDIENT_BY_ID = new Map(INGREDIENTS.map((i) => [i.id, i]));

/** Same glyph-drawing approach as every other procedural texture in this suite (dice pips, wood
 * grain) — plain canvas 2D paths, no image assets. */
function drawGlyph(ctx: CanvasRenderingContext2D, glyph: Glyph, cx: number, cy: number, s: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.09);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (glyph) {
    case "flame":
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.5);
      ctx.bezierCurveTo(s * 0.4, -s * 0.1, s * 0.25, s * 0.3, 0, s * 0.5);
      ctx.bezierCurveTo(-s * 0.25, s * 0.3, -s * 0.4, -s * 0.1, 0, -s * 0.5);
      ctx.fill();
      break;
    case "moon":
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(s * 0.2, -s * 0.05, s * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      break;
    case "cap":
      ctx.beginPath();
      ctx.arc(0, s * 0.05, s * 0.4, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(-s * 0.08, s * 0.05, s * 0.16, s * 0.32);
      ctx.fill();
      break;
    case "snowflake":
      for (let a = 0; a < 3; a++) {
        ctx.save();
        ctx.rotate((a * Math.PI) / 3);
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.42);
        ctx.lineTo(0, s * 0.42);
        ctx.moveTo(0, -s * 0.22);
        ctx.lineTo(-s * 0.14, -s * 0.36);
        ctx.moveTo(0, -s * 0.22);
        ctx.lineTo(s * 0.14, -s * 0.36);
        ctx.stroke();
        ctx.restore();
      }
      break;
    case "skull":
      ctx.beginPath();
      ctx.arc(0, -s * 0.05, s * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(-s * 0.18, s * 0.15, s * 0.36, s * 0.16);
      ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(-s * 0.13, -s * 0.08, s * 0.09, 0, Math.PI * 2);
      ctx.arc(s * 0.13, -s * 0.08, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      break;
    case "berry":
      for (const [bx, by] of [
        [0, -s * 0.22],
        [-s * 0.2, s * 0.12],
        [s * 0.2, s * 0.12],
      ] as const) {
        ctx.beginPath();
        ctx.arc(bx, by, s * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "leaf":
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45);
      ctx.quadraticCurveTo(s * 0.38, 0, 0, s * 0.45);
      ctx.quadraticCurveTo(-s * 0.38, 0, 0, -s * 0.45);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.4);
      ctx.lineTo(0, s * 0.4);
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.stroke();
      break;
    case "star": {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const outerA = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const innerA = outerA + Math.PI / 5;
        const ox = Math.cos(outerA) * s * 0.45;
        const oy = Math.sin(outerA) * s * 0.45;
        const ix = Math.cos(innerA) * s * 0.18;
        const iy = Math.sin(innerA) * s * 0.18;
        if (i === 0) ctx.moveTo(ox, oy);
        else ctx.lineTo(ox, oy);
        ctx.lineTo(ix, iy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "feather":
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45);
      ctx.quadraticCurveTo(s * 0.26, -s * 0.1, 0, s * 0.45);
      ctx.quadraticCurveTo(-s * 0.26, -s * 0.1, 0, -s * 0.45);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = Math.max(1, s * 0.035);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.4);
      ctx.lineTo(0, s * 0.4);
      ctx.stroke();
      break;
    case "drop":
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45);
      ctx.bezierCurveTo(s * 0.32, s * 0.05, s * 0.24, s * 0.45, 0, s * 0.45);
      ctx.bezierCurveTo(-s * 0.24, s * 0.45, -s * 0.32, s * 0.05, 0, -s * 0.45);
      ctx.fill();
      break;
    case "thorn":
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45);
      ctx.lineTo(s * 0.2, s * 0.4);
      ctx.lineTo(-s * 0.2, s * 0.4);
      ctx.closePath();
      ctx.fill();
      break;
    case "spiral":
    case "swirl": {
      ctx.beginPath();
      const turns = glyph === "spiral" ? 2.1 : 1.4;
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = t * Math.PI * 2 * turns;
        const r = t * s * 0.42;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    }
    case "sparkle":
      for (let a = 0; a < 4; a++) {
        ctx.save();
        ctx.rotate((a * Math.PI) / 2);
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.45);
        ctx.lineTo(s * 0.08, -s * 0.08);
        ctx.lineTo(s * 0.45, 0);
        ctx.lineTo(s * 0.08, s * 0.08);
        ctx.lineTo(0, s * 0.45);
        ctx.lineTo(-s * 0.08, s * 0.08);
        ctx.lineTo(-s * 0.45, 0);
        ctx.lineTo(-s * 0.08, -s * 0.08);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      break;
  }
  ctx.restore();
}

export function drawGlyphOnCanvas(canvas: HTMLCanvasElement, glyph: Glyph, color: string): void {
  const ctx = canvas.getContext("2d")!;
  drawGlyph(ctx, glyph, canvas.width / 2, canvas.height / 2, canvas.width * 0.8, color);
}

const labelTextureCache = new Map<number, THREE.CanvasTexture>();

/** A small transparent-background label texture for a bottle — cached per ingredient type since
 * every physical copy of the same potion looks identical. */
export function getLabelTexture(typeId: number): THREE.CanvasTexture {
  const cached = labelTextureCache.get(typeId);
  if (cached) return cached;
  const def = INGREDIENT_BY_ID.get(typeId)!;
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  drawGlyphOnCanvas(canvas, def.glyph, "#ffffff");
  const texture = new THREE.CanvasTexture(canvas);
  labelTextureCache.set(typeId, texture);
  return texture;
}
