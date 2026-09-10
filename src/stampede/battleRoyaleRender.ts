import { BR_ELIMINATION_FLY_MS, BR_SECTIONS, BR_SLOTS_PER_SECTION, BR_TOTAL_PLAYERS } from "./battleRoyaleConstants.ts";
import { BR_FIXED_JUMP_ARC_HEIGHT_PX, type BattleRoyaleObstacle, type BattleRoyaleSession } from "./BattleRoyaleSession.ts";
import { CANVAS_H, CANVAS_W } from "./constants.ts";
import type { RacerIdentity } from "./identities.ts";
import { isAirborne } from "./RaceInstance.ts";
import { bandRect, computeSunState, drawBandScene, drawHurdle, drawRacerLabel, drawStickFigure, HUD_HEIGHT, lerp, TERRAIN_BY_INDEX } from "./renderShared.ts";

/** Same day-arc sun as Classic, driven by elimination progress instead of phase progress — the
 * sky reads more dramatic/sunset-y the closer the match gets to a single survivor. */
function battleRoyaleSunT(session: BattleRoyaleSession): number {
  return Math.min(1, session.totalEliminated / (BR_TOTAL_PLAYERS - 1));
}

/** The obstacle's leading-edge x, exactly aligned with reachTimeForSlot so the drawn hurdle is
 * physically over a racer's column at the precise instant that racer's fate resolves — not just a
 * naive two-point lerp from spawnX to the last column, which (since spawnX/targetX are pure screen
 * geometry with no relationship to the independently-tuned leadInMs/columnGapMs) drifted the
 * hurdle's drawn position tens of pixels away from a racer's own column at their actual reach
 * time, reported as "the hurdle hit box just doesn't seem right". Two segments:
 *  1. Before the first column's reach time — purely cosmetic approach from spawnX, nobody's fate
 *     is decided yet so exact alignment doesn't matter here, just a smooth lerp to slotX(last).
 *  2. From the first column's reach time onward — slotX is an affine (linear) function of slot, so
 *     feeding it the exact fractional "continuous slot" implied by elapsed time reproduces every
 *     racer's exact column position at their exact reachTimeForSlot, by construction. */
function obstacleLeadingEdgeX(obstacle: BattleRoyaleObstacle, now: number, spawnX: number, slotX: (slot: number) => number): number {
  const lastColumnX = slotX(BR_SLOTS_PER_SECTION - 1);
  const elapsed = now - obstacle.spawnedAt;
  if (elapsed <= obstacle.leadInMs) {
    const t = obstacle.leadInMs > 0 ? elapsed / obstacle.leadInMs : 1;
    return spawnX + Math.min(1, Math.max(0, t)) * (lastColumnX - spawnX);
  }
  const continuousSlot = (elapsed - obstacle.leadInMs) / obstacle.columnGapMs;
  const clamped = Math.min(BR_SLOTS_PER_SECTION - 1, Math.max(0, continuousSlot));
  return slotX(BR_SLOTS_PER_SECTION - 1 - clamped);
}

function drawBrHud(ctx: CanvasRenderingContext2D, session: BattleRoyaleSession): void {
  ctx.fillStyle = "#1b1620";
  ctx.fillRect(0, 0, CANVAS_W, HUD_HEIGHT);

  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Battle Royale", 20, HUD_HEIGHT / 2);

  const remaining = session.racers.filter((r) => !r.eliminated).length;
  ctx.fillStyle = "#ffd60a";
  ctx.font = "bold 15px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${remaining} player${remaining === 1 ? "" : "s"} remaining`, CANVAS_W - 20, HUD_HEIGHT / 2);

  const human = session.racers.find((r) => r.identityId === 0);
  if (human && !human.eliminated) {
    ctx.fillStyle = "#a99fb3";
    ctx.font = "13px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("You're still in it", CANVAS_W / 2, HUD_HEIGHT / 2);
  } else if (human) {
    ctx.fillStyle = "#a99fb3";
    ctx.font = "13px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("You're out — spectating", CANVAS_W / 2, HUD_HEIGHT / 2);
  }
}

/** A centered pulsing banner replacing the per-band hazard sign from Classic mode — shown for the
 * whole checkpoint pause, every BR_CHECKPOINT_EVERY_ELIMINATIONS cumulative eliminations. */
function drawCheckpointBanner(ctx: CanvasRenderingContext2D, session: BattleRoyaleSession, now: number): void {
  if (session.checkpointPauseUntil === null) return;
  const pulse = 0.5 + 0.5 * Math.sin((now / 1000) * 5);
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  const w = 640;
  const h = 140;

  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = "#1b1620";
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.lineWidth = 4;
  ctx.strokeStyle = `rgba(255, 214, 10, ${(0.5 + 0.5 * pulse).toFixed(2)})`;
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  ctx.restore();

  const remaining = session.racers.filter((r) => !r.eliminated).length;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffd60a";
  ctx.font = "bold 30px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(`${session.totalEliminated} ELIMINATED`, cx, cy - 20);
  ctx.fillStyle = "#fff";
  ctx.font = "18px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(`${remaining} REMAIN — SPEEDING UP...`, cx, cy + 20);
}

/** 1 = winner. Otherwise 1 + however many racers survived strictly longer (still in, or
 * eliminated later) — the human's own finishing placement for the results screen. */
function placementOf(session: BattleRoyaleSession, identityId: number): number {
  const racer = session.racers.find((r) => r.identityId === identityId);
  if (!racer || !racer.eliminated) return 1;
  const survivedLonger = session.racers.filter((r) => r.identityId !== identityId && (!r.eliminated || (r.eliminatedAt ?? 0) > (racer.eliminatedAt ?? 0))).length;
  return 1 + survivedLonger;
}

function drawBrResults(ctx: CanvasRenderingContext2D, session: BattleRoyaleSession): void {
  ctx.fillStyle = "rgba(27, 22, 32, 0.92)";
  ctx.fillRect(0, HUD_HEIGHT, CANVAS_W, CANVAS_H - HUD_HEIGHT);

  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const winner = session.identities.find((i) => i.id === session.winnerIdentityId);
  if (!winner) {
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("No survivors!", cx, cy);
    return;
  }

  ctx.beginPath();
  ctx.arc(cx, cy - 60, 34, 0, Math.PI * 2);
  ctx.fillStyle = winner.color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#ffd60a";
  ctx.font = "bold 38px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(`${winner.name} WINS!`, cx, cy + 10);

  if (winner.id !== 0) {
    const placement = placementOf(session, 0);
    ctx.fillStyle = "#a99fb3";
    ctx.font = "16px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(`You placed #${placement} of ${BR_TOTAL_PLAYERS}`, cx, cy + 55);
  }
}

export function renderBattleRoyale(ctx: CanvasRenderingContext2D, session: BattleRoyaleSession, now: number, animNow: number = now): void {
  ctx.fillStyle = "#1b1620";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const identitiesById = new Map<number, RacerIdentity>(session.identities.map((i) => [i.id, i]));
  const sun = computeSunState(battleRoyaleSunT(session));

  for (let section = 0; section < BR_SECTIONS; section++) {
    const { y, h } = bandRect(section, BR_SECTIONS);
    const terrain = TERRAIN_BY_INDEX[section] ?? TERRAIN_BY_INDEX[TERRAIN_BY_INDEX.length - 1]!;
    const { groundLineY, headRadius, radius, slotX } = drawBandScene(ctx, y, h, sun, terrain, now, BR_SLOTS_PER_SECTION);

    // Obstacles are shared/identical across every section — same wave, same position, everywhere.
    for (const obstacle of session.obstacles) {
      const spawnX = CANVAS_W - 24;
      const obstacleX = obstacleLeadingEdgeX(obstacle, now, spawnX, slotX);
      drawHurdle(ctx, obstacleX, groundLineY, Math.max(9, radius * 0.75));
    }

    const sectionRacers = session.racers.filter((r) => r.section === section);
    const sectionFullyEliminated = sectionRacers.every((r) => r.eliminated);

    for (const racer of sectionRacers) {
      const identity = identitiesById.get(racer.identityId);
      if (!identity) continue;
      const isHuman = identity.id === 0;
      // The obstacle sweeps right-to-left toward slotX(0) (see targetX above), so it reaches the
      // RIGHTMOST column first and the leftmost last — but reachTimeForSlot treats slot 0 as
      // reached FIRST (soonest). Flipping the visual column here (same "displaySlot = COUNT-1-x"
      // convention Classic mode uses) is what makes the two agree: slot 0 (reached first) draws
      // rightmost, slot 7 (reached last) draws leftmost. Left unflipped, CPUs jumped in the
      // correct logical order but at the visually wrong end of the sweep — exactly the "jumping
      // back to front, perfectly flipped" bug this fixes.
      const visualSlot = BR_SLOTS_PER_SECTION - 1 - racer.slot;
      let runnerX = slotX(visualSlot);

      let airborne = false;
      let jumpT = 0;
      let jumpOffset = 0;

      if (racer.eliminated) {
        const flyT = Math.min(1, (now - (racer.eliminatedAt ?? now)) / BR_ELIMINATION_FLY_MS);
        if (flyT >= 1) continue; // fully off screen, stop drawing entirely
        runnerX = lerp(runnerX, -120, flyT);
      } else {
        airborne = isAirborne(racer, now);
        if (airborne) {
          const t = Math.min(1, Math.max(0, (now - racer.jumpStartedAt) / racer.jumpAirtimeMs));
          jumpT = Math.sin(t * Math.PI);
          jumpOffset = -jumpT * BR_FIXED_JUMP_ARC_HEIGHT_PX;
        }
      }
      const footY = groundLineY + jumpOffset;

      drawStickFigure(ctx, runnerX, footY, headRadius, identity.color, animNow, racer.identityId * 1.9, airborne, jumpT, isHuman);
      drawRacerLabel(ctx, runnerX, y, groundLineY, racer.slot, identity.name);
    }

    // "Dim the lights" once every racer in this section is out — still shown, just visibly dead,
    // since the game isn't over until 1 player remains anywhere.
    if (sectionFullyEliminated) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
      ctx.fillRect(0, y, CANVAS_W, h);
    }
  }

  drawBrHud(ctx, session);
  drawCheckpointBanner(ctx, session, now);

  if (session.phase === "RESULTS") drawBrResults(ctx, session);
}
