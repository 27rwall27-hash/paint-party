import {
  CANVAS_H,
  CANVAS_W,
  HIT_LINE_FRACTION,
  JUMP_AIRTIME_MS,
  JUMP_ARC_HEIGHT_PX,
  OBSTACLE_TOP_FRACTION,
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

  // Simple scrolling stripes (vertical motion, matching the obstacles' own top-to-bottom travel)
  // for a sense of forward motion.
  const stripeH = 40;
  const scrollSpeedPxPerSec = 70;
  const offset = (now / 1000) * scrollSpeedPxPerSec;
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 2;
  for (let rowY = y - stripeH - (offset % stripeH); rowY < y + h; rowY += stripeH) {
    ctx.beginPath();
    ctx.moveTo(0, rowY);
    ctx.lineTo(CANVAS_W, rowY);
    ctx.stroke();
  }

  ctx.restore();
}

function drawRace(ctx: CanvasRenderingContext2D, race: RaceInstance, identitiesById: Map<number, RacerIdentity>, y: number, h: number, now: number): void {
  drawBandBackground(ctx, y, h, now);

  const colWidth = (CANVAS_W - COLUMN_GAP * (RACER_COUNT - 1)) / RACER_COUNT;
  const hitLineY = y + h * HIT_LINE_FRACTION;
  const obstacleTopY = y + h * OBSTACLE_TOP_FRACTION;
  const radius = Math.min(colWidth * 0.28, 17);

  // Ground line where racers stand.
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(0, hitLineY + radius + 4);
  ctx.lineTo(CANVAS_W, hitLineY + radius + 4);
  ctx.stroke();

  race.racers.forEach((racer, rank) => {
    const identity = identitiesById.get(racer.identityId);
    if (!identity) return;
    // Rank 0 (1st place) draws RIGHTMOST, last place draws LEFTMOST — a failed jump visibly
    // knocks that racer's column to the far left, matching "knocked off screen to the left,
    // rejoin the horizontal line at the back".
    const displaySlot = RACER_COUNT - 1 - rank;
    const colCenterX = displaySlot * (colWidth + COLUMN_GAP) + colWidth / 2;
    const isHuman = identity.id === 0;

    if (racer.obstacle) {
      const progress = obstacleProgress(racer.obstacle, now);
      const obstacleY = obstacleTopY + progress * (hitLineY - obstacleTopY);
      ctx.fillStyle = "#5c4a2e";
      ctx.fillRect(colCenterX - colWidth * 0.32, obstacleY - 7, colWidth * 0.64, 14);
    }

    let jumpOffset = 0;
    if (isAirborne(racer, now)) {
      const t = Math.min(1, Math.max(0, (now - racer.jumpStartedAt) / JUMP_AIRTIME_MS));
      jumpOffset = -Math.sin(t * Math.PI) * JUMP_ARC_HEIGHT_PX;
    }
    const runnerY = hitLineY + jumpOffset;

    if (isHuman) {
      ctx.beginPath();
      ctx.arc(colCenterX, runnerY, radius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffd60a";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(colCenterX, runnerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = identity.color;
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${rank + 1}`, colCenterX, y + 14);

    ctx.fillStyle = "#fff";
    ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(identity.name, colCenterX, hitLineY + radius + 8);
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

  const duration = phaseDurationMs(session.phase);
  if (duration > 0) {
    const remaining = Math.max(0, Math.ceil((duration - (now - session.phaseEnteredAt)) / 1000));
    ctx.fillStyle = "#a99fb3";
    ctx.font = "14px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${remaining}s`, CANVAS_W - 20, HUD_HEIGHT / 2);
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
