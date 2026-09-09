import type { GameSession } from "./GameSession.ts";
import type { PlayerInputState } from "./Input.ts";
import { activePlayers, currentMaxRadius, isMachineGunActive, type Player } from "./Player.ts";
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
const AIM_CANDIDATES = 20;
// Coverage-based scoring for a candidate aim point: painting over the current leader's color is
// explicitly the top priority (contesting whoever's actually winning), open/unpainted space is
// second, another (non-leading) opponent's paint is third, and this bot's OWN already-claimed
// paint is actively avoided — repainting it gains nothing.
const AIM_SCORE = { leader: 3, empty: 2, other: 1, self: -3, outside: -5 } as const;
// Once this bot's own share of an outline's painted area reaches this fraction (of the outline's
// bounding box — a relative, consistent-enough proxy, not exact shape-area accounting), treat it
// as "already won, nothing left worth gaining here" for target SELECTION purposes.
const SELF_DOMINANT_FRACTION = 0.8;
// Selection-time bonuses (score is minimized — see pickTarget), both large enough relative to a
// typical inter-outline distance (a few hundred px) to actually override "just go to whichever
// shape is nearest" rather than being a minor tiebreaker. Contesting an outline someone ELSE
// currently leads scales with how much of it they've actually claimed — a leader sitting on 90%
// of a shape is a far more urgent target than one who's barely ahead by a few pixels — on top of a
// flat base so even a slim lead is still worth going after. Open space gets its own, separately
// meaningful bonus so a totally untouched outline competes for attention too, not just contested
// ones.
const CONTEST_LEADER_BASE_BONUS = 260;
const CONTEST_LEADER_DOMINANCE_SCALE = 500;
const OPEN_SPACE_BONUS_SCALE = 400;
const ALREADY_DOMINANT_PENALTY = 6000;
// The Machine Gun power-up auto-fires every ~60ms at wherever the player currently is (see
// GameSession.updatePlaying) and pins cursorRadius at MIN_RADIUS the whole time, completely
// bypassing the normal hold-to-charge/release-to-fire input this class relies on everywhere else
// to know when a shot has landed — the charge-fraction "am I charged enough" check can never pass
// with cursorRadius stuck at its minimum, so the usual "just fired, recompute aim" trigger never
// fires under machine gun. Landing shots that fast, target refresh instead runs on its own short
// timer so a spraying bot keeps sweeping across real ground (and can bail out of an already-full
// outline) instead of converging on one point and parking there for the whole power-up duration.
const MACHINEGUN_REFRESH_MS = 350;
// Minimum charge fraction the Confusion power-up's opportunistic fire (see decide()) will settle
// for — without a floor here, a bot whose random drift carries it off an outline moments after
// starting to charge would release immediately, landing a nearly-worthless sliver of a splat.
const CONFUSION_MIN_FIRE_FRAC = 0.5;

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
  /** Next time a machine-gunning bot should re-evaluate its aim — see MACHINEGUN_REFRESH_MS. */
  mgNextRefreshAt: number;
  fireThreshold: number;
  retargetAt: number;
  wasCharging: boolean;
  input: PlayerInputState;
}

interface BotHistory {
  lastOutlineIndex: number | undefined;
}

/** A shot that's already committed to land at (x, y) but hasn't actually painted yet — either a
 * real in-flight Projectile (GameSession.projectiles, still ~0-380ms from landing) or, for the one
 * shot analyzeCoverage can never find there in time (see refreshTarget), a synthesized stand-in for
 * the release this tick's own decide() call just triggered. */
interface PendingSplat {
  ownerId: number;
  x: number;
  y: number;
  radius: number;
}

/** A random point within AIM_JITTER_FRACTION of `radius` from (cx, cy), uniformly distributed
 * over the disc's AREA — not over its radius. Sampling distance directly from Math.random() (the
 * original approach here) puts far more points near the center than out toward the edge: the ring
 * between r and r+dr covers area proportional to r, so an r sampled uniformly in [0, max]
 * oversamples small r relative to the area it actually represents. Over many candidates that bias
 * compounds into every bot's aim quietly drifting toward the shape's center — which is very likely
 * why bots kept clustering and "fighting" right in the middle of large outlines (most visibly
 * "the big one" round's giant single rectangle, since there's nowhere else to go to escape it)
 * despite huge amounts of untouched space nearer the edges. sqrt(random) is the standard fix: it's
 * the inverse CDF for a uniform-over-disc-area distribution. */
function jitterAim(cx: number, cy: number, radius: number): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  const dist = radius * AIM_JITTER_FRACTION * Math.sqrt(Math.random());
  return { x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist };
}

// How many times to resample before giving up and falling back to the outline's own authored
// center — see jitterAimInside.
const MAX_INSIDE_AIM_ATTEMPTS = 20;

/** Same distribution as jitterAim, but rejection-sampled against the outline's REAL shape
 * (Outline.containsPoint), not just its bounding circle. For a simple, roughly-convex shape
 * (circle, rectangle, star) the bounding circle IS close to the real shape and this almost always
 * succeeds on the first try. For a thin or irregular silhouette (the Eiffel Tower's narrow
 * lattice, the Statue of Liberty's slender figure) most of the bounding circle is real empty air
 * the shape doesn't occupy at all — without this, a bot can walk to and fire at a perfectly
 * reasonable-looking jittered point that's nowhere near paintable ground, landing zero visible
 * paint (paintSplat clips everything to the real path) — a complete miss. */
function jitterAimInside(outline: Outline, cx: number, cy: number, radius: number): { x: number; y: number } {
  for (let i = 0; i < MAX_INSIDE_AIM_ATTEMPTS; i++) {
    const candidate = jitterAim(cx, cy, radius);
    if (outline.containsPoint(candidate.x, candidate.y)) return candidate;
  }
  // Every jittered attempt missed the real shape (rare, but for an extremely thin silhouette — the
  // real Eiffel Tower artwork occupies well under 10% of its own bounding box — not negligible
  // even at MAX_INSIDE_AIM_ATTEMPTS tries). outline.fallbackPoint is precomputed and GUARANTEED to
  // satisfy containsPoint(), unlike another unguarded jitterAim call (or the shape's own authored
  // center, which for a non-convex silhouette isn't actually guaranteed to be on it) would be.
  return outline.fallbackPoint;
}

/** One pass over an outline's actual painted pixels — who's covered what, right now — PLUS any
 * `pending` shots already committed to land there but not yet actually painted (see PendingSplat):
 * without this, a bot re-reading coverage the instant after releasing its own shot sees the exact
 * same "still empty" picture it saw right before firing (paint only actually lands in
 * GameSession.landProjectile, ~PROJECTILE_DURATION_MS later) and can decide there's still plenty
 * of unclaimed room left, walk back, and fire a second, redundant shot at essentially the same spot
 * before the first one has even hit the canvas. Pending shots are folded in as a sparse overlay —
 * pixel -> claiming ownerId, as if already landed — so both the aggregate fractions below AND
 * classify() (used for per-candidate aim scoring) agree with each other. Real (if approximate —
 * bounding-box-relative, same convention scoring.ts already uses) coverage data, not a guess from
 * memory of past shots. Expensive-ish (a full getImageData + per-pixel nearest-color match, same
 * approach scoring.ts's scoreOutline uses for real scoring) so this is only called once per target
 * pick / once per shot fired, never every tick. */
function analyzeCoverage(outline: Outline, players: Player[], selfId: number, pending: PendingSplat[] = []) {
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

  const overlay = new Map<number, number>();
  for (const proj of pending) {
    const localCx = proj.x - x;
    const localCy = proj.y - y;
    const r = proj.radius;
    const minLx = Math.max(0, Math.floor(localCx - r));
    const maxLx = Math.min(w - 1, Math.ceil(localCx + r));
    const minLy = Math.max(0, Math.floor(localCy - r));
    const maxLy = Math.min(h - 1, Math.ceil(localCy + r));
    for (let ly = minLy; ly <= maxLy; ly++) {
      for (let lx = minLx; lx <= maxLx; lx++) {
        const dx = lx - localCx;
        const dy = ly - localCy;
        if (dx * dx + dy * dy > r * r) continue;
        const pixelIdx = ly * w + lx;
        // Pending shots only actually claim ground the real shape covers — paintSplat() clips
        // everything else away, so crediting a shot for the part of its circular footprint that
        // falls on real empty air (very possible for a thin/irregular silhouette) would make a
        // splat that's mostly a miss look like real progress it never actually made.
        if (outline.shapeMask[pixelIdx] !== 1) continue;
        const priorId = overlay.get(pixelIdx) ?? classifyIndex(pixelIdx * 4);
        if (priorId === proj.ownerId) continue;
        if (priorId !== -1) counts.set(priorId, (counts.get(priorId) ?? 0) - 1);
        counts.set(proj.ownerId, (counts.get(proj.ownerId) ?? 0) + 1);
        overlay.set(pixelIdx, proj.ownerId);
      }
    }
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
    leaderFraction: leaderCount / totalPixels,
    selfFraction: (counts.get(selfId) ?? 0) / totalPixels,
    emptyFraction: Math.max(0, 1 - paintedPixels / totalPixels),
    /** "empty" | "self" | "leader" | "other" | "outside" the bbox entirely. */
    classify(px: number, py: number): keyof typeof AIM_SCORE {
      const lx = Math.floor(px - x);
      const ly = Math.floor(py - y);
      if (lx < 0 || ly < 0 || lx >= w || ly >= h) return "outside";
      const pixelIdx = ly * w + lx;
      const id = overlay.get(pixelIdx) ?? classifyIndex(pixelIdx * 4);
      if (id === -1) return "empty";
      if (id === selfId) return "self";
      if (id === leaderId) return "leader";
      return "other";
    },
  };
}

/** Samples several candidate aim points and picks whichever scores best against real coverage —
 * painting over the leader first, open space second, another opponent third, this bot's own
 * already-claimed paint last (see AIM_SCORE). Every candidate is rejection-sampled against the
 * outline's real shape (jitterAimInside), not just its bounding circle, so a thin or irregular
 * silhouette can't end up scoring and picking a point that would actually land zero paint. */
function pickScoredAim(outline: Outline, coverage: ReturnType<typeof analyzeCoverage>, cx: number, cy: number, radius: number): { x: number; y: number } {
  let best = jitterAimInside(outline, cx, cy, radius);
  let bestScore = -Infinity;
  for (let i = 0; i < AIM_CANDIDATES; i++) {
    const candidate = jitterAimInside(outline, cx, cy, radius);
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
    // nothing, charge continuously and fire once the random drift happens to have the bot over an
    // outline WITH a reasonably charged shot ready — opportunistic painting instead of saving a
    // charge for a target there's no way to actually walk to right now. Firing the instant drift
    // carries it off an outline, whatever the charge level, used to mean a bot that started
    // charging a moment ago could release a nearly-worthless sliver of a splat — holding at (or
    // near) full charge costs nothing, so it's always worth waiting for CONFUSION_MIN_FIRE_FRAC
    // before releasing, even if that means sitting off-outline fully charged until drift brings it
    // back over one. The real target/aim state is left untouched so normal seek-and-fire resumes
    // exactly where it left off once the effect ends.
    if (now < player.confusedUntil) {
      const overOutline = session.outlines.some((o) => o.mayOverlap(player.x, player.y, player.cursorRadius));
      const maxR = currentMaxRadius(player, now);
      const chargeFrac = (player.cursorRadius - MIN_RADIUS) / (maxR - MIN_RADIUS);
      const readyToFire = overOutline && chargeFrac >= CONFUSION_MIN_FIRE_FRAC;
      bot.wasCharging = !readyToFire;
      bot.input = { up: false, down: false, left: false, right: false, paint: !readyToFire };
      return;
    }

    if (now >= bot.retargetAt || this.targetIsGone(bot, session)) {
      bot = this.pickTarget(player, session, now);
      this.bots.set(player.id, bot);
    }

    // Machine Gun auto-fires every ~60ms wherever the player currently is and pins cursorRadius
    // at MIN_RADIUS the whole time (see GameSession.updatePlaying) — the charge/release detection
    // just below can never trigger with radius stuck at its floor, so a spraying bot would
    // otherwise walk to its first aim point, "arrive," and then just sit there landing dozens of
    // shots on the same spot for the entire power-up duration. Refresh on a short timer instead.
    if (isMachineGunActive(player, now)) {
      if (now >= bot.mgNextRefreshAt) {
        this.refreshTarget(bot, player, session, now);
        bot.mgNextRefreshAt = now + MACHINEGUN_REFRESH_MS;
      }
      const mgDx = bot.targetX - player.x;
      const mgDy = bot.targetY - player.y;
      bot.wasCharging = true;
      bot.input = {
        up: mgDy < -MOVE_DEADZONE,
        down: mgDy > MOVE_DEADZONE,
        left: mgDx < -MOVE_DEADZONE,
        right: mgDx > MOVE_DEADZONE,
        paint: true, // irrelevant to actual firing while active, kept true for a clean resume after
      };
      return;
    }

    const dx = bot.targetX - player.x;
    const dy = bot.targetY - player.y;
    const dist = Math.hypot(dx, dy);
    const arrivalRadius = player.cursorRadius + ARRIVAL_MARGIN;
    const maxR = currentMaxRadius(player, now);
    const chargeFrac = (player.cursorRadius - MIN_RADIUS) / (maxR - MIN_RADIUS);

    // arrivalRadius grows with the shot's own charge, so "close enough" can mean tens of pixels
    // away from the exact aim point by the time it's fully charged — harmless for a shape that
    // fills its own bounding circle, but for a thin or irregular silhouette (the Eiffel Tower, the
    // Statue of Liberty) that much slop is enough to have drifted off the real shape entirely even
    // though the aim point itself (picked via jitterAimInside/pickScoredAim) was verified on it.
    // Firing from there would land zero visible paint — a "complete miss" — despite every upstream
    // check having been correct. Require the shot to actually touch real shape ground before
    // releasing — overlapsShape, NOT containsPoint: demanding the exact center pixel land on-shape
    // (containsPoint) is too strict once MOVE_DEADZONE stops the bot a few px short of the precise
    // aim point on something this thin, and was leaving bots stuck fully charged forever, never
    // satisfying it, until the retarget timeout gave up and walked them away without ever firing.
    const outline = bot.outlineIndex !== undefined ? session.outlines[bot.outlineIndex] : undefined;
    const onTarget = !outline || outline.overlapsShape(player.x, player.y, player.cursorRadius);
    const charging = !(dist <= arrivalRadius && chargeFrac >= bot.fireThreshold && onTarget);
    if (bot.wasCharging && !charging) {
      // This tick's release fires the projectile inside session.update(), which runs AFTER
      // CpuController.update() (see hostLoop.ts) — so it doesn't exist in session.projectiles yet
      // at this exact instant. Hand refreshTarget a synthesized stand-in for it so the coverage
      // read right after firing isn't blind to the shot that's about to land.
      this.refreshTarget(bot, player, session, now, { ownerId: player.id, x: player.x, y: player.y, radius: player.cursorRadius });
    }
    bot.wasCharging = charging;

    // GameSession.updatePlaying applies this tick's movement BEFORE checking whether a release
    // should fire — so on the exact tick a shot releases, still sending movement input would let
    // the player drift a pixel or two past the position `onTarget` just verified, between the
    // check above and the actual fire. Harmless for a normal shape (a pixel of drift is still
    // deep inside it) but enough to occasionally miss a razor-thin silhouette (the Eiffel Tower's
    // legs). Suppressing movement on the firing tick makes the fired position exactly the one
    // just validated — there's no benefit to squeezing in one more step of movement anyway, since
    // `charging` going false already means "close enough, aimed, and standing on real ground."
    const moving = charging;
    bot.input = {
      up: moving && dy < -MOVE_DEADZONE,
      down: moving && dy > MOVE_DEADZONE,
      left: moving && dx < -MOVE_DEADZONE,
      right: moving && dx > MOVE_DEADZONE,
      paint: charging,
    };
  }

  /** A shot just landed (a normal release, or a periodic check-in while machine-gunning — see
   * MACHINEGUN_REFRESH_MS) — re-read this outline's actual coverage (it just changed, or is about
   * to — see `justFired`) and either pick a fresh, still-useful aim point there or, if nothing
   * productive is left, retarget immediately instead of running out the rest of the dwell
   * re-covering already-claimed ground. */
  private refreshTarget(bot: BotState, player: Player, session: GameSession, now: number, justFired?: PendingSplat): void {
    if (bot.outlineIndex === undefined) {
      // Power-up — a one-off claim, not a coverage area, just re-jitter normally.
      const aim = jitterAim(bot.centerX, bot.centerY, bot.targetRadius);
      bot.targetX = aim.x;
      bot.targetY = aim.y;
      return;
    }
    const outline = session.outlines[bot.outlineIndex];
    if (!outline) return;
    const coverage = analyzeCoverage(outline, activePlayers(session.players), player.id, this.pendingSplatsFor(outline, session, justFired));
    if (coverage.selfFraction >= SELF_DOMINANT_FRACTION || (coverage.emptyFraction < 0.05 && (coverage.leaderId === null || coverage.leaderId === player.id))) {
      bot.retargetAt = now; // nothing left worth aiming for here — move on right away
      return;
    }
    const aim = pickScoredAim(outline, coverage, bot.centerX, bot.centerY, bot.targetRadius);
    bot.targetX = aim.x;
    bot.targetY = aim.y;
  }

  /** Every shot that's already committed to land on `outline` but hasn't actually painted there
   * yet — real in-flight projectiles (any owner: an opponent's shot en route matters just as much
   * as this bot's own for "is this spot actually still worth aiming at") plus, when supplied, one
   * synthesized stand-in for a release this exact tick hasn't pushed into session.projectiles yet. */
  private pendingSplatsFor(outline: Outline, session: GameSession, extra?: PendingSplat): PendingSplat[] {
    const pending: PendingSplat[] = session.projectiles
      .filter((p) => outline.mayOverlap(p.x, p.y, p.radius))
      .map((p) => ({ ownerId: p.ownerId, x: p.x, y: p.y, radius: p.radius }));
    if (extra) pending.push(extra);
    return pending;
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
      mgNextRefreshAt: now,
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
      const coverage = analyzeCoverage(o, activePlayers(session.players), player.id, this.pendingSplatsFor(o, session));
      const contestBonus =
        coverage.leaderId !== null && coverage.leaderId !== player.id
          ? CONTEST_LEADER_BASE_BONUS + coverage.leaderFraction * CONTEST_LEADER_DOMINANCE_SCALE
          : 0;
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
    const aim = bestCoverage ? pickScoredAim(best.o, bestCoverage, best.o.cx, best.o.cy, radius) : jitterAimInside(best.o, best.o.cx, best.o.cy, radius);
    return makeState(best.o.cx, best.o.cy, radius, false, best.i, aim);
  }
}
