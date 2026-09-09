import type { GameSession } from "./GameSession.ts";
import type { PlayerInputState } from "./Input.ts";
import { currentMaxRadius, type Player } from "./Player.ts";
import { MIN_RADIUS } from "./constants.ts";

// Retargeting cadence — a bot sticks with one target for a while instead of flickering between
// shapes every frame, which is both more human-looking and cheaper (target selection scans every
// outline/powerup, no need to redo that 30x/second). Randomized per pick so multiple bots don't
// all reconsider in lockstep. This is the OUTER cap on a dwell — pickSpacedAim below usually cuts
// a dwell short well before this fires, once there's nowhere fresh left to paint.
const RETARGET_MIN_MS = 1800;
const RETARGET_MAX_MS = 3500;
// How much closer than "touching" a bot tries to get before it's considered close enough to fire
// — deliberately measured against the player's own charge radius only, NOT the target's size, so
// a bot genuinely walks to its specific (jittered) aim point before releasing. Including the
// target's radius here used to let a bot fire the instant it entered the outline's general
// vicinity, from wherever its approach path happened to be — which meant every shot landed near
// the same handful of entry points instead of actually reaching the varied spot it was aiming for.
const ARRIVAL_MARGIN = 6;
// Fraction of full charge a bot's radius needs to reach before it's "worth" releasing once in
// range, randomized per target pick for variety — always charging to 100% would read as
// suspiciously optimal, always releasing at the minimum would read as weak/twitchy.
const FIRE_THRESHOLD_MIN = 0.55;
const FIRE_THRESHOLD_MAX = 0.95;
// Below this many px of difference, stop nudging that axis — without a deadzone a bot sitting
// almost exactly on its target would flicker its held direction every frame as it overshoots by a
// pixel and corrects back, which reads as jittery instead of settled.
const MOVE_DEADZONE = 8;
// Odds a retarget prefers a nearby unclaimed power-up over the next outline — never so high that
// bots ignore the actual objective, just enough that they visibly go out of their way sometimes.
const POWERUP_CHASE_CHANCE = 0.45;
const POWERUP_CHASE_MAX_DIST = 420;
// How far a per-shot aim point can land from the target's true center, as a fraction of its
// (effective) radius.
const AIM_JITTER_FRACTION = 0.8;
// A candidate aim point must land at least this fraction of the target's radius away from every
// spot this bot has already painted there (ever, not just this dwell — its own old paint doesn't
// go away) to count as "fresh." Re-painting your own already-claimed pixels doesn't gain any
// coverage — this is what makes a bot actually spread across an outline's full area instead of
// re-hitting a handful of the same spots for its whole dwell.
const MIN_SPACING_FRACTION = 0.45;
const SPACING_ATTEMPTS = 20;
// Cost added to an outline's selection score per shot this bot has already landed there this
// round — the other lever for "spread across every section instead of camping one": without it,
// the nearest outline (plus each bot's small fixed distance bias) wins every retarget forever,
// since nothing about that ranking ever changes as the round goes on.
const COVERAGE_PENALTY_PER_SHOT = 220;

const NEUTRAL: PlayerInputState = { up: false, down: false, left: false, right: false, paint: false };

interface BotState {
  /** The target's true center — outline or power-up midpoint. Aiming jitters around this, but
   * this itself only changes on a real retarget. */
  centerX: number;
  centerY: number;
  /** Where this particular approach/shot is actually aiming — a jittered point near centerX/Y,
   * re-rolled every time a shot fires (see the release-edge check in decide()) so consecutive
   * shots at the same outline land in different spots instead of stacking on one pixel. */
  targetX: number;
  targetY: number;
  /** The target's own effective size — an outline's `boundingRadius` (NOT its raw `.radius`,
   * which for a rectangle-kind outline like "the big one" round is 0 and would collapse aiming to
   * a single point) or a power-up's plain `.radius`. */
  targetRadius: number;
  isPowerup: boolean;
  /** Which outline index this target is (undefined for a power-up) — tracked so a fired shot can
   * be credited to the right per-bot coverage counter. */
  outlineIndex: number | undefined;
  fireThreshold: number;
  retargetAt: number;
  wasCharging: boolean;
  input: PlayerInputState;
}

/** Persists across retargets (unlike BotState, which gets replaced wholesale each time) — what
 * this bot has already been doing this round, so target SELECTION can actually improve on "always
 * pick the nearest thing again," and so it never re-aims at a spot it's already painted itself. */
interface BotHistory {
  lastOutlineIndex: number | undefined;
  shotsByOutline: Map<number, number>;
  /** Every point (per outline) this bot has actually fired from — its own claimed coverage. */
  paintedSpots: Map<number, Array<{ x: number; y: number }>>;
}

/** A random point within AIM_JITTER_FRACTION of `radius` from (cx, cy). */
function jitterAim(cx: number, cy: number, radius: number): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * radius * AIM_JITTER_FRACTION;
  return { x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist };
}

/** Like jitterAim, but rejection-samples against `painted` (this bot's own prior shots at this
 * same target) so it doesn't keep re-aiming at spots it's already covered — small radius (a
 * power-up) gets a tight jitter and no spacing concerns (it's a one-off claim, not a coverage
 * area), a big outline gets real spread that actively avoids overlapping its own earlier paint.
 * `full` comes back true when even the LEAST-overlapping candidate tried still wasn't spaced out
 * enough — the signal that this target has nothing fresh left worth painting right now. */
function pickFreshAim(cx: number, cy: number, radius: number, painted: Array<{ x: number; y: number }>): { point: { x: number; y: number }; full: boolean } {
  if (painted.length === 0) return { point: jitterAim(cx, cy, radius), full: false };
  const minSpacing = radius * MIN_SPACING_FRACTION;
  let best = jitterAim(cx, cy, radius);
  let bestMinDist = -1;
  for (let i = 0; i < SPACING_ATTEMPTS; i++) {
    const candidate = jitterAim(cx, cy, radius);
    let minDist = Infinity;
    for (const p of painted) {
      const d = Math.hypot(candidate.x - p.x, candidate.y - p.y);
      if (d < minDist) minDist = d;
    }
    if (minDist >= minSpacing) return { point: candidate, full: false };
    if (minDist > bestMinDist) {
      bestMinDist = minDist;
      best = candidate;
    }
  }
  return { point: best, full: true };
}

/** Drives every CPU-controlled player's input, one decision per tick, computed fresh from the
 * live session state (same information a human would be looking at). Movement is straightforward
 * seek-the-target steering; charging happens continuously while approaching (a bot arrives
 * already-charged, same as a human who holds paint while walking in) and releases once both
 * "close enough" and "charged enough" agree — since a release always lands paint exactly at the
 * bot's current position, not thrown toward a distant point, arriving in position before firing
 * is what actually lands the shot on the target instead of wherever the bot happened to be.
 *
 * Target SELECTION deliberately isn't pure nearest-shape: it actively avoids re-picking the
 * outline it was just painting (unless it's the only one, e.g. the single-outline "big one"
 * round) and prefers whichever outline it's painted the least so far this round. AIM within a
 * target is spaced out against the bot's own prior shots there (pickFreshAim) — repainting your
 * own already-claimed pixels doesn't add any coverage, so once a target has no fresh room left,
 * the bot retargets immediately instead of running out the rest of its dwell timer re-hitting the
 * same handful of spots. Both together are what actually stops a bot from "camping" a section: it
 * isn't a fixed timer keeping it there, it's genuinely having useful area left to paint. */
export class CpuController {
  private bots = new Map<number, BotState>();
  private history = new Map<number, BotHistory>();
  private lastRoundIndex: number | undefined;

  /** Call once per simulation tick, before GameSession.update() reads input — recomputes this
   * tick's decision for every active bot-controlled player. */
  update(session: GameSession, now: number): void {
    // A new round means a whole new outline layout — a target cached from the previous round
    // could easily be stale (empty space with nothing left to walk to) for as long as
    // RETARGET_MAX_MS otherwise, and last round's coverage history no longer means anything.
    // Cleared here rather than relying on the caller to notice a round changed, so nothing has to
    // wire that up separately for local vs. host.
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

  /** The input CompositeInputSource should feed a bot-controlled slot this tick. Neutral (no
   * movement/charge) for anything not currently PLAYING or not actually a bot. */
  getInput(playerId: number): PlayerInputState {
    return this.bots.get(playerId)?.input ?? NEUTRAL;
  }

  reset(): void {
    this.bots.clear();
    this.history.clear();
  }

  private decide(player: Player, session: GameSession, now: number): void {
    let bot = this.bots.get(player.id);
    if (!bot || now >= bot.retargetAt || this.targetIsGone(bot, session)) {
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
    // Release edge (was charging, now firing) — credit this shot to the outline it landed on and
    // remember exactly where, then pick a fresh (unpainted-by-me) aim point for the next approach.
    if (bot.wasCharging && !charging) {
      if (bot.outlineIndex !== undefined) {
        const h = this.historyFor(player.id);
        h.shotsByOutline.set(bot.outlineIndex, (h.shotsByOutline.get(bot.outlineIndex) ?? 0) + 1);
        const spots = h.paintedSpots.get(bot.outlineIndex) ?? [];
        spots.push({ x: player.x, y: player.y });
        h.paintedSpots.set(bot.outlineIndex, spots);

        const { point, full } = pickFreshAim(bot.centerX, bot.centerY, bot.targetRadius, spots);
        bot.targetX = point.x;
        bot.targetY = point.y;
        // Nowhere fresh left worth painting here — leave now rather than spending the rest of
        // this dwell re-hitting spots that are already this bot's own color.
        if (full) bot.retargetAt = now;
      } else {
        // Power-ups are a one-off claim, not a coverage area — no spacing memory needed.
        const aim = jitterAim(bot.centerX, bot.centerY, bot.targetRadius);
        bot.targetX = aim.x;
        bot.targetY = aim.y;
      }
    }
    bot.wasCharging = charging;

    bot.input = {
      up: dy < -MOVE_DEADZONE,
      down: dy > MOVE_DEADZONE,
      left: dx < -MOVE_DEADZONE,
      right: dx > MOVE_DEADZONE,
      // Charge continuously on the way in; release the instant both requirements are met. This
      // naturally repeats (recharge, refire) at a fresh nearby spot for as long as the target lasts.
      paint: charging,
    };
  }

  private historyFor(playerId: number): BotHistory {
    let h = this.history.get(playerId);
    if (!h) {
      h = { lastOutlineIndex: undefined, shotsByOutline: new Map(), paintedSpots: new Map() };
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
    for (const { o, i } of pool) {
      const dist = Math.hypot(o.cx - player.x, o.cy - player.y);
      // Small stable per-bot bias so multiple bots don't all rank outlines identically and pile
      // onto whichever's nearest to the group as a whole; the coverage penalty below is what
      // actually drives "spread across every section," this is just tie-breaking variety.
      const bias = ((player.id * 37 + i * 17) % 100) * 2.5;
      const shotsHere = history.shotsByOutline.get(i) ?? 0;
      const score = dist + bias + shotsHere * COVERAGE_PENALTY_PER_SHOT;
      if (score < bestScore) {
        bestScore = score;
        best = { o, i };
      }
    }
    history.lastOutlineIndex = best.i;
    // boundingRadius, not the raw `radius` field — a rectangle-kind outline (the single-shape
    // "big one" round) sizes itself from width/height and has radius: 0, which would collapse
    // aiming to one exact point and make the whole outline nearly unreachable to "arrive" at.
    const radius = best.o.boundingRadius;
    const { point } = pickFreshAim(best.o.cx, best.o.cy, radius, history.paintedSpots.get(best.i) ?? []);
    return makeState(best.o.cx, best.o.cy, radius, false, best.i, point);
  }
}
