import type { GleamShape } from "./constants.ts";

/** Draws one of the 4 gleam shapes centered at (cx, cy) with "radius" s, filled with `color` —
 * shared by the pickaxe's 3D canvas texture and the 2D preview-banner icon so the exact same
 * silhouette shows up in both places. Plain canvas 2D paths, no image assets. */
export function drawGleamShape(ctx: CanvasRenderingContext2D, shape: GleamShape, cx: number, cy: number, s: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;

  switch (shape) {
    case "diamond":
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.75, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(-s * 0.75, 0);
      ctx.closePath();
      ctx.fill();
      break;
    case "circle":
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.82, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "square":
      ctx.save();
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-s * 0.62, -s * 0.62, s * 1.24, s * 1.24);
      ctx.restore();
      break;
    case "star": {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const outerA = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const innerA = outerA + Math.PI / 5;
        const ox = Math.cos(outerA) * s;
        const oy = Math.sin(outerA) * s;
        const ix = Math.cos(innerA) * s * 0.42;
        const iy = Math.sin(innerA) * s * 0.42;
        if (i === 0) ctx.moveTo(ox, oy);
        else ctx.lineTo(ox, oy);
        ctx.lineTo(ix, iy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
