// Battle Royale mode: 24 racers (1 human + 23 CPU) split into 3 fixed sections of 8 from the very
// start. All 3 sections share the exact same hurdle timing (see spawnBrObstacle) — it's the same
// wave hitting everyone at once, everywhere. One failed jump eliminates a racer permanently; there
// is no reordering, ever — `section`/`slot` are assigned once at game start and never change.
// Every BR_CHECKPOINT_EVERY_ELIMINATIONS cumulative eliminations, the game pauses for a beat, then
// resumes measurably faster. Ends the instant exactly one racer remains.

import {
  BR_CHECKPOINT_EVERY_ELIMINATIONS,
  BR_CHECKPOINT_PAUSE_MS,
  BR_CHECKPOINT_SPEED_STEP_PCT,
  BR_COLUMN_GAP_BASE_MS,
  BR_COLUMN_GAP_FLOOR_MS,
  BR_CPU_SKILL_JITTER,
  BR_CPU_SKILL_MIN,
  BR_CPU_SKILL_MAX,
  BR_JUMP_RANK_EQUIVALENT,
  BR_LEAD_IN_BASE_MS,
  BR_LEAD_IN_FLOOR_MS,
  BR_SLOTS_PER_SECTION,
  BR_SPAWN_GAP_BASE_MS,
  BR_SPAWN_GAP_FLOOR_MS,
  BR_SPAWN_GAP_JITTER,
  BR_STACK_STAGGER_MAX_MS,
  BR_STACK_STAGGER_MIN_MS,
  BR_STACK_THREE_CHANCE,
  BR_STACK_TWO_CHANCE,
  BR_TIMING_JITTER,
} from "./battleRoyaleConstants.ts";
import { FIRST_OBSTACLE_DELAY_MS, MIN_AIRBORNE_BEFORE_CONTACT_MS } from "./constants.ts";
import type { RacerIdentity } from "./identities.ts";
import { isAirborne, jumpAirtimeMsForRank, jumpArcHeightPxForRank } from "./RaceInstance.ts";
import { shuffled } from "./StampedeSession.ts";

// Fixed for every racer — no rank concept here, so no per-racer scaling. Equal to Classic mode's
// rank-1 ("2nd place") jump, per direct request — computed from the same formula Classic itself
// uses so this can never silently drift out of sync with it.
export const BR_FIXED_JUMP_AIRTIME_MS = jumpAirtimeMsForRank(BR_JUMP_RANK_EQUIVALENT);
export const BR_FIXED_JUMP_ARC_HEIGHT_PX = jumpArcHeightPxForRank(BR_JUMP_RANK_EQUIVALENT);

export interface BattleRoyaleRacerState {
  identityId: number;
  /** 0-2, fixed for the whole game — which of the 3 bands this racer is in. */
  section: number;
  /** 0-7, fixed for the whole game — no reordering, ever. */
  slot: number;
  eliminated: boolean;
  eliminatedAt: number | null;
  /** 0 = not currently jumping. See RaceInstance.isAirborne (reused as-is). */
  jumpStartedAt: number;
  /** Always BR_FIXED_JUMP_AIRTIME_MS — present so RaceInstance.isAirborne can be reused unchanged
   * rather than duplicated for a fixed-airtime variant. */
  jumpAirtimeMs: number;
  cpuSkill: number;
}

export interface BattleRoyaleObstacle {
  spawnedAt: number;
  leadInMs: number;
  columnGapMs: number;
  /** Per-RACER (not per-slot) resolution — 3 different racers (one per section) share the same
   * slot index and each needs their own independent outcome against the identical shared timing. */
  resolvedRacerIds: Set<number>;
}

export interface BattleRoyaleSession {
  identities: RacerIdentity[];
  racers: BattleRoyaleRacerState[];
  /** Shared across all 3 sections — same obstacle, same timing, everywhere. Normally 1, briefly 2
   * or 3 when a wave stacks (see rollStackedSpawnTimes). */
  obstacles: BattleRoyaleObstacle[];
  nextObstacleAt: number;
  /** Queued spawn timestamps for this wave's remaining stacked obstacles, nearest first. */
  pendingStackedAt: number[];
  /** True from a wave's first obstacle spawning until every obstacle in it (including any stacked
   * ones) has fully swept past — gates re-scheduling the next wave. */
  waveActive: boolean;
  totalEliminated: number;
  /** How many BR_CHECKPOINT_EVERY_ELIMINATIONS thresholds have been crossed so far — each one
   * permanently speeds up the base obstacle timing (see brSpeedMultiplier). */
  checkpointLevel: number;
  /** Non-null while frozen showing the "X eliminated" pause beat — no spawning, no resolution. */
  checkpointPauseUntil: number | null;
  startedAt: number;
  phase: "RUNNING" | "RESULTS";
  winnerIdentityId: number | null;
}

function rollCpuSkill(): number {
  const base = BR_CPU_SKILL_MIN + Math.random() * (BR_CPU_SKILL_MAX - BR_CPU_SKILL_MIN);
  const jitter = (Math.random() * 2 - 1) * BR_CPU_SKILL_JITTER;
  return Math.min(0.99, Math.max(0.5, base + jitter));
}

/** Shuffles the roster and deals it into 3 sections of 8 (section = index/8, slot = index%8) —
 * this is what randomizes the human's section/slot along with everyone else's. */
export function createBattleRoyaleSession(identities: RacerIdentity[], now: number): BattleRoyaleSession {
  const order = shuffled(identities);
  const racers: BattleRoyaleRacerState[] = order.map((identity, i) => ({
    identityId: identity.id,
    section: Math.floor(i / BR_SLOTS_PER_SECTION),
    slot: i % BR_SLOTS_PER_SECTION,
    eliminated: false,
    eliminatedAt: null,
    jumpStartedAt: 0,
    jumpAirtimeMs: BR_FIXED_JUMP_AIRTIME_MS,
    cpuSkill: rollCpuSkill(),
  }));
  return {
    identities,
    racers,
    obstacles: [],
    nextObstacleAt: now + FIRST_OBSTACLE_DELAY_MS,
    pendingStackedAt: [],
    waveActive: false,
    totalEliminated: 0,
    checkpointLevel: 0,
    checkpointPauseUntil: null,
    startedAt: now,
    phase: "RUNNING",
    winnerIdentityId: null,
  };
}

export function reachTimeForSlot(obstacle: BattleRoyaleObstacle, slot: number): number {
  return obstacle.spawnedAt + obstacle.leadInMs + obstacle.columnGapMs * slot;
}

function totalSweepMs(obstacle: BattleRoyaleObstacle): number {
  return obstacle.leadInMs + obstacle.columnGapMs * (BR_SLOTS_PER_SECTION - 1);
}

export function obstacleProgress(obstacle: BattleRoyaleObstacle, now: number): number {
  return Math.min(1, (now - obstacle.spawnedAt) / totalSweepMs(obstacle));
}

/** Each checkpoint crossed permanently multiplies the base timing down by (1 -
 * BR_CHECKPOINT_SPEED_STEP_PCT) — compounding, floor-clamped at spawn time. Jitter stays the same
 * width throughout; only the baseline speeds up. */
function brSpeedMultiplier(session: BattleRoyaleSession): number {
  return (1 - BR_CHECKPOINT_SPEED_STEP_PCT) ** session.checkpointLevel;
}

function jittered(value: number, width: number): number {
  return value * (1 + (Math.random() * 2 - 1) * width);
}

function spawnBrObstacle(session: BattleRoyaleSession, now: number): BattleRoyaleObstacle {
  const mult = brSpeedMultiplier(session);
  const leadInMs = jittered(Math.max(BR_LEAD_IN_FLOOR_MS, BR_LEAD_IN_BASE_MS * mult), BR_TIMING_JITTER);
  const columnGapMs = jittered(Math.max(BR_COLUMN_GAP_FLOOR_MS, BR_COLUMN_GAP_BASE_MS * mult), BR_TIMING_JITTER);
  // CPU jump decisions are made reactively at resolution time (see updateBattleRoyaleSession),
  // NOT pre-scheduled here at spawn time like Classic's spawnObstacle does — with stacked
  // obstacles a racer may need two genuinely separate jumps, and pre-scheduling both up front (one
  // `jumpStartedAt` per racer, shared across every obstacle in flight) meant a later obstacle's
  // scheduling could silently overwrite an earlier obstacle's still-pending jump, orphaning it and
  // causing mass false eliminations — confirmed via a direct test showing eliminations sweeping
  // slot-by-slot in lockstep with an EARLIER obstacle's own column gap, right after a stacked
  // SECOND obstacle spawned.
  return { spawnedAt: now, leadInMs, columnGapMs, resolvedRacerIds: new Set() };
}

/** A wave has a chance to stack a 2nd hurdle close behind the 1st, and (only if it did) a smaller
 * chance of a 3rd close behind that — staggered enough to demand genuinely quick back-to-back
 * jumps but still within reach of the fixed airtime. Returns queued spawn timestamps, nearest
 * first. */
function rollStackedSpawnTimes(firstSpawnAt: number): number[] {
  const times: number[] = [];
  if (Math.random() < BR_STACK_TWO_CHANCE) {
    const t2 = firstSpawnAt + BR_STACK_STAGGER_MIN_MS + Math.random() * (BR_STACK_STAGGER_MAX_MS - BR_STACK_STAGGER_MIN_MS);
    times.push(t2);
    if (Math.random() < BR_STACK_THREE_CHANCE) {
      const t3 = t2 + BR_STACK_STAGGER_MIN_MS + Math.random() * (BR_STACK_STAGGER_MAX_MS - BR_STACK_STAGGER_MIN_MS);
      times.push(t3);
    }
  }
  return times;
}

function nextBrSpawnDelay(session: BattleRoyaleSession): number {
  const mult = brSpeedMultiplier(session);
  const base = Math.max(BR_SPAWN_GAP_FLOOR_MS, BR_SPAWN_GAP_BASE_MS * mult);
  return jittered(base, BR_SPAWN_GAP_JITTER);
}

export function updateBattleRoyaleSession(session: BattleRoyaleSession, now: number, humanJumpRequested: boolean): void {
  if (session.phase === "RESULTS") return;

  if (session.checkpointPauseUntil !== null) {
    if (now < session.checkpointPauseUntil) return;
    session.checkpointPauseUntil = null;
  }

  if (!session.waveActive && now >= session.nextObstacleAt) {
    session.waveActive = true;
    session.obstacles.push(spawnBrObstacle(session, now));
    session.pendingStackedAt = rollStackedSpawnTimes(now);
  }
  if (session.pendingStackedAt.length > 0 && now >= session.pendingStackedAt[0]!) {
    session.pendingStackedAt.shift();
    session.obstacles.push(spawnBrObstacle(session, now));
  }

  const human = session.racers.find((r) => r.identityId === 0);
  if (human && !human.eliminated && humanJumpRequested && !isAirborne(human, now)) {
    human.jumpStartedAt = now;
  }

  // Checked immediately after EVERY individual elimination, not just once at the end of this
  // tick's resolution — with 24 racers all resolving against a shared, synchronized obstacle, two
  // (or more) of the last few survivors can legitimately fail on the exact same tick. Stopping the
  // instant exactly one racer remains guarantees a real winner always exists; checking only after
  // the whole pass would let a simultaneous double-elimination skip straight from 2 remaining to 0
  // with nobody left to declare.
  let gameOver = false;
  obstacleLoop: for (const obstacle of [...session.obstacles]) {
    for (const racer of session.racers) {
      if (racer.eliminated) continue;
      if (obstacle.resolvedRacerIds.has(racer.identityId)) continue;
      const reachAt = reachTimeForSlot(obstacle, racer.slot);
      if (now < reachAt) continue;
      obstacle.resolvedRacerIds.add(racer.identityId);

      let cleared: boolean;
      if (racer.identityId === 0) {
        // Human: purely their own click-driven jumpStartedAt.
        cleared = isAirborne(racer, now) && now - racer.jumpStartedAt >= MIN_AIRBORNE_BEFORE_CONTACT_MS;
      } else if (isAirborne(racer, now) && now - racer.jumpStartedAt >= MIN_AIRBORNE_BEFORE_CONTACT_MS) {
        // Already mid-jump with enough margin — e.g. one long jump spanning two closely-stacked
        // obstacles. That coverage counts for free, no new roll needed.
        cleared = true;
      } else if (Math.random() < racer.cpuSkill) {
        // Decided fresh, right at this obstacle's own resolve moment — sets the jump animation to
        // land with the same "peak roughly at reach time" shape Classic's advance-scheduled jumps
        // use, just computed reactively instead of speculatively at spawn time.
        racer.jumpStartedAt = reachAt - BR_FIXED_JUMP_AIRTIME_MS * 0.6;
        cleared = true;
      } else {
        cleared = false;
      }

      if (!cleared) {
        racer.eliminated = true;
        racer.eliminatedAt = now;
        session.totalEliminated++;
        const remaining = session.racers.filter((r) => !r.eliminated);
        if (remaining.length <= 1) {
          session.winnerIdentityId = remaining[0]?.identityId ?? null;
          session.phase = "RESULTS";
          gameOver = true;
          break obstacleLoop;
        }
      }
    }
    if (now - obstacle.spawnedAt >= totalSweepMs(obstacle)) {
      const idx = session.obstacles.indexOf(obstacle);
      if (idx !== -1) session.obstacles.splice(idx, 1);
    }
  }
  if (gameOver) return;

  if (session.waveActive && session.obstacles.length === 0 && session.pendingStackedAt.length === 0) {
    session.waveActive = false;
    // Only pause here, at a clean "nothing in flight" boundary — never mid-obstacle, so nobody's
    // jump gets frozen mid-air.
    const newCheckpointLevel = Math.floor(session.totalEliminated / BR_CHECKPOINT_EVERY_ELIMINATIONS);
    if (newCheckpointLevel > session.checkpointLevel) {
      session.checkpointLevel = newCheckpointLevel;
      session.checkpointPauseUntil = now + BR_CHECKPOINT_PAUSE_MS;
    } else {
      session.nextObstacleAt = now + nextBrSpawnDelay(session);
    }
  }
}
