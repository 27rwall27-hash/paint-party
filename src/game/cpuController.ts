import type { GameSession } from "./GameSession.ts";
import type { PlayerInputState } from "./Input.ts";
import { currentMaxRadius, type Player } from "./Player.ts";
import { MIN_RADIUS } from "./constants.ts";

// Retargeting cadence — a bot sticks with one target for a while instead of flickering between
// shapes every frame, which is both more human-looking and cheaper (target selection scans every
// outline/powerup, no need to redo that 30x/second). Randomized per pick so multiple bots don't
// all reconsider in lockstep.
const RETARGET_MIN_MS = 2200;
const RETARGET_MAX_MS = 4200;
// How much closer than "touching" a bot tries to get before it's considered close enough to fire
// — firing always lands exactly at the bot's own current position (same as a human release), so
// this has to be small enough that the shot actually lands on the target, not near it.
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
// radius — without this, every shot for the whole target-dwell period (and every future dwell on
// the same outline) lands on the exact same pixel, since aiming was just "the outline's center."
const AIM_JITTER_FRACTION = 0.65;

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
  targetRadius: number;
  isPowerup: boolean;
  fireThreshold: number;
  retargetAt: number;
  wasCharging: boolean;
  input: PlayerInputState;
}

/** A random point within AIM_JITTER_FRACTION of `radius` from (cx, cy) — small radius (a
 * power-up) gets a tight jitter, a big outline gets real spread across its surface. */
function jitterAim(cx: number, cy: number, radius: number): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * radius * AIM_JITTER_FRACTION;
  return { x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist };
}

/** Drives every CPU-controlled player's input, one decision per tick, computed fresh from the
 * live session state (same information a human would be looking at). Movement is straightforward
 * seek-the-target steering; charging happens continuously while approaching (a bot arrives
 * already-charged, same as a human who holds paint while walking in) and releases once both
 * "close enough" and "charged enough" agree — since a release always lands paint exactly at the
 * bot's current position, not thrown toward a distant point, arriving in position before firing
 * is what actually lands the shot on the target instead of wherever the bot happened to be. */
export class CpuController {
  private bots = new Map<number, BotState>();
  private lastRoundIndex: number | undefined;

  /** Call once per simulation tick, before GameSession.update() reads input — recomputes this
   * tick's decision for every active bot-controlled player. */
  update(session: GameSession, now: number): void {
    // A new round means a whole new outline layout — a target cached from the previous round
    // could easily be stale (empty space with nothing left to walk to) for as long as
    // RETARGET_MAX_MS otherwise. Cleared here rather than relying on the caller to notice a round
    // changed, so nothing has to wire that up separately for local vs. host.
    if (session.roundIndex !== this.lastRoundIndex) {
      this.lastRoundIndex = session.roundIndex;
      this.bots.clear();
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
    const arrivalRadius = bot.targetRadius + player.cursorRadius + ARRIVAL_MARGIN;
    const maxR = currentMaxRadius(player, now);
    const chargeFrac = (player.cursorRadius - MIN_RADIUS) / (maxR - MIN_RADIUS);

    const charging = !(dist <= arrivalRadius && chargeFrac >= bot.fireThreshold);
    // Release edge (was charging, now firing) — pick a fresh aim point near the same target's
    // center for the NEXT approach, so a bot painting the same outline for a while spreads its
    // shots across it instead of stacking every single one on the exact center pixel.
    if (bot.wasCharging && !charging) {
      const aim = jitterAim(bot.centerX, bot.centerY, bot.targetRadius);
      bot.targetX = aim.x;
      bot.targetY = aim.y;
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

  /** A chased power-up can vanish (claimed by someone, or its own timer expiring) well before the
   * next scheduled retarget — checked every tick so a bot doesn't keep charging toward empty air. */
  private targetIsGone(bot: BotState, session: GameSession): boolean {
    if (!bot.isPowerup) return false;
    return !session.powerups.some((p) => p.state === "active" && p.cx === bot.centerX && p.cy === bot.centerY);
  }

  private pickTarget(player: Player, session: GameSession, now: number): BotState {
    const retargetAt = now + RETARGET_MIN_MS + Math.random() * (RETARGET_MAX_MS - RETARGET_MIN_MS);
    const fireThreshold = FIRE_THRESHOLD_MIN + Math.random() * (FIRE_THRESHOLD_MAX - FIRE_THRESHOLD_MIN);
    const makeState = (cx: number, cy: number, radius: number, isPowerup: boolean): BotState => {
      const aim = jitterAim(cx, cy, radius);
      return {
        centerX: cx,
        centerY: cy,
        targetX: aim.x,
        targetY: aim.y,
        targetRadius: radius,
        isPowerup,
        fireThreshold,
        retargetAt,
        wasCharging: false,
        input: NEUTRAL,
      };
    };

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
        return makeState(nearest.cx, nearest.cy, nearest.radius, true);
      }
    }

    if (session.outlines.length === 0) {
      return makeState(player.x, player.y, 0, false);
    }
    // Nearest outline wins most of the time, but each bot has its own small stable bias per
    // outline (deterministic from playerId+index, not re-rolled every pick) so multiple bots
    // spread across different shapes instead of all beelining for the exact same one.
    let best = session.outlines[0]!;
    let bestScore = Infinity;
    session.outlines.forEach((o, i) => {
      const dist = Math.hypot(o.cx - player.x, o.cy - player.y);
      const bias = ((player.id * 37 + i * 17) % 100) * 2.5;
      const score = dist + bias;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    });
    return makeState(best.cx, best.cy, best.radius, false);
  }
}
