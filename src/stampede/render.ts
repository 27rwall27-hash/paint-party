import {
  CANVAS_H,
  CANVAS_W,
  GROUND_Y_FRACTION,
  JUMP_LEG_SPLIT_DEGREES,
  PACK_LEFT_FRACTION,
  PACK_WIDTH_FRACTION,
  POINTS_BY_RANK,
  RACER_COUNT,
  RESULTS_EXIT_RUN_MS,
  RESULTS_EXIT_STAGGER_MS,
  SINGLE_PHASE_MS,
  SPLIT_EMPTY_HOLD_MS,
  SPLIT_PUSH_IN_MS,
  SPLIT_RUNNER_RUN_IN_MS,
  SPLIT_RUNNER_STAGGER_MS,
  THREE_WAY_PHASE_MS,
  TWO_WAY_PHASE_MS,
} from "./constants.ts";
import type { RacerIdentity } from "./identities.ts";
import { isAirborne, obstacleProgress, type RaceInstance } from "./RaceInstance.ts";
import type { StampedeSession } from "./StampedeSession.ts";

const HUD_HEIGHT = 56;
const BAND_GAP = 4;
const COLUMN_GAP = 4;

const PHASE_LABEL: Record<string, string> = {
  SINGLE: "The Pack",
  TWO_WAY: "Two Races",
  THREE_WAY: "Final Stretch",
  RESULTS: "Results",
};

function phaseDurationMs(phase: string): number {
  switch (phase) {
    case "SINGLE":
      return SINGLE_PHASE_MS;
    case "TWO_WAY":
      return TWO_WAY_PHASE_MS;
    case "THREE_WAY":
      return THREE_WAY_PHASE_MS;
    default:
      return 0;
  }
}

function bandRect(index: number, bandCount: number): { y: number; h: number } {
  const totalH = CANVAS_H - HUD_HEIGHT;
  const h = totalH / bandCount - BAND_GAP;
  const y = HUD_HEIGHT + index * (totalH / bandCount) + BAND_GAP / 2;
  return { y, h };
}

// Each race gets its own terrain, keyed by race index (band 0 = the original race, band 1 = the
// race born at the first split, band 2 = the race born at the second split) — same identity the
// rest of the game already uses, so no new "which race is which" concept is needed. The sky and
// sun stay identical across all three (see computeSunState) so it genuinely reads as the same sky
// over three different terrains, not three unrelated scenes — only the ground color and a small,
// muted set of background decorations (see drawTerrainDecorations) differ.
type Terrain = "grass" | "beach" | "ice";
const TERRAIN_BY_RACE_INDEX: Terrain[] = ["grass", "beach", "ice"];
const TERRAIN_GROUND_COLOR: Record<Terrain, string> = { grass: "#5f9a52", beach: "#eec99a", ice: "#d8e8ef" };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function lerpColor(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return `rgb(${Math.round(lerp(a.r, b.r, t))}, ${Math.round(lerp(a.g, b.g, t))}, ${Math.round(lerp(a.b, b.b, t))})`;
}

/** 0 (SINGLE phase just started) → 1 (THREE_WAY finished / RESULTS) — driven by PHASE progress
 * rather than wall-clock time, so the sun reliably reaches full sunset by the time the game ends
 * regardless of how long the variable pre-split quiet periods run. Each phase owns an even third
 * of the arc; a pending-split quiet period just holds the sun at that phase's end position rather
 * than overshooting. */
function sessionProgress(session: StampedeSession, now: number): number {
  const elapsed = now - session.phaseEnteredAt;
  const withinPhase = (durationMs: number) => Math.min(1, Math.max(0, elapsed / durationMs));
  if (session.phase === "SINGLE") return withinPhase(SINGLE_PHASE_MS) * (1 / 3);
  if (session.phase === "TWO_WAY") return 1 / 3 + withinPhase(TWO_WAY_PHASE_MS) * (1 / 3);
  if (session.phase === "THREE_WAY") return 2 / 3 + withinPhase(THREE_WAY_PHASE_MS) * (1 / 3);
  return 1; // RESULTS
}

interface SunState {
  /** Fraction of CANVAS_W — same for every band, since it's the same sun. */
  xFrac: number;
  /** Fraction of a band's OWN height — each band places the sun relative to its own sky, so a
   * full-height SINGLE band and a third-height THREE_WAY band both show a complete, proportional
   * scene from the same underlying sun state. */
  yFrac: number;
  sky: [string, string, string];
  sunColor: string;
}

/** One sun, computed once per frame from overall game progress and handed to every band — a
 * pale, high, top-right morning sun at the start of the game arcing down to the warm, low sunset
 * position/palette by the end. */
function computeSunState(t: number): SunState {
  return {
    xFrac: lerp(0.86, 0.24, t),
    yFrac: lerp(0.12, 1.0, t),
    sky: [lerpColor("#8fb8d9", "#b8380f", t), lerpColor("#f3c9a8", "#dd7233", t), lerpColor("#fdf1d9", "#f6c98a", t)],
    sunColor: lerpColor("#fff6e0", "#fbecc2", t),
  };
}

/** A small, muted set of background decorations per terrain — deliberately subtle (soft/low-count/
 * low-contrast, and never near the pack's own columns) so they read as ambient scenery rather than
 * competing with the hurdle or runners for attention. Drawn after the ground fill so pyramids'
 * bases sit properly on top of the sand rather than being covered by it. */
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
    // A jagged glacier silhouette on the horizon (same treatment as the pyramids/hills).
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
 * band so 2-3 stacked bands each get their own full scene rather than sharing one cropped image. */
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

/** A massive flashing yellow hazard sign plus "NEW RACE STARTING" text, at the far right of a
 * band — shown for the whole "something big is about to happen" window (see the two call sites:
 * drawRace's `showWarning` during the pre-split quiet wait, and drawSplitTransition unconditionally
 * during the cinematic itself). The triangle pulses; the text stays solid/legible throughout. */
function drawSplitWarningSign(ctx: CanvasRenderingContext2D, y: number, h: number, now: number): void {
  const pulse = 0.5 + 0.5 * Math.sin((now / 1000) * 5);
  const cx = CANVAS_W - 110;
  const cy = y + h * 0.4;
  const size = Math.min(h * 0.32, 80);

  ctx.save();
  ctx.globalAlpha = 0.4 + 0.6 * pulse;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx - size * 0.95, cy + size * 0.75);
  ctx.lineTo(cx + size * 0.95, cy + size * 0.75);
  ctx.closePath();
  ctx.fillStyle = "#ffd60a";
  ctx.fill();
  ctx.lineWidth = Math.max(3, size * 0.08);
  ctx.strokeStyle = "#1b1620";
  ctx.stroke();

  ctx.fillStyle = "#1b1620";
  ctx.font = `bold ${Math.round(size * 0.85)}px 'Segoe UI', system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", cx, cy + size * 0.2);
  ctx.restore();

  ctx.fillStyle = "#fff";
  ctx.font = "bold 15px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("NEW RACE STARTING", cx, cy + size * 0.75 + 10);
}

/** A track hurdle sitting on the ground line: two pale posts and a colored crossbar. `leftX` is
 * the LEADING (leftmost) post's x — and deliberately the actual hitbox/reach-time position the
 * obstacle's approach is computed against (see the call site in drawRace), not the hurdle's
 * visual center. The obstacle travels right-to-left, so the left post is the edge that reaches
 * any given column first; drawing the rest of the hurdle's width trailing behind (to the right of)
 * that post, rather than centered on it, means a runner's column and the hurdle's drawn shape
 * agree exactly on when contact happens — previously the wider drawn shape visually reached a
 * runner's column before the (center-based) game logic actually resolved that jump. `groundLineY`
 * is where the ground line is actually DRAWN (groundY + radius + 4 in drawRace, not groundY itself
 * — groundY is the runners' own center point, a few px above their feet). */
function drawHurdle(ctx: CanvasRenderingContext2D, leftX: number, groundLineY: number, size: number): void {
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

  // Hazard-striped crossbar (alternating yellow/black) — much higher contrast than a flat color,
  // matching the same hazard palette as drawSplitWarningSign.
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
 * grounded, or thrown into a dramatic ballet grand-jeté leap (legs fully split fore/aft, one arm
 * reaching forward and the other back) while airborne, the pose easing in/out with the jump's own
 * arc so it's most extended right at the peak. `footX/footY` is the ground contact point
 * everything else is built upward from. */
function drawStickFigure(
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
      // swing, where it's already well clear of the head sideways — an earlier version lifted the
      // hand straight up at zero horizontal offset and it vanished behind the head circle.
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
    // A red triangle marker pointing down at the head, rather than a ring around it.
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

/** Shared column/ground-line geometry for a band of the given rect — factored out since the split
 * transition's push-in/empty-hold/run-in phases (see drawSplitTransition) all need the same
 * layout math as normal gameplay rendering, just fed different (sometimes animating) y/h values. */
function bandGeometry(y: number, h: number): { groundLineY: number; headRadius: number; radius: number; slotX: (slot: number) => number } {
  // The 8 racers cluster near the left of the band (not spread across its full width) — leaves a
  // long, clearly visible runway on the right where the obstacle is approaching from, and keeps
  // the pack itself tight.
  const packLeft = CANVAS_W * PACK_LEFT_FRACTION;
  const packWidth = CANVAS_W * PACK_WIDTH_FRACTION;
  const colWidth = (packWidth - COLUMN_GAP * (RACER_COUNT - 1)) / RACER_COUNT;
  // One shared ground line for the whole band — every runner stands on it, every obstacle travels
  // along it (horizontally), and jumping is the only thing that moves a runner off of it, same
  // convention as the original endless-runner this is modeled on. Doubles as the background
  // scene's horizon, so the sun lines up with where characters actually stand.
  const groundY = y + h * GROUND_Y_FRACTION;
  const radius = Math.min(colWidth * 0.28, 17);
  const groundLineY = groundY + radius + 4;
  // The stick figure's head — smaller than the old plain-circle radius since the whole figure
  // (head + torso + legs) needs more total vertical room than a circle alone did.
  const headRadius = radius * 0.55;
  const slotX = (slot: number) => packLeft + slot * (colWidth + COLUMN_GAP) + colWidth / 2;
  return { groundLineY, headRadius, radius, slotX };
}

/** Background + ground line only, no obstacle/racers — the part every band-rendering path (normal
 * gameplay, and every phase of the split transition) shares. */
function drawBandScene(ctx: CanvasRenderingContext2D, y: number, h: number, sun: SunState, terrain: Terrain, now: number): ReturnType<typeof bandGeometry> {
  const geom = bandGeometry(y, h);
  drawBandBackground(ctx, y, h, geom.groundLineY, sun, terrain, now);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.moveTo(0, geom.groundLineY);
  ctx.lineTo(CANVAS_W, geom.groundLineY);
  ctx.stroke();
  return geom;
}

function drawRacerLabel(ctx: CanvasRenderingContext2D, runnerX: number, y: number, groundLineY: number, rank: number, name: string): void {
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

/** `animNow` drives ONLY the sprinting-in-place run cycle (see drawStickFigure) — it's a separate,
 * speed-ramped clock from `now` (see main.ts's animClockMs) so the visible running animation
 * speeds up in lockstep with the music, without touching actual jump timing/difficulty, which
 * stays on the real game clock. `getExitT(identityId)` (0..1) is nonzero only once the game has
 * ended and THIS racer's own staggered exit has started (see StampedeSession.finishingAt/
 * finishStaggerRank and exitProgressFor) — at that point jump state is ignored entirely, the racer
 * just runs straight off the right edge. */
function drawRace(ctx: CanvasRenderingContext2D, race: RaceInstance, identitiesById: Map<number, RacerIdentity>, y: number, h: number, now: number, animNow: number, sun: SunState, terrain: Terrain, getExitT: (identityId: number) => number, showWarning: boolean): void {
  const { groundLineY, headRadius, radius, slotX } = drawBandScene(ctx, y, h, sun, terrain, now);

  // The race's obstacle(s) — normally one, rarely two (see MULTI_OBSTACLE_CHANCE) — each slides
  // from near the band's right edge to the pack's own leftmost column, reaching each racer at a
  // different moment purely because they're standing at a different x (see
  // RaceInstance.reachTimeForRank).
  for (const obstacle of race.obstacles) {
    const progress = obstacleProgress(obstacle, now);
    const spawnX = CANVAS_W - 24;
    const targetX = slotX(0);
    const obstacleX = spawnX + progress * (targetX - spawnX);
    drawHurdle(ctx, obstacleX, groundLineY, Math.max(9, radius * 0.75));
  }

  race.racers.forEach((racer, rank) => {
    const identity = identitiesById.get(racer.identityId);
    if (!identity) return;
    // Rank 0 (1st place) draws RIGHTMOST, last place draws LEFTMOST — a failed jump visibly
    // knocks that racer's column to the far left, matching "knocked off screen to the left,
    // rejoin the horizontal line at the back". Also the order the shared obstacle reaches
    // them in: rightmost (1st place) first, leftmost (last place) last. racer.displaySlot
    // slides toward this target rather than snapping to it — see RaceInstance.updateRace.
    let runnerX = slotX(racer.displaySlot);
    const isHuman = identity.id === 0;

    let airborne = false;
    let jumpT = 0;
    let jumpOffset = 0;
    const exitT = getExitT(racer.identityId);
    if (exitT > 0) {
      runnerX = lerp(runnerX, CANVAS_W + 150, exitT);
    } else {
      airborne = isAirborne(racer, now);
      if (airborne) {
        const t = Math.min(1, Math.max(0, (now - racer.jumpStartedAt) / racer.jumpAirtimeMs));
        jumpT = Math.sin(t * Math.PI); // 0 at takeoff/landing, 1 at the peak — also drives the leap pose
        jumpOffset = -jumpT * racer.jumpArcHeightPx;
      }
    }
    const footY = groundLineY + jumpOffset;

    drawStickFigure(ctx, runnerX, footY, headRadius, identity.color, animNow, racer.identityId * 1.9, airborne, jumpT, isHuman);
    drawRacerLabel(ctx, runnerX, y, groundLineY, rank, identity.name);
  });

  if (showWarning) drawSplitWarningSign(ctx, y, h, now);
}

const NO_EXIT = () => 0;

/** The push-in/empty-scene/runners-file-in cinematic that now plays at every split instead of the
 * layout just snapping straight to the new, smaller bands (see StampedeSession.SplitTransition).
 * Bands that already existed before the split keep rendering their real, live racers the WHOLE
 * time (via the normal drawRace, just fed animating y/h during the push-in) — they never disappear
 * and reappear. Only the brand-new band (which has no RaceInstance yet) goes through its own
 * three-beat sequence, timed from `transition.startedAt`:
 *   1. PUSH_IN — slides up into place from below the visible area, empty.
 *   2. EMPTY_HOLD — settled at its final position, still empty — a beat of "empty track" before
 *      anyone appears.
 *   3. Run-in — every rank's racer sprints in from off-screen left into its slot, one rank at a
 *      time (using the snapshot captured at transition start — see
 *      StampedeSession.SplitTransition.newBandOrder). */
function drawSplitTransition(ctx: CanvasRenderingContext2D, session: StampedeSession, identitiesById: Map<number, RacerIdentity>, sun: SunState, now: number, animNow: number): void {
  const transition = session.transition!;
  const t = now - transition.startedAt;
  const bandCount = transition.toBandCount;
  const pushT = Math.min(1, t / SPLIT_PUSH_IN_MS);

  // Existing bands: real race, real racers, drawn the whole time — only their RECT animates. The
  // whole transition is "the race splitting", so the warning sign shows in every band throughout.
  for (let i = 0; i < transition.fromBandCount; i++) {
    const from = bandRect(i, transition.fromBandCount);
    const to = bandRect(i, bandCount);
    const y = lerp(from.y, to.y, pushT);
    const h = lerp(from.h, to.h, pushT);
    const terrain = TERRAIN_BY_RACE_INDEX[i] ?? TERRAIN_BY_RACE_INDEX[TERRAIN_BY_RACE_INDEX.length - 1]!;
    drawRace(ctx, session.races[i]!, identitiesById, y, h, now, animNow, sun, terrain, NO_EXIT, true);
  }

  // The brand-new band, if this split adds one (it always does in this game's flow, but stay safe).
  if (bandCount <= transition.fromBandCount) return;
  const newIdx = transition.fromBandCount;
  const newRect = bandRect(newIdx, bandCount);
  const terrain = TERRAIN_BY_RACE_INDEX[newIdx] ?? TERRAIN_BY_RACE_INDEX[TERRAIN_BY_RACE_INDEX.length - 1]!;

  if (t < SPLIT_PUSH_IN_MS) {
    const y = lerp(CANVAS_H, newRect.y, pushT);
    drawBandScene(ctx, y, newRect.h, sun, terrain, now);
    drawSplitWarningSign(ctx, y, newRect.h, now);
    return;
  }

  const geom = drawBandScene(ctx, newRect.y, newRect.h, sun, terrain, now);
  drawSplitWarningSign(ctx, newRect.y, newRect.h, now);
  if (t < SPLIT_PUSH_IN_MS + SPLIT_EMPTY_HOLD_MS) return; // empty hold, no runners yet

  const runInT = t - SPLIT_PUSH_IN_MS - SPLIT_EMPTY_HOLD_MS;
  transition.newBandOrder.forEach((identity, rank) => {
    const startAt = rank * SPLIT_RUNNER_STAGGER_MS;
    if (runInT < startAt) return;
    const localT = Math.min(1, (runInT - startAt) / SPLIT_RUNNER_RUN_IN_MS);
    const targetX = geom.slotX(RACER_COUNT - 1 - rank);
    const runnerX = lerp(-80, targetX, localT);
    drawStickFigure(ctx, runnerX, geom.groundLineY, geom.headRadius, identity.color, animNow, identity.id * 1.9, false, 0, identity.id === 0);
    drawRacerLabel(ctx, runnerX, newRect.y, geom.groundLineY, rank, identity.name);
  });
}

function drawHud(ctx: CanvasRenderingContext2D, session: StampedeSession, now: number): void {
  ctx.fillStyle = "#1b1620";
  ctx.fillRect(0, 0, CANVAS_W, HUD_HEIGHT);

  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(PHASE_LABEL[session.phase] ?? session.phase, 20, HUD_HEIGHT / 2);

  if (session.pendingSplitAt !== null || session.transition !== null) {
    // Pulsing warning instead of the normal countdown — obstacle spawning is suppressed and the
    // split is either waiting out a genuine quiet period or already mid-transition (see
    // StampedeSession.maybeSplit/SplitTransition), so a plain "0s" would be misleading here.
    const pulse = 0.55 + 0.45 * Math.sin((now / 1000) * 6);
    ctx.fillStyle = `rgba(255, 138, 61, ${pulse.toFixed(2)})`;
    ctx.font = "bold 14px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("⚠ Splitting soon...", CANVAS_W - 20, HUD_HEIGHT / 2);
  } else {
    const duration = phaseDurationMs(session.phase);
    if (duration > 0) {
      const remaining = Math.max(0, Math.ceil((duration - (now - session.phaseEnteredAt)) / 1000));
      ctx.fillStyle = "#a99fb3";
      ctx.font = "14px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${remaining}s`, CANVAS_W - 20, HUD_HEIGHT / 2);
    }
  }

  if (session.phase !== "RESULTS") {
    const humanRanks = session.races.map((race) => race.racers.findIndex((r) => r.identityId === 0) + 1);
    ctx.fillStyle = "#ffd60a";
    ctx.font = "13px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`You: ${humanRanks.map((r) => `#${r}`).join("  /  ")}`, CANVAS_W / 2, HUD_HEIGHT / 2);
  }
}

function drawResults(ctx: CanvasRenderingContext2D, session: StampedeSession): void {
  ctx.fillStyle = "rgba(27, 22, 32, 0.92)";
  ctx.fillRect(0, HUD_HEIGHT, CANVAS_W, CANVAS_H - HUD_HEIGHT);

  if (!session.finalScores) return;
  const pointsByIdentity = session.identities.map((identity) => {
    const perRace = session.races.map((race) => {
      const rank = race.racers.findIndex((r) => r.identityId === identity.id);
      return POINTS_BY_RANK[rank] ?? 0;
    });
    return { identity, perRace, total: session.finalScores![identity.id] ?? 0 };
  });
  pointsByIdentity.sort((a, b) => b.total - a.total);

  const startY = HUD_HEIGHT + 50;
  const rowH = 46;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  pointsByIdentity.forEach((entry, i) => {
    const rowY = startY + i * rowH;
    if (i === 0) {
      ctx.fillStyle = "rgba(255, 214, 10, 0.12)";
      ctx.fillRect(CANVAS_W / 2 - 340, rowY - rowH / 2 + 4, 680, rowH - 8);
    }
    ctx.fillStyle = "#a99fb3";
    ctx.font = "14px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(`${i + 1}.`, CANVAS_W / 2 - 330, rowY);

    ctx.beginPath();
    ctx.arc(CANVAS_W / 2 - 295, rowY, 9, 0, Math.PI * 2);
    ctx.fillStyle = entry.identity.color;
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 15px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(entry.identity.name, CANVAS_W / 2 - 275, rowY);

    ctx.fillStyle = "#a99fb3";
    ctx.font = "13px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(`(${entry.perRace.join(" + ")})`, CANVAS_W / 2 - 40, rowY);

    ctx.fillStyle = "#ffd60a";
    ctx.font = "bold 16px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${entry.total} pts`, CANVAS_W / 2 + 330, rowY);
    ctx.textAlign = "left";
  });
}

/** `animNow` is a separate, speed-ramped clock (see main.ts's animClockMs) that drives ONLY the
 * sprinting-in-place run cycle, so the visible running animation speeds up in lockstep with the
 * music without touching actual jump timing. Defaults to `now` so callers that don't care about
 * music speed (e.g. tests) still get a normal-speed animation. */
/** 0 until THIS racer's own staggered exit slot (by overall finish order — see
 * StampedeSession.finishStaggerRank) has started, then ramps 0->1 over its own RESULTS_EXIT_RUN_MS
 * once it does. Racers exit one at a time (best overall placement first, like leading a victory
 * lap off) rather than everyone bunching up and leaving together. */
function exitProgressFor(session: StampedeSession, identityId: number, now: number): number {
  if (session.finishingAt === null || !session.finishStaggerRank) return 0;
  const staggerRank = session.finishStaggerRank.get(identityId) ?? 0;
  const startAt = session.finishingAt + staggerRank * RESULTS_EXIT_STAGGER_MS;
  if (now < startAt) return 0;
  return Math.min(1, (now - startAt) / RESULTS_EXIT_RUN_MS);
}

export function render(ctx: CanvasRenderingContext2D, session: StampedeSession, now: number, animNow: number = now): void {
  ctx.fillStyle = "#1b1620";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const identitiesById = new Map(session.identities.map((i) => [i.id, i]));
  const sun = computeSunState(sessionProgress(session, now));

  if (session.transition) {
    drawSplitTransition(ctx, session, identitiesById, sun, now, animNow);
  } else {
    const getExitT = (identityId: number) => exitProgressFor(session, identityId, now);
    const showWarning = session.pendingSplitAt !== null;
    session.races.forEach((race, i) => {
      const { y, h } = bandRect(i, session.races.length);
      const terrain = TERRAIN_BY_RACE_INDEX[i] ?? TERRAIN_BY_RACE_INDEX[TERRAIN_BY_RACE_INDEX.length - 1]!;
      drawRace(ctx, race, identitiesById, y, h, now, animNow, sun, terrain, getExitT, showWarning);
    });
  }

  drawHud(ctx, session, now);

  if (session.phase === "RESULTS") drawResults(ctx, session);
}
