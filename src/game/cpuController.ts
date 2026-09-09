import type { GameSession } from "./GameSession.ts";
import type { PlayerInputState } from "./Input.ts";
import { activePlayers, currentMaxRadius, type Player } from "./Player.ts";
import { MIN_RADIUS } from "./constants.ts";
import { hexToRgb, type Outline } from "./Outline.ts";

// Retargeting cadence — an outer cap on how long a bot sticks with one target; real dwell length
// is usually shorter, decided by coverage (see maybeRetargetEarly) rather than this timer, but a
// cap still keeps things bounded even in an edge case where coverage-based logic doesn't trigger.
const RETARGET_MIN_MS = 1800;
const RETARGET_MAX_MS = 3500;
// How much closer than "touching" a bot tries to get before it's considered close enough to fire
// — deliberately measured against the player's own charge radius only, NOT the target's size, so
// a bot genuinely walks to its specific aim point before releasing, instead of firing the instant
// it enters the target's general vicinity from wherever its approach path happened to be.
const ARRIVAL_MARGIN = 6;
// Fraction of full charge a bot's radius needs to reach before it's "worth" releasing once in
// range, randomized per target pick for variety.
const FIRE_THRESHOLD_MIN = 0.65;
const FIRE_THRESHOLD_MAX = 0.95;
// Below this many px of difference, stop nudging that axis.
const MOVE_DEADZONE = 8;
// Odds a retarget prefers a nearby unclaimed power-up over the next outline.
const POWERUP_CHASE_CHANCE = 0.45;
const POWERUP_CHASE_MAX_DIST = 420;
// How far a per-shot aim point can land from the target's true center, as a fraction of its
// (effective) radius.
const AIM_JITTER_FRACTION = 0.8;
// How many random candidate points get sampled (and scored against real paint coverage) each time
// an aim point is picked — higher finds a better spot more reliably, at the cost of one more
// classify() lookup each (cheap — a handful of array reads, not a fresh canvas scan).
const AIM_CANDIDATES = 14;
// Coverage-based scoring for a candidate aim point: painting over the current leader's color is
// explicitly the top priority (contesting whoever's actually winning), open/unpainted space is
// second, another (non-leading) opponent's paint is third, and this bot's OWN already-claimed
// paint is actively avoided — repainting it gains nothing.
const AIM_SCORE = { leader: 3, empty: 2, other: 1, self: -3, outside: -5 } as const;
// Once this bot's own share of an outline's painted area reaches this fraction (of the outline's
// bounding box — a relative, consistent-enough proxy, not exact shape-area accounting), treat it
// as "already won, nothing left worth gaining here" for target SELECTION purposes.
const SELF_DOMINANT_FRACTION = 0.8;
// Selection-time bonuses (score is minimized — see pickTarget): contesting an outline someone
// ELSE currently leads is worth more than one that's simply got open space, both meaningfully
// more than raw distance alone so a bot doesn't just always beeline the nearest shape regardless
// of whether there's anything worth doing there.
const CONTEST_LEADER_BONUS = 260;
const OPEN_SPACE_BONUS_SCALE = 180;
const ALREADY_DOMINANT_PENALTY = 6000;

const NEUTRAL: PlayerInputState = { up: false, down: false, left: false, right: false, paint: false };

interface BotState {
  centerX: number;
  centerY: number;
  targetX: number;
  targetY: number;
  /** The target's own effective size — an outline's `boundingRadius` (NOT its raw `.radius`,
   * which for a rectangle-kind outline like "the big one" round is 0) or a power-up's `.radius`. */
  targetRadius: number;
  isPowerup: boolean;
  outlineIndex: number | undefined;
  fireThreshold: number;
  retargetAt: number;
  wasCharging: boolean;
  input: PlayerInputState;
}

interface BotHistory {
  lastOutlineIndex: number | undefined;
}

/** A random point within AIM_JITTER_FRACTION of `radius` from (cx, cy). */
function jitterAim(cx: number, cy: number, radius: number): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * radius * AIM_JITTER_FRACTION;
  return { x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist };
}

/** One pass over an outline's actual painted pixels — who's covered what, right now. Real (if
 * approximate — bounding-box-relative, same convention scoring.ts already uses) coverage data,
 * not a guess from memory of past shots. Expensive-ish (a full getImageData + per-pixel nearest-
 * color match, same approach scoring.ts's scoreOutline uses for real scoring) so this is only
 * called once per target pick / once per shot fired, never every tick. */
function analyzeCoverage(outline: Outline, players: Player[], selfId: number) {
  const { x, y, w, h } = outline.bbox;
  const data = outline.paintCtx.getImageData(x, y, w, h).data;
  const palette = players.map((p) => ({ id: p.id, rgb: hexToRgb(p.color) }));

  const classifyIndex = (idx: number): number => {
    const a = data[idx + 3]!;
    if (a < 64) return -1;
    const r = data[idx]!;
    const g = data[idx + 1]!;
    const b = data[idx + 2]!;
    let bestId = -1;
    let bestDist = Infinity;
    for (const { id, rgb } of palette) {
      const dist = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestId = id;
      }
    }
    return bestId;
  };

  const counts = new Map<number, number>(players.map((p) => [p.id, 0]));
  for (let i = 0; i < data.length; i += 4) {
    const id = classifyIndex(i);
    if (id !== -1) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  let leaderId: number | null = null;
  let leaderCount = 0;
  let paintedPixels = 0;
  for (const [id, count] of counts) {
    paintedPixels += count;
    if (count > leaderCount) {
      leaderCount = count;
      leaderId = id;
    }
  }

  // Denominator is the shape's TRUE path area (outline.areaPixels), not the scanned bbox's raw
  // w*h — the bbox always includes real padding around the shape (see Outline's clampBox), so
  // using it as the denominator badly understates coverage: a splat that visually fills an entire
  // circular outline only covers ~54% of its own (much larger, square) bounding box, never
  // approaching a "dominant"-looking fraction no matter how completely the shape is actually
  // painted. This matches the same numerator/denominator convention scoring.ts's scoreOutline
  // already uses for the real, authoritative per-outline ranking. emptyFraction is derived from
  // the same painted-pixel counts (not a separately-scanned "empty bbox pixel" count) for the same
  // reason — counting bbox padding as "empty space" would make it look like there's always tons of
  // open room left even when the actual shape is fully covered, since the padding never paints.
  const totalPixels = outline.areaPixels;
  return {
    leaderId,
    selfFraction: (counts.get(selfId) ?? 0) / totalPixels,
    emptyFraction: Math.max(0, 1 - paintedPixels / totalPixels),
    /** "empty" | "self" | "leader" | "other" | "outside" the bbox entirely. */
    classify(px: number, py: number): keyof typeof AIM_SCORE {
      const lx = Math.floor(px - x);
      const ly = Math.floor(py - y);
      if (lx < 0 || ly < 0 || lx >= w || ly >= h) return "outside";
      const id = classifyIndex((ly * w + lx) * 4);
      if (id === -1) return "empty";
      if (id === selfId) return "self";
      if (id === leaderId) return "leader";
      return "other";
    },
  };
}

/** Samples several candidate aim points and picks whichever scores best against real coverage —
 * painting over the leader first, open space second, another opponent third, this bot's own
 * already-claimed paint last (see AIM_SCORE). */
function pickScoredAim(coverage: ReturnType<typeof analyzeCoverage>, cx: number, cy: number, radius: number): { x: number; y: number } {
  let best = jitterAim(cx, cy, radius);
  let bestScore = -Infinity;
  for (let i = 0; i < AIM_CANDIDATES; i++) {
    const candidate = jitterAim(cx, cy, radius);
    const score = AIM_SCORE[coverage.classify(candidate.x, candidate.y)] + Math.random() * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Drives every CPU-controlled player's input, one decision per tick, computed fresh from the
 * live session state (same information a human would be looking at). Movement is straightforward
 * seek-the-target steering; charging happens continuously while approaching (a bot arrives
 * already-charged) and releases once both "close enough" and "charged enough" agree — since a
 * release always lands paint exactly at the bot's current position, arriving in position before
 * firing is what actually lands the shot on the intended spot.
 *
 * Both WHICH outline to target and WHERE within it to aim are driven by real painted-pixel data
 * (analyzeCoverage), not guesswork: target selection avoids an outline this bot already dominates
 * and favors one someone else currently leads or that still has open space; aim selection within
 * a target prioritizes painting over the leader, then empty space, then another opponent, and
 * actively avoids this bot's own already-claimed paint (repainting it gains nothing). A dwell
 * ends the moment there's nothing productive left to aim at, not on a fixed timer. */
export class CpuController {
  private bots = new Map<number, BotState>();
  private history = new Map<number, BotHistory>();
  private lastRoundIndex: number | undefined;

  /** Call once per simulation tick, before GameSession.update() reads input — recomputes this
   * tick's decision for every active bot-controlled player. */
  update(session: GameSession, now: number): void {
    if (session.roundIndex !== this.lastRoundIndex) {
      this.lastRoundIndex = session.roundIndex;
      this.bots.clear();
      this.history.clear();
    }
    if (session.state !== "PLAYING") return; // nothing to decide outside active play
    for (const player of session.players) {
      if (!player.active || !player.isBot) continue;
      this.decide(player, session, now);
    }
  }

  getInput(playerId: number): PlayerInputState {
    return this.bots.get(playerId)?.input ?? NEUTRAL;
  }

  reset(): void {
    this.bots.clear();
    this.history.clear();
  }

  private decide(player: Player, session: GameSession, now: number): void {
    let bot = this.bots.get(player.id);
    if (!bot) {
      bot = this.pickTarget(player, session, now);
      this.bots.set(player.id, bot);
    }

    // Movement is hijacked by the Confusion power-up regardless of what we send — steering toward
    // a chosen target is pointless while it's active. Rather than wasting the whole effect doing
    // nothing, charge continuously and fire the instant the random drift happens to carry the bot
    // over any outline — opportunistic painting instead of saving a charge for a target there's no
    // way to actually walk to right now. The real target/aim state is left untouched so normal
    // seek-and-fire resumes exactly where it left off once the effect ends.
    if (now < player.confusedUntil) {
      const overOutline = session.outlines.some((o) => o.mayOverlap(player.x, player.y, player.cursorRadius));
      const maxR = currentMaxRadius(player, now);
      const chargeFrac = (player.cursorRadius - MIN_RADIUS) / (maxR - MIN_RADIUS);
      const stillCharging = overOutline && chargeFrac < 0.9;
      bot.wasCharging = stillCharging;
      bot.input = { up: false, down: false, left: false, right: false, paint: stillCharging };
      return;
    }

    if (now >= bot.retargetAt || this.targetIsGone(bot, session)) {
      bot = this.pickTarget(player, session, now);
      this.bots.set(player.id, bot);
    }

    const dx = bot.targetX - player.x;
    const dy = bot.targetY - player.y;
    const dist = Math.hypot(dx, dy);
    const arrivalRadius = player.cursorRadius + ARRIVAL_MARGIN;
    const maxR = currentMaxRadius(player, now);
    const chargeFrac = (player.cursorRadius - MIN_RADIUS) / (maxR - MIN_RADIUS);

    const charging = !(dist <= arrivalRadius && chargeFrac >= bot.fireThreshold);
    if (bot.wasCharging && !charging) {
      this.onShotFired(bot, player, session, now);
    }
    bot.wasCharging = charging;

    bot.input = {
      up: dy < -MOVE_DEADZONE,
      down: dy > MOVE_DEADZONE,
      left: dx < -MOVE_DEADZONE,
      right: dx > MOVE_DEADZONE,
      paint: charging,
    };
  }

  /** Just fired — re-read this outline's actual coverage (it just changed) and either pick a
   * fresh, still-useful aim point there or, if nothing productive is left, retarget immediately
   * instead of running out the rest of the dwell timer re-covering already-claimed ground. */
  private onShotFired(bot: BotState, player: Player, session: GameSession, now: number): void {
    if (bot.outlineIndex === undefined) {
      // Power-up — a one-off claim, not a coverage area, just re-jitter normally.
      const aim = jitterAim(bot.centerX, bot.centerY, bot.targetRadius);
      bot.targetX = aim.x;
      bot.targetY = aim.y;
      return;
    }
    const outline = session.outlines[bot.outlineIndex];
    if (!outline) return;
    const coverage = analyzeCoverage(outline, activePlayers(session.players), player.id);
    if (coverage.selfFraction >= SELF_DOMINANT_FRACTION || (coverage.emptyFraction < 0.05 && (coverage.leaderId === null || coverage.leaderId === player.id))) {
      bot.retargetAt = now; // nothing left worth aiming for here — move on right away
      return;
    }
    const aim = pickScoredAim(coverage, bot.centerX, bot.centerY, bot.targetRadius);
    bot.targetX = aim.x;
    bot.targetY = aim.y;
  }

  private historyFor(playerId: number): BotHistory {
    let h = this.history.get(playerId);
    if (!h) {
      h = { lastOutlineIndex: undefined };
      this.history.set(playerId, h);
    }
    return h;
  }

  /** A chased power-up can vanish (claimed by someone, or its own timer expiring) well before the
   * next scheduled retarget — checked every tick so a bot doesn't keep charging toward empty air. */
  private targetIsGone(bot: BotState, session: GameSession): boolean {
    if (!bot.isPowerup) return false;
    return !session.powerups.some((p) => p.state === "active" && p.cx === bot.centerX && p.cy === bot.centerY);
  }

  private pickTarget(player: Player, session: GameSession, now: number): BotState {
    const retargetAt = now + RETARGET_MIN_MS + Math.random() * (RETARGET_MAX_MS - RETARGET_MIN_MS);
    const fireThreshold = FIRE_THRESHOLD_MIN + Math.random() * (FIRE_THRESHOLD_MAX - FIRE_THRESHOLD_MIN);
    const makeState = (cx: number, cy: number, radius: number, isPowerup: boolean, outlineIndex: number | undefined, aim: { x: number; y: number }): BotState => ({
      centerX: cx,
      centerY: cy,
      targetX: aim.x,
      targetY: aim.y,
      targetRadius: radius,
      isPowerup,
      outlineIndex,
      fireThreshold,
      retargetAt,
      wasCharging: false,
      input: NEUTRAL,
    });

    const history = this.historyFor(player.id);

    const activePowerups = session.powerups.filter((p) => p.state === "active");
    if (activePowerups.length > 0 && Math.random() < POWERUP_CHASE_CHANCE) {
      let nearest = activePowerups[0]!;
      let nearestDist = Math.hypot(nearest.cx - player.x, nearest.cy - player.y);
      for (const p of activePowerups) {
        const d = Math.hypot(p.cx - player.x, p.cy - player.y);
        if (d < nearestDist) {
          nearest = p;
          nearestDist = d;
        }
      }
      if (nearestDist <= POWERUP_CHASE_MAX_DIST) {
        return makeState(nearest.cx, nearest.cy, nearest.radius, true, undefined, jitterAim(nearest.cx, nearest.cy, nearest.radius));
      }
    }

    if (session.outlines.length === 0) {
      return makeState(player.x, player.y, 0, false, undefined, { x: player.x, y: player.y });
    }

    // Excludes whichever outline this bot was just painting, so long as there's actually another
    // option — a single-outline round ("the big one") has nothing else to rotate onto.
    const pool =
      session.outlines.length > 1
        ? session.outlines.map((o, i) => ({ o, i })).filter(({ i }) => i !== history.lastOutlineIndex)
        : session.outlines.map((o, i) => ({ o, i }));

    let best = pool[0]!;
    let bestScore = Infinity;
    let bestCoverage: ReturnType<typeof analyzeCoverage> | undefined;
    for (const { o, i } of pool) {
      const dist = Math.hypot(o.cx - player.x, o.cy - player.y);
      // Small stable per-bot bias so multiple bots don't all rank outlines identically and pile
      // onto whichever's nearest to the group as a whole.
      const bias = ((player.id * 37 + i * 17) % 100) * 2.5;
      const coverage = analyzeCoverage(o, activePlayers(session.players), player.id);
      const contestBonus = coverage.leaderId !== null && coverage.leaderId !== player.id ? CONTEST_LEADER_BONUS : 0;
      const openSpaceBonus = coverage.emptyFraction * OPEN_SPACE_BONUS_SCALE;
      const dominancePenalty = coverage.selfFraction >= SELF_DOMINANT_FRACTION ? ALREADY_DOMINANT_PENALTY : 0;
      const score = dist + bias - contestBonus - openSpaceBonus + dominancePenalty;
      if (score < bestScore) {
        bestScore = score;
        best = { o, i };
        bestCoverage = coverage;
      }
    }
    history.lastOutlineIndex = best.i;
    // boundingRadius, not the raw `radius` field — a rectangle-kind outline (the single-shape
    // "big one" round) sizes itself from width/height and has radius: 0.
    const radius = best.o.boundingRadius;
    const aim = bestCoverage ? pickScoredAim(bestCoverage, best.o.cx, best.o.cy, radius) : jitterAim(best.o.cx, best.o.cy, radius);
    return makeState(best.o.cx, best.o.cy, radius, false, best.i, aim);
  }
}
