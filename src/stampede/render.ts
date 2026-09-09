import {
  CANVAS_H,
  CANVAS_W,
  GROUND_Y_FRACTION,
  JUMP_AIRTIME_MS,
  JUMP_ARC_HEIGHT_PX,
  PACK_LEFT_FRACTION,
  PACK_WIDTH_FRACTION,
  POINTS_BY_RANK,
  RACER_COUNT,
  SINGLE_PHASE_MS,
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

function drawBandBackground(ctx: CanvasRenderingContext2D, y: number, h: number, now: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y, CANVAS_W, h);
  ctx.clip();
  ctx.fillStyle = "#241f29";
  ctx.fillRect(0, y, CANVAS_W, h);

  // Simple scrolling stripes — horizontal motion, matching the obstacles' own left-to-right-facing
  // travel (same convention as the original endless-runner: the world scrolls past stationary
  // runners) — for a sense of forward motion.
  const stripeW = 46;
  const scrollSpeedPxPerSec = 90;
  const offset = (now / 1000) * scrollSpeedPxPerSec;
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 2;
  for (let colX = -stripeW - (offset % stripeW); colX < CANVAS_W; colX += stripeW) {
    ctx.beginPath();
    ctx.moveTo(colX, y);
    ctx.lineTo(colX, y + h);
    ctx.stroke();
  }

  ctx.restore();
}

/** A small triangular spike sitting on the ground line, tip up — placeholder obstacle shape.
 * `groundLineY` is where the ground line is actually DRAWN (groundY + radius + 4 in drawRace,
 * not groundY itself — groundY is the runners' own center point, a few px above their feet). */
function drawSpike(ctx: CanvasRenderingContext2D, x: number, groundLineY: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x, groundLineY - size * 1.8);
  ctx.lineTo(x - size, groundLineY);
  ctx.lineTo(x + size, groundLineY);
  ctx.closePath();
  ctx.fillStyle = "#8a6d3b";
  ctx.fill();
}

/** A stick figure with a colored head — sprinting in place (legs/arms swinging on a continuous
 * cycle, desynced per racer via `phaseSeed` so the pack doesn't move in creepy unison) while
 * grounded, or thrown into an exaggerated "silly leap" pose (legs kicked out, arms flung up) while
 * airborne, the pose easing in/out with the jump's own arc so it's most exaggerated at the peak.
 * `footX/footY` is the ground contact point everything else is built upward from. */
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

  ctx.strokeStyle = "#eee6f0";
  ctx.lineWidth = Math.max(2, headRadius * 0.28);
  ctx.lineCap = "round";

  // Torso — leans forward a touch to read as mid-sprint even when standing still between strides.
  ctx.beginPath();
  ctx.moveTo(footX + headRadius * 0.15, shoulderY);
  ctx.lineTo(footX, hipY);
  ctx.stroke();

  if (jumping) {
    // Exaggerated leap: legs kicked one forward one back, arms thrown straight up — pose eases in
    // and out with jumpT (0 at takeoff/landing, 1 at the peak) so it doesn't just pop into place.
    const kick = headRadius * (0.9 + 0.9 * jumpT);
    const armRaise = headRadius * (0.6 + 1.1 * jumpT);
    ctx.beginPath();
    ctx.moveTo(footX, hipY);
    ctx.lineTo(footX - kick, footY - headRadius * 0.4);
    ctx.moveTo(footX, hipY);
    ctx.lineTo(footX + kick * 0.75, footY + headRadius * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(footX, shoulderY);
    ctx.lineTo(footX - armLen * 0.6, shoulderY - armRaise);
    ctx.moveTo(footX, shoulderY);
    ctx.lineTo(footX + armLen * 0.6, shoulderY - armRaise);
    ctx.stroke();
  } else {
    // Continuous sprint cycle — legs/arms swing oppositely, like an actual running gait.
    const phase = (now / 1000) * 11 + phaseSeed;
    const legSwing = Math.sin(phase) * headRadius * 1.15;
    const armSwing = Math.sin(phase + Math.PI) * headRadius * 0.9;
    ctx.beginPath();
    ctx.moveTo(footX, hipY);
    ctx.lineTo(footX + legSwing, footY);
    ctx.moveTo(footX, hipY);
    ctx.lineTo(footX - legSwing, footY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(footX, shoulderY);
    ctx.lineTo(footX + armSwing, shoulderY + headRadius * 1.1);
    ctx.moveTo(footX, shoulderY);
    ctx.lineTo(footX - armSwing, shoulderY + headRadius * 1.1);
    ctx.stroke();
  }

  if (isHuman) {
    ctx.beginPath();
    ctx.arc(footX, headY, headRadius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffd60a";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(footX, headY, headRadius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function drawRace(ctx: CanvasRenderingContext2D, race: RaceInstance, identitiesById: Map<number, RacerIdentity>, y: number, h: number, now: number): void {
  drawBandBackground(ctx, y, h, now);

  // The 8 racers cluster near the left of the band (not spread across its full width) — leaves a
  // long, clearly visible runway on the right where the obstacle is approaching from, and keeps
  // the pack itself tight.
  const packLeft = CANVAS_W * PACK_LEFT_FRACTION;
  const packWidth = CANVAS_W * PACK_WIDTH_FRACTION;
  const colWidth = (packWidth - COLUMN_GAP * (RACER_COUNT - 1)) / RACER_COUNT;
  // One shared ground line for the whole band — every runner stands on it, every obstacle travels
  // along it (horizontally), and jumping is the only thing that moves a runner off of it, same
  // convention as the original endless-runner this is modeled on.
  const groundY = y + h * GROUND_Y_FRACTION;
  const radius = Math.min(colWidth * 0.28, 17);
  const groundLineY = groundY + radius + 4;
  // The stick figure's head — smaller than the old plain-circle radius since the whole figure
  // (head + torso + legs) needs more total vertical room than a circle alone did.
  const headRadius = radius * 0.55;

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(0, groundLineY);
  ctx.lineTo(CANVAS_W, groundLineY);
  ctx.stroke();

  const slotX = (slot: number) => packLeft + slot * (colWidth + COLUMN_GAP) + colWidth / 2;

  // One shared obstacle for the whole race — slides from near the band's right edge to the
  // pack's own leftmost column, reaching each racer at a different moment purely because
  // they're standing at a different x (see RaceInstance.reachTimeForRank). Drawn once per band,
  // not once per racer.
  if (race.obstacle) {
    const progress = obstacleProgress(race.obstacle, now);
    const spawnX = CANVAS_W - 24;
    const targetX = slotX(0);
    const obstacleX = spawnX + progress * (targetX - spawnX);
    drawSpike(ctx, obstacleX, groundLineY, Math.max(7, radius * 0.55));
  }

  race.racers.forEach((racer, rank) => {
    const identity = identitiesById.get(racer.identityId);
    if (!identity) return;
    // Rank 0 (1st place) draws RIGHTMOST, last place draws LEFTMOST — a failed jump visibly
    // knocks that racer's column to the far left, matching "knocked off screen to the left,
    // rejoin the horizontal line at the back". Also the order the shared obstacle reaches
    // them in: rightmost (1st place) first, leftmost (last place) last. racer.displaySlot
    // slides toward this target rather than snapping to it — see RaceInstance.updateRace.
    const runnerX = slotX(racer.displaySlot);
    const isHuman = identity.id === 0;

    const airborne = isAirborne(racer, now);
    let jumpT = 0;
    let jumpOffset = 0;
    if (airborne) {
      const t = Math.min(1, Math.max(0, (now - racer.jumpStartedAt) / JUMP_AIRTIME_MS));
      jumpT = Math.sin(t * Math.PI); // 0 at takeoff/landing, 1 at the peak — also drives the leap pose
      jumpOffset = -jumpT * JUMP_ARC_HEIGHT_PX;
    }
    const footY = groundLineY + jumpOffset;

    drawStickFigure(ctx, runnerX, footY, headRadius, identity.color, now, racer.identityId * 1.9, airborne, jumpT, isHuman);

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${rank + 1}`, runnerX, y + 14);

    ctx.fillStyle = "#fff";
    ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(identity.name, runnerX, groundLineY + 8);
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

  if (session.pendingSplitAt !== null) {
    // Pulsing warning instead of the normal countdown — the actual split is being held back
    // until SPLIT_WARNING_MS has passed AND every race is between obstacles (see
    // StampedeSession.maybeSplit), so a plain "0s" would be misleading here.
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

export function render(ctx: CanvasRenderingContext2D, session: StampedeSession, now: number): void {
  ctx.fillStyle = "#1b1620";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const identitiesById = new Map(session.identities.map((i) => [i.id, i]));
  session.races.forEach((race, i) => {
    const { y, h } = bandRect(i, session.races.length);
    drawRace(ctx, race, identitiesById, y, h, now);
  });

  drawHud(ctx, session, now);

  if (session.phase === "RESULTS") drawResults(ctx, session);
}
