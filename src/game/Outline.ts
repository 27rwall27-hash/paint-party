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
  /** bbox-local (same indexing as bbox pixel scans elsewhere: `(ly * bbox.w + lx)`), 1 where the
   * shape's real path covers that pixel, 0 otherwise — for a thin/irregular silhouette (the Eiffel
   * Tower, the Statue of Liberty) most of the bounding box/circle is 0: real empty air the shape
   * doesn't cover at all, as opposed to unpainted space that's still part of the shape. Computed
   * once at construction (see computeShapeMask) so containsPoint() and anything else that needs
   * real shape membership is a cheap array lookup, not a fresh path hit-test or canvas read. */
  readonly shapeMask: Uint8Array;
  /** One point (world/canvas coordinates) guaranteed to satisfy containsPoint() — the shape's own
   * mask centroid if that itself lands inside the shape (true for anything reasonably convex),
   * otherwise the first mask pixel found (always inside, by construction). Exists as a guaranteed-
   * good last resort for aim-point rejection sampling (see cpuController.ts's jitterAimInside):
   * for an extremely thin silhouette (the real Eiffel Tower artwork occupies well under 10% of its
   * own bounding box) even a generous retry budget can occasionally exhaust without finding a hit,
   * and a fallback that isn't itself guaranteed on-shape would just trade one rare miss for
   * another. */
  readonly fallbackPoint: { x: number; y: number };

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

    this.shapeMask = this.computeShapeMask();
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let firstX = -1;
    let firstY = -1;
    for (let py = 0; py < this.bbox.h; py++) {
      for (let px = 0; px < this.bbox.w; px++) {
        if (this.shapeMask[py * this.bbox.w + px]! === 0) continue;
        count++;
        sumX += px;
        sumY += py;
        if (firstX === -1) {
          firstX = px;
          firstY = py;
        }
      }
    }
    this.areaPixels = Math.max(1, count);
    if (count === 0) {
      this.fallbackPoint = { x: this.cx, y: this.cy };
    } else {
      const centroidX = Math.round(sumX / count);
      const centroidY = Math.round(sumY / count);
      const onMask = this.shapeMask[centroidY * this.bbox.w + centroidX] === 1;
      const px = onMask ? centroidX : firstX;
      const py = onMask ? centroidY : firstY;
      this.fallbackPoint = { x: this.bbox.x + px, y: this.bbox.y + py };
    }
  }

  private computeShapeMask(): Uint8Array {
    const mask = new Uint8Array(this.bbox.w * this.bbox.h);
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = this.bbox.w;
    maskCanvas.height = this.bbox.h;
    const ctx = maskCanvas.getContext("2d");
    if (!ctx) return mask;
    ctx.translate(-this.bbox.x, -this.bbox.y);
    ctx.fillStyle = "#000";
    ctx.fill(this.path);
    const data = ctx.getImageData(0, 0, this.bbox.w, this.bbox.h).data;
    for (let i = 3, p = 0; i < data.length; i += 4, p++) {
      if (data[i]! > 0) mask[p] = 1;
    }
    return mask;
  }

  /** True if a splat centered at (x,y) with the given radius could touch this outline at all. */
  mayOverlap(x: number, y: number, splatRadius: number): boolean {
    return Math.hypot(x - this.cx, y - this.cy) <= this.boundingRadius + splatRadius;
  }

  /** True if (x, y) — in the same world/canvas coordinates as cx/cy — actually lies inside this
   * outline's real shape, not just its bounding circle/box. For a thin or irregular silhouette
   * (the Eiffel Tower's narrow lattice, the Statue of Liberty's slender figure) the bounding circle
   * is mostly empty air the shape doesn't occupy at all — a point can pass mayOverlap() and still
   * be nowhere near paintable ground, since paintSplat() clips all painting to `path` and a splat
   * centered there would land zero visible pixels. */
  containsPoint(x: number, y: number): boolean {
    const lx = Math.floor(x - this.bbox.x);
    const ly = Math.floor(y - this.bbox.y);
    if (lx < 0 || ly < 0 || lx >= this.bbox.w || ly >= this.bbox.h) return false;
    return this.shapeMask[ly * this.bbox.w + lx] === 1;
  }

  /** True if a splat of `radius` centered at (x, y) would actually paint at least one real pixel
   * of this shape — a much more forgiving question than containsPoint(x, y), which only asks about
   * the exact center point. Use this to decide whether FIRING from here would be a real hit,
   * rather than a total miss; containsPoint is for picking a good aim point in the first place. A
   * splat with its center just outside a thin silhouette can still clip a real edge of it, and
   * demanding the exact center pixel be on-shape before ever releasing (rather than just "close
   * enough that this fires at all") can leave a bot stuck fully charged forever on a shape too
   * thin for its own arrival tolerance to reliably land dead-center on. */
  overlapsShape(x: number, y: number, radius: number): boolean {
    const localCx = x - this.bbox.x;
    const localCy = y - this.bbox.y;
    const minLx = Math.max(0, Math.floor(localCx - radius));
    const maxLx = Math.min(this.bbox.w - 1, Math.ceil(localCx + radius));
    const minLy = Math.max(0, Math.floor(localCy - radius));
    const maxLy = Math.min(this.bbox.h - 1, Math.ceil(localCy + radius));
    const r2 = radius * radius;
    for (let ly = minLy; ly <= maxLy; ly++) {
      for (let lx = minLx; lx <= maxLx; lx++) {
        const dx = lx - localCx;
        const dy = ly - localCy;
        if (dx * dx + dy * dy > r2) continue;
        if (this.shapeMask[ly * this.bbox.w + lx] === 1) return true;
      }
    }
    return false;
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
