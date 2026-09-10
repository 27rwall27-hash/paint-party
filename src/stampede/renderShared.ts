// Rendering primitives shared between Classic mode (render.ts) and Battle Royale mode
// (battleRoyaleRender.ts) — stick figure/hurdle drawing, terrain backgrounds, and the shared sun
// system. Everything mode-specific (phase HUD, split transitions, results screens, the classic
// per-race obstacle/rank model) stays in each mode's own render file.

import { CANVAS_H, CANVAS_W, GROUND_Y_FRACTION, JUMP_LEG_SPLIT_DEGREES, PACK_LEFT_FRACTION, PACK_WIDTH_FRACTION, RACER_COUNT } from "./constants.ts";

export const HUD_HEIGHT = 56;
export const BAND_GAP = 4;
export const COLUMN_GAP = 4;

export function bandRect(index: number, bandCount: number): { y: number; h: number } {
  const totalH = CANVAS_H - HUD_HEIGHT;
  const h = totalH / bandCount - BAND_GAP;
  const y = HUD_HEIGHT + index * (totalH / bandCount) + BAND_GAP / 2;
  return { y, h };
}

export type Terrain = "grass" | "beach" | "ice";
export const TERRAIN_BY_INDEX: Terrain[] = ["grass", "beach", "ice"];
export const TERRAIN_GROUND_COLOR: Record<Terrain, string> = { grass: "#5f9a52", beach: "#eec99a", ice: "#d8e8ef" };

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function lerpColor(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return `rgb(${Math.round(lerp(a.r, b.r, t))}, ${Math.round(lerp(a.g, b.g, t))}, ${Math.round(lerp(a.b, b.b, t))})`;
}

export interface SunState {
  /** Fraction of CANVAS_W — same for every band, since it's the same sun. */
  xFrac: number;
  /** Fraction of a band's OWN height — each band places the sun relative to its own sky, so a
   * full-height band and a third-height band both show a complete, proportional scene from the
   * same underlying sun state. */
  yFrac: number;
  sky: [string, string, string];
  sunColor: string;
}

/** One sun, computed once per frame from overall progress (0 = start, 1 = end — each mode defines
 * what "progress" means for itself) and handed to every band — a pale, high, top-right morning sun
 * arcing down to the warm, low sunset position/palette. */
export function computeSunState(t: number): SunState {
  return {
    xFrac: lerp(0.86, 0.24, t),
    yFrac: lerp(0.12, 1.0, t),
    sky: [lerpColor("#8fb8d9", "#b8380f", t), lerpColor("#f3c9a8", "#dd7233", t), lerpColor("#fdf1d9", "#f6c98a", t)],
    sunColor: lerpColor("#fff6e0", "#fbecc2", t),
  };
}

function drawPuffyCloud(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // A rounder, fuller cumulus made of several overlapping lobes of varying size (rather than one
  // flat ellipse with two small side bumps), reading as a proper puffy cloud instead of a blob.
  const lobes: Array<[number, number, number]> = [
    [0, 0.15, 0.95],
    [-r * 1.5, 0.35, 0.65],
    [-r * 0.75, -0.15, 0.8],
    [r * 0.75, -0.1, 0.85],
    [r * 1.5, 0.3, 0.6],
    [r * 2.2, 0.4, 0.4],
  ];
  ctx.beginPath();
  for (const [dx, dyFrac, scale] of lobes) {
    ctx.moveTo(cx + dx + r * scale, cy + r * dyFrac);
    ctx.arc(cx + dx, cy + r * dyFrac, r * scale, 0, Math.PI * 2);
  }
  ctx.fill();
}

function drawBird(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, wingUp: number): void {
  // A simple black "M" gull silhouette — two shallow arcs meeting at a center dip, wingtips level.
  // `wingUp` (0..1) raises the peaks and deepens the flap for the "wings up" half of the cycle.
  const spread = size * (0.9 + wingUp * 0.35);
  const peakY = y - size * (0.5 + wingUp * 0.9);
  const dipY = y - size * (0.15 + wingUp * 0.35);
  ctx.beginPath();
  ctx.moveTo(x - spread, y);
  ctx.quadraticCurveTo(x - spread * 0.5, peakY, x, dipY);
  ctx.quadraticCurveTo(x + spread * 0.5, peakY, x + spread, y);
  ctx.stroke();
}

/** A small, muted set of background decorations per terrain — deliberately subtle (soft/low-count/
 * low-contrast, and never near the pack's own columns) so they read as ambient scenery rather than
 * competing with the hurdle or runners for attention. */
function drawTerrainDecorations(ctx: CanvasRenderingContext2D, terrain: Terrain, y: number, h: number, horizonY: number, now: number): void {
  if (terrain === "grass") {
    // Fuller, puffier clouds, high in the sky, drifting almost imperceptibly slowly.
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    const clouds: Array<[number, number, number]> = [
      [0.14, 0.15, 1.1],
      [0.38, 0.08, 0.8],
      [0.58, 0.22, 0.95],
      [0.82, 0.12, 0.7],
    ];
    for (const [xFrac, yFrac, scale] of clouds) {
      const drift = Math.sin(now / 14000 + xFrac * 9) * 6;
      const cx = CANVAS_W * xFrac + drift;
      const cy = y + h * yFrac;
      drawPuffyCloud(ctx, cx, cy, 12 * scale);
    }
  } else if (terrain === "beach") {
    // A couple of small, muted, static pyramid silhouettes on the horizon.
    ctx.fillStyle = "rgba(120, 88, 58, 0.45)";
    for (const xFrac of [0.64, 0.78]) {
      const baseX = CANVAS_W * xFrac;
      const pyramidH = h * 0.15;
      ctx.beginPath();
      ctx.moveTo(baseX, horizonY - pyramidH);
      ctx.lineTo(baseX - pyramidH * 0.95, horizonY);
      ctx.lineTo(baseX + pyramidH * 0.95, horizonY);
      ctx.closePath();
      ctx.fill();
    }

    // A few black birds flapping across the sky.
    ctx.strokeStyle = "rgba(20, 20, 20, 0.75)";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    const birds: Array<[number, number, number]> = [
      [0.2, 0.14, 1],
      [0.3, 0.24, 0.8],
      [0.48, 0.1, 0.9],
    ];
    for (const [xFrac, yFrac, seed] of birds) {
      const bx = CANVAS_W * xFrac + Math.sin(now / 9000 + seed * 5) * 10;
      const by = y + h * yFrac;
      const wingUp = Math.max(0, Math.sin(now / 260 + seed * 10));
      drawBird(ctx, bx, by, 9, wingUp);
    }
  } else {
    // A jagged glacier silhouette on the horizon (same treatment as the pyramids).
    ctx.fillStyle = "rgba(200, 225, 235, 0.6)";
    const baseX = CANVAS_W * 0.72;
    const glacierH = h * 0.19;
    const glacierW = glacierH * 1.7;
    ctx.beginPath();
    ctx.moveTo(baseX - glacierW, horizonY);
    ctx.lineTo(baseX - glacierW * 0.5, horizonY - glacierH * 0.6);
    ctx.lineTo(baseX - glacierW * 0.15, horizonY - glacierH);
    ctx.lineTo(baseX + glacierW * 0.25, horizonY - glacierH * 0.75);
    ctx.lineTo(baseX + glacierW * 0.6, horizonY - glacierH * 0.4);
    ctx.lineTo(baseX + glacierW, horizonY);
    ctx.closePath();
    ctx.fill();

    // A sparse scatter of slowly falling snowflakes, confined to the sky so they never cross into
    // the ground/obstacle row. Deterministic per-index placement (not Math.random()) so flakes
    // drift smoothly instead of jittering to a new spot every frame.
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    for (let i = 0; i < 9; i++) {
      const xFrac = (i * 0.6180339887) % 1;
      const fallMs = 7000 + (i % 4) * 1100;
      const yFrac = ((now + i * 733) % fallMs) / fallMs;
      const cx = CANVAS_W * xFrac;
      const cy = y + h * yFrac * 0.75;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** A gradient sky, one shared sun (see computeSunState), a flat terrain-colored ground, and a
 * small set of muted per-terrain decorations — a fixed backdrop rather than something that
 * scrolls, since the obstacle's own motion already carries the sense of movement. Drawn fresh per
 * band so stacked bands each get their own full scene rather than sharing one cropped image. */
function drawBandBackground(ctx: CanvasRenderingContext2D, y: number, h: number, horizonY: number, sun: SunState, terrain: Terrain, now: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y, CANVAS_W, h);
  ctx.clip();

  const sky = ctx.createLinearGradient(0, y, 0, horizonY);
  sky.addColorStop(0, sun.sky[0]);
  sky.addColorStop(0.55, sun.sky[1]);
  sky.addColorStop(1, sun.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, y, CANVAS_W, Math.max(0, horizonY - y));

  const sunR = h * 0.24;
  ctx.beginPath();
  ctx.arc(CANVAS_W * sun.xFrac, y + h * sun.yFrac, sunR, 0, Math.PI * 2);
  ctx.fillStyle = sun.sunColor;
  ctx.fill();

  // Flat ground below the horizon — a plain straight boundary, no texture.
  ctx.fillStyle = TERRAIN_GROUND_COLOR[terrain];
  ctx.fillRect(0, horizonY, CANVAS_W, Math.max(0, y + h - horizonY));

  drawTerrainDecorations(ctx, terrain, y, h, horizonY, now);

  ctx.restore();
}

/** A track hurdle sitting on the ground line: two pale posts and a colored crossbar. `leftX` is
 * the LEADING (leftmost) post's x — and deliberately the actual hitbox/reach-time position the
 * obstacle's approach is computed against (see each mode's own obstacle-progress calculation), not
 * the hurdle's visual center. The obstacle travels right-to-left, so the left post is the edge
 * that reaches any given column first; drawing the rest of the hurdle's width trailing behind (to
 * the right of) that post, rather than centered on it, means a runner's column and the hurdle's
 * drawn shape agree exactly on when contact happens. `groundLineY` is where the ground line is
 * actually DRAWN (bandGeometry's groundLineY, not the runners' own center point). */
export function drawHurdle(ctx: CanvasRenderingContext2D, leftX: number, groundLineY: number, size: number): void {
  const legHeight = size * 2.6;
  const barY = groundLineY - legHeight;
  const width = size * 2.1;
  const rightX = leftX + width;

  ctx.lineCap = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(3, size * 0.36);
  for (const legX of [leftX, rightX]) {
    ctx.beginPath();
    ctx.moveTo(legX, groundLineY);
    ctx.lineTo(legX, barY);
    ctx.stroke();
  }

  // Hazard-striped crossbar (alternating yellow/black) — much higher contrast than a flat color.
  const stripeCount = 5;
  const stripeW = width / stripeCount;
  ctx.lineCap = "butt";
  ctx.lineWidth = Math.max(5, size * 0.55);
  for (let i = 0; i < stripeCount; i++) {
    ctx.strokeStyle = i % 2 === 0 ? "#ffd60a" : "#1b1620";
    ctx.beginPath();
    ctx.moveTo(leftX + i * stripeW, barY);
    ctx.lineTo(leftX + (i + 1) * stripeW, barY);
    ctx.stroke();
  }
}

/** A stick figure with a colored head — sprinting hard in place (bent knees/elbows on a continuous
 * cycle, desynced per racer via `phaseSeed` so the pack doesn't move in creepy unison) while
 * grounded, or thrown into a dramatic ballet grand-jeté leap (legs split fore/aft, one arm reaching
 * forward and the other back) while airborne, the pose easing in/out with the jump's own arc so
 * it's most extended right at the peak. `footX/footY` is the ground contact point everything else
 * is built upward from. */
export function drawStickFigure(
  ctx: CanvasRenderingContext2D,
  footX: number,
  footY: number,
  headRadius: number,
  color: string,
  now: number,
  phaseSeed: number,
  jumping: boolean,
  jumpT: number,
  isHuman: boolean,
): void {
  const legLen = headRadius * 2.1;
  const torsoLen = headRadius * 2.2;
  const armLen = headRadius * 1.7;
  const hipY = footY - legLen;
  const shoulderY = hipY - torsoLen;
  const headY = shoulderY - headRadius * 1.15;

  ctx.strokeStyle = "#0a0a0a";
  ctx.lineWidth = Math.max(2, headRadius * 0.28);
  ctx.lineCap = "round";

  // Torso — leans forward a touch to read as mid-sprint even when standing still between strides.
  ctx.beginPath();
  ctx.moveTo(footX + headRadius * 0.15, shoulderY);
  ctx.lineTo(footX, hipY);
  ctx.stroke();

  if (jumping) {
    // Hurdle-clearing scissor: the front leg stays level/forward from the hip; the back leg trails
    // at JUMP_LEG_SPLIT_DEGREES from it (140° by default) instead of continuing the same straight
    // line, so the two legs are no longer a flat 180° needle — growing wider as jumpT rises toward
    // the peak. One arm reaches forward (same side as the front leg), the other back (same side as
    // the back leg) — a dramatic "X" silhouette at the peak, easing in/out with jumpT (0 at
    // takeoff/landing, 1 at the peak) so it doesn't just pop into place.
    const legReach = headRadius * (2.0 + 2.4 * jumpT);
    const backLegRad = (JUMP_LEG_SPLIT_DEGREES * Math.PI) / 180;
    const frontFootX = footX + legReach;
    const backFootX = footX + legReach * Math.cos(backLegRad);
    const backFootY = hipY + legReach * Math.sin(backLegRad);
    ctx.beginPath();
    ctx.moveTo(footX, hipY);
    ctx.lineTo(frontFootX, hipY);
    ctx.moveTo(footX, hipY);
    ctx.lineTo(backFootX, backFootY);
    ctx.stroke();

    const reach = armLen * (1.0 + 0.6 * jumpT);
    ctx.beginPath();
    ctx.moveTo(footX, shoulderY);
    ctx.lineTo(footX + reach, shoulderY - reach * 0.3);
    ctx.moveTo(footX, shoulderY);
    ctx.lineTo(footX - reach, shoulderY - reach * 0.15);
    ctx.stroke();
  } else {
    // Sprinting hard: two-segment (knee-bent) legs on a real stride cycle — each leg's foot
    // lifts and the knee drives forward-up during recovery, then extends down for the next
    // plant — and two-segment arms pumping vigorously up/down opposite the legs, "springing"
    // rather than swinging like a flat pendulum.
    const phase = (now / 1000) * 12 + phaseSeed;
    const strideLen = headRadius * 1.5;
    const liftHeight = headRadius * 1.35;

    for (const legPhase of [phase, phase + Math.PI]) {
      const swing = Math.sin(legPhase); // -1 (trailing back) .. 1 (reaching forward)
      const lift = Math.max(0, Math.cos(legPhase)); // 0..1, peaks mid-recovery (knee driving up)
      const legFootX = footX + swing * strideLen;
      const legFootY = footY - lift * liftHeight;
      const kneeX = footX + swing * strideLen * 0.4 + lift * headRadius * 0.5;
      const kneeY = hipY + legLen * 0.48 - lift * headRadius * 0.85;
      ctx.beginPath();
      ctx.moveTo(footX, hipY);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(legFootX, legFootY);
      ctx.stroke();
    }

    for (const armPhase of [phase + Math.PI, phase]) {
      // Opposite the same-index leg above, like a real running gait. Three bones (shoulder-elbow,
      // elbow-wrist, wrist-hand), all driven off the SAME swing value for both axes (unlike the
      // legs' separate swing/lift terms) so the hand only ever rises near the peak of its forward
      // swing, where it's already well clear of the head sideways.
      const swing = Math.sin(armPhase);
      const elbowX = footX + swing * armLen * 0.22;
      const elbowY = shoulderY + armLen * 0.3 - swing * armLen * 0.18;
      const wristX = footX + swing * armLen * 0.4;
      const wristY = shoulderY + armLen * 0.5 - swing * armLen * 0.42;
      const handX = footX + swing * armLen * 0.55;
      const handY = shoulderY + armLen * 0.62 - swing * armLen * 0.68;
      ctx.beginPath();
      ctx.moveTo(footX, shoulderY);
      ctx.lineTo(elbowX, elbowY);
      ctx.lineTo(wristX, wristY);
      ctx.lineTo(handX, handY);
      ctx.stroke();
    }
  }

  if (isHuman) {
    // A red triangle marker floating above the head, rather than a ring around it.
    const markerSize = headRadius * 0.9;
    const markerY = headY - headRadius - markerSize * 2.1;
    ctx.beginPath();
    ctx.moveTo(footX, markerY + markerSize); // bottom tip, pointing down at the head
    ctx.lineTo(footX - markerSize * 0.8, markerY);
    ctx.lineTo(footX + markerSize * 0.8, markerY);
    ctx.closePath();
    ctx.fillStyle = "#e8291c";
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(footX, headY, headRadius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

/** Shared column/ground-line geometry for a band of the given rect, keyed off however many
 * columns it needs to fit (`slotCount` — 8 for both current modes, but not hardcoded here). */
export function bandGeometry(y: number, h: number, slotCount: number = RACER_COUNT): { groundLineY: number; headRadius: number; radius: number; slotX: (slot: number) => number } {
  // The racers cluster near the left of the band (not spread across its full width) — leaves a
  // long, clearly visible runway on the right where the obstacle is approaching from, and keeps
  // the pack itself tight.
  const packLeft = CANVAS_W * PACK_LEFT_FRACTION;
  const packWidth = CANVAS_W * PACK_WIDTH_FRACTION;
  const colWidth = (packWidth - COLUMN_GAP * (slotCount - 1)) / slotCount;
  // One shared ground line for the whole band — every runner stands on it, every obstacle travels
  // along it (horizontally), and jumping is the only thing that moves a runner off of it. Doubles
  // as the background scene's horizon, so the sun lines up with where characters actually stand.
  const groundY = y + h * GROUND_Y_FRACTION;
  const radius = Math.min(colWidth * 0.28, 17);
  const groundLineY = groundY + radius + 4;
  // The stick figure's head — smaller than the old plain-circle radius since the whole figure
  // (head + torso + legs) needs more total vertical room than a circle alone did.
  const headRadius = radius * 0.55;
  const slotX = (slot: number) => packLeft + slot * (colWidth + COLUMN_GAP) + colWidth / 2;
  return { groundLineY, headRadius, radius, slotX };
}

/** Background + ground line only, no obstacle/racers — the part every band-rendering path in
 * every mode shares. */
export function drawBandScene(ctx: CanvasRenderingContext2D, y: number, h: number, sun: SunState, terrain: Terrain, now: number, slotCount?: number): ReturnType<typeof bandGeometry> {
  const geom = bandGeometry(y, h, slotCount);
  drawBandBackground(ctx, y, h, geom.groundLineY, sun, terrain, now);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.moveTo(0, geom.groundLineY);
  ctx.lineTo(CANVAS_W, geom.groundLineY);
  ctx.stroke();
  return geom;
}

export function drawRacerLabel(ctx: CanvasRenderingContext2D, runnerX: number, y: number, groundLineY: number, rank: number, name: string): void {
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${rank + 1}`, runnerX, y + 14);

  ctx.fillStyle = "#fff";
  ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(name, runnerX, groundLineY + 8);
}
