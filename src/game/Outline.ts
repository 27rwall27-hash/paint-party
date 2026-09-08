import { CANVAS_H, CANVAS_W, SPLAT_DROPLET_MAX, SPLAT_DROPLET_MIN, SPLAT_LOBES, SPLAT_VARIANCE, type PowerupType } from "./constants.ts";
import { buildShape, buildSplatBlob, type ShapeKind } from "./shapes.ts";

export interface OutlineSpec {
  kind: ShapeKind;
  cx: number;
  cy: number;
  radius: number;
  /** Only used by the "rectangle" kind; other kinds size purely off `radius`. */
  width?: number;
  height?: number;
  /** Stretches the built shape horizontally about its own center — 1.25 = 25% wider, height unchanged. */
  widthScale?: number;
  /** Stretches the built shape vertically about its own center — 1.25 = 25% taller, width unchanged. */
  heightScale?: number;
}

export interface PowerupSpec extends OutlineSpec {
  type: PowerupType;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clampBox(cx: number, cy: number, r: number): Box {
  const pad = r + 4;
  const x = Math.max(0, Math.floor(cx - pad));
  const y = Math.max(0, Math.floor(cy - pad));
  const x2 = Math.min(CANVAS_W, Math.ceil(cx + pad));
  const y2 = Math.min(CANVAS_H, Math.ceil(cy + pad));
  return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
}

/** A big scoring outline: owns its own full-canvas-sized offscreen paint layer, clipped to its shape. */
export class Outline {
  readonly kind: ShapeKind;
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly path: Path2D;
  readonly boundingRadius: number;
  readonly bbox: Box;
  readonly paintCanvas: HTMLCanvasElement;
  readonly paintCtx: CanvasRenderingContext2D;
  /** Total pixel count inside the shape's actual path (not just its bounding box) — the scoring denominator. */
  readonly areaPixels: number;

  constructor(spec: OutlineSpec) {
    this.kind = spec.kind;
    this.cx = spec.cx;
    this.cy = spec.cy;
    this.radius = spec.radius;
    const size = spec.width !== undefined && spec.height !== undefined ? { width: spec.width, height: spec.height } : undefined;
    const built = buildShape(spec.kind, spec.cx, spec.cy, spec.radius, size);

    const widthScale = spec.widthScale ?? 1;
    const heightScale = spec.heightScale ?? 1;
    if (widthScale !== 1 || heightScale !== 1) {
      const matrix = new DOMMatrix().translate(spec.cx, spec.cy).scale(widthScale, heightScale).translate(-spec.cx, -spec.cy);
      const stretched = new Path2D();
      stretched.addPath(built.path, matrix);
      this.path = stretched;
    } else {
      this.path = built.path;
    }
    // A pure axis stretch only grows the shape's reach along that axis — widening the bounding
    // circle by the larger factor stays a safe (if slightly conservative) overlap/placement check.
    this.boundingRadius = built.boundingRadius * Math.max(1, widthScale, heightScale);
    this.bbox = clampBox(spec.cx, spec.cy, this.boundingRadius);

    this.paintCanvas = document.createElement("canvas");
    this.paintCanvas.width = CANVAS_W;
    this.paintCanvas.height = CANVAS_H;
    const ctx = this.paintCanvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.paintCtx = ctx;

    this.areaPixels = this.computeAreaPixels();
  }

  private computeAreaPixels(): number {
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = this.bbox.w;
    maskCanvas.height = this.bbox.h;
    const ctx = maskCanvas.getContext("2d");
    if (!ctx) return 1;
    ctx.translate(-this.bbox.x, -this.bbox.y);
    ctx.fillStyle = "#000";
    ctx.fill(this.path);
    const data = ctx.getImageData(0, 0, this.bbox.w, this.bbox.h).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! > 0) count++;
    }
    return Math.max(1, count);
  }

  /** True if a splat centered at (x,y) with the given radius could touch this outline at all. */
  mayOverlap(x: number, y: number, splatRadius: number): boolean {
    return Math.hypot(x - this.cx, y - this.cy) <= this.boundingRadius + splatRadius;
  }

  /** Paints the main blob plus a scatter of smaller satellite droplets for an explosive impact. */
  /**
   * The core is always a fully solid circle at `radius` — exactly what the charging cursor
   * showed — with a bulging organic blob layered on top for texture, plus a few explosion
   * droplets scattered around it. Firing at max power always paints a completely filled circle.
   */
  paintSplat(x: number, y: number, radius: number, color: string): void {
    const ctx = this.paintCtx;
    ctx.save();
    ctx.clip(this.path);
    ctx.fillStyle = color;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fill(buildSplatBlob(x, y, radius, SPLAT_VARIANCE, SPLAT_LOBES));

    const dropletCount = SPLAT_DROPLET_MIN + Math.floor(Math.random() * (SPLAT_DROPLET_MAX - SPLAT_DROPLET_MIN + 1));
    for (let i = 0; i < dropletCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = radius * (0.75 + Math.random() * 0.9);
      const dropletRadius = radius * (0.1 + Math.random() * 0.2);
      const dx = x + Math.cos(angle) * dist;
      const dy = y + Math.sin(angle) * dist;
      ctx.fill(buildSplatBlob(dx, dy, dropletRadius, SPLAT_VARIANCE * 0.8, 6));
    }
    ctx.restore();
  }

  paintRect(x: number, y: number, w: number, h: number, color: string): void {
    const ctx = this.paintCtx;
    ctx.save();
    ctx.clip(this.path);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  /**
   * Erases painted pixels that aren't (approximately) keepColor — used by the "Wipe Out" power-up.
   * Only clears a random `fraction` of qualifying pixels, so 0.3 leaves ~70% of opponent paint intact.
   */
  clearOtherColors(keepColor: string, fraction: number): void {
    const { x, y, w, h } = this.bbox;
    const img = this.paintCtx.getImageData(x, y, w, h);
    const data = img.data;
    const [kr, kg, kb] = hexToRgb(keepColor);
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (Math.abs(r - kr) + Math.abs(g - kg) + Math.abs(b - kb) > 30 && Math.random() < fraction) {
        data[i + 3] = 0;
      }
    }
    this.paintCtx.putImageData(img, x, y);
  }

  /**
   * Erases paint within radius of (x,y) that isn't (approximately) excludeColor — used by the
   * Random Eraser hazard, which only wipes opponents' work and spares whoever claimed it.
   */
  eraseColor(x: number, y: number, radius: number, excludeColor: string): void {
    const rx = Math.max(this.bbox.x, Math.floor(x - radius));
    const ry = Math.max(this.bbox.y, Math.floor(y - radius));
    const rx2 = Math.min(this.bbox.x + this.bbox.w, Math.ceil(x + radius));
    const ry2 = Math.min(this.bbox.y + this.bbox.h, Math.ceil(y + radius));
    const w = rx2 - rx;
    const h = ry2 - ry;
    if (w <= 0 || h <= 0) return;

    const img = this.paintCtx.getImageData(rx, ry, w, h);
    const data = img.data;
    const [er, eg, eb] = hexToRgb(excludeColor);
    const r2 = radius * radius;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const dx = rx + i - x;
        const dy = ry + j - y;
        if (dx * dx + dy * dy > r2) continue;
        const idx = (j * w + i) * 4;
        const a = data[idx + 3];
        if (a === 0) continue;
        const r = data[idx]!;
        const g = data[idx + 1]!;
        const b = data[idx + 2]!;
        if (Math.abs(r - er) + Math.abs(g - eg) + Math.abs(b - eb) > 30) {
          data[idx + 3] = 0;
        }
      }
    }
    this.paintCtx.putImageData(img, rx, ry);
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export type PowerupState = "active" | "claimed";

/** A small first-come-first-served outline. Claimed by a single splat, then removed. */
export class Powerup {
  readonly type: PowerupType;
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly path: Path2D;
  state: PowerupState = "active";
  claimedBy: number | null = null;
  claimedAt = 0;
  spawnedAt = 0;
  expiresAt = 0;

  constructor(spec: PowerupSpec) {
    this.type = spec.type;
    this.cx = spec.cx;
    this.cy = spec.cy;
    this.radius = spec.radius;
    this.path = buildShape(spec.kind, spec.cx, spec.cy, spec.radius).path;
  }

  overlaps(x: number, y: number, splatRadius: number, slack: number): boolean {
    return Math.hypot(x - this.cx, y - this.cy) <= this.radius + splatRadius + slack;
  }
}
