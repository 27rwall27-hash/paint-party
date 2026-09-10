import {
  CANVAS_H,
  CANVAS_W,
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
import { bandRect, computeSunState, drawBandScene, drawHurdle, drawRacerLabel, drawStickFigure, HUD_HEIGHT, lerp, TERRAIN_BY_INDEX, type SunState } from "./renderShared.ts";
import type { StampedeSession } from "./StampedeSession.ts";

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

/** `animNow` drives ONLY the sprinting-in-place run cycle (see drawStickFigure) — it's a separate,
 * speed-ramped clock from `now` (see main.ts's animClockMs) so the visible running animation
 * speeds up in lockstep with the music, without touching actual jump timing/difficulty, which
 * stays on the real game clock. `getExitT(identityId)` (0..1) is nonzero only once the game has
 * ended and THIS racer's own staggered exit has started (see StampedeSession.finishingAt/
 * finishStaggerRank and exitProgressFor) — at that point jump state is ignored entirely, the racer
 * just runs straight off the right edge. */
function drawRace(ctx: CanvasRenderingContext2D, race: RaceInstance, identitiesById: Map<number, RacerIdentity>, y: number, h: number, now: number, animNow: number, sun: SunState, terrain: (typeof TERRAIN_BY_INDEX)[number], getExitT: (identityId: number) => number, showWarning: boolean): void {
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
    const terrain = TERRAIN_BY_INDEX[i] ?? TERRAIN_BY_INDEX[TERRAIN_BY_INDEX.length - 1]!;
    drawRace(ctx, session.races[i]!, identitiesById, y, h, now, animNow, sun, terrain, NO_EXIT, true);
  }

  // The brand-new band, if this split adds one (it always does in this game's flow, but stay safe).
  if (bandCount <= transition.fromBandCount) return;
  const newIdx = transition.fromBandCount;
  const newRect = bandRect(newIdx, bandCount);
  const terrain = TERRAIN_BY_INDEX[newIdx] ?? TERRAIN_BY_INDEX[TERRAIN_BY_INDEX.length - 1]!;

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

/** `animNow` is a separate, speed-ramped clock (see main.ts's animClockMs) that drives ONLY the
 * sprinting-in-place run cycle, so the visible running animation speeds up in lockstep with the
 * music without touching actual jump timing. Defaults to `now` so callers that don't care about
 * music speed (e.g. tests) still get a normal-speed animation. */
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
      const terrain = TERRAIN_BY_INDEX[i] ?? TERRAIN_BY_INDEX[TERRAIN_BY_INDEX.length - 1]!;
      drawRace(ctx, race, identitiesById, y, h, now, animNow, sun, terrain, getExitT, showWarning);
    });
  }

  drawHud(ctx, session, now);

  if (session.phase === "RESULTS") drawResults(ctx, session);
}
