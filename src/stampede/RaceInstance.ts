import {
  CPU_BASE_SKILL_MAX,
  CPU_BASE_SKILL_MIN,
  CPU_SKILL_JITTER,
  JUMP_AIRTIME_MS,
  PHASE_BASE_COLUMN_GAP_MS,
  PHASE_BASE_LEAD_IN_MS,
  PHASE_BASE_SPAWN_MS,
  RACE_RAMP_COLUMN_GAP_FLOOR_MS,
  RACE_RAMP_LEAD_IN_FLOOR_MS,
  RACE_RAMP_MS,
  RACE_RAMP_SPAWN_FLOOR_MS,
  RACER_COUNT,
  SLIDE_SPEED_SLOTS_PER_SEC,
} from "./constants.ts";
import type { RacerIdentity } from "./identities.ts";

export type RacePhase = "SINGLE" | "TWO_WAY" | "THREE_WAY";

export interface RaceRacerState {
  identityId: number;
  /** 0 = not currently jumping. Otherwise the timestamp this racer's CURRENT jump started (which
   * may be in the future, for a CPU jump scheduled ahead of time — see updateRace) — airborne for
   * JUMP_AIRTIME_MS starting from that instant. Use isAirborne() rather than reading this field
   * directly. */
  jumpStartedAt: number;
  /** This race's own roll for this identity — re-rolled fresh (jittered around a base skill) every
   * time a race is cloned, so the same identity can genuinely diverge across parallel races. */
  cpuSkill: number;
  /** Continuous (not integer) left-to-right column position this racer is CURRENTLY drawn at —
   * 0 = leftmost, RACER_COUNT-1 = rightmost. Slides toward their real current rank's column (see
   * updateRace) rather than snapping instantly, so a rank change elsewhere in the line doesn't
   * make every racer behind it teleport sideways on the same frame. render.ts reads this directly
   * instead of recomputing a column index fresh from rank every frame. */
  displaySlot: number;
}

export function isAirborne(racer: RaceRacerState, now: number): boolean {
  return racer.jumpStartedAt > 0 && now >= racer.jumpStartedAt && now < racer.jumpStartedAt + JUMP_AIRTIME_MS;
}

export interface RaceObstacle {
  spawnedAt: number;
  /** Fixed at spawn time from the race's current shared pacing — the same single obstacle, so
   * every rank's reach time (see reachTimeForRank) derives from these two numbers. */
  leadInMs: number;
  columnGapMs: number;
  /** Which of the RACER_COUNT ranks have already been resolved against this obstacle — a rank
   * only ever resolves once per wave, at the instant the sweep reaches it. */
  resolvedRanks: boolean[];
  /** Snapshot of race.racers at the moment this wave spawned — resolution MUST read from this,
   * not the live (mutating) race.racers array: resolving rank 0 splices that racer out and
   * pushes them to the end, which would shift every later rank's array index if we kept reading
   * race.racers[rank] directly, resolving the wrong racer against each later rank. */
  order: RaceRacerState[];
}

/** Total time from spawn until the wave has swept past every column (the last-place racer's own
 * reach time) — used both to know when the whole wave is "done" and to map obstacle position for
 * rendering. */
export function totalSweepMs(obstacle: RaceObstacle): number {
  return obstacle.leadInMs + obstacle.columnGapMs * (RACER_COUNT - 1);
}

/** When (absolute timestamp) the sweep reaches the racer currently sitting at this rank — rank 0
 * (1st place, rightmost column) is reached first, rank RACER_COUNT-1 (last place, leftmost) last. */
export function reachTimeForRank(obstacle: RaceObstacle, rank: number): number {
  return obstacle.spawnedAt + obstacle.leadInMs + obstacle.columnGapMs * rank;
}

/** 0 (just spawned, at the band's right edge) to 1 (finished sweeping past the last column) —
 * purely a function of elapsed time; render.ts maps it to an x position itself. */
export function obstacleProgress(obstacle: RaceObstacle, now: number): number {
  return Math.min(1, (now - obstacle.spawnedAt) / totalSweepMs(obstacle));
}

export interface RaceInstance {
  /** Always length RACER_COUNT. Array ORDER is current rank: index 0 = 1st place, last index =
   * last place. Rendering just draws column i from racers[i]; a failed jump splices that racer
   * out and pushes them to the end — the whole "rank" concept lives entirely in this ordering. */
  racers: RaceRacerState[];
  obstacle: RaceObstacle | null;
  nextObstacleAt: number;
  startedAt: number;
  phase: RacePhase;
}

function rollCpuSkill(baseSkill: number): number {
  const jitter = (Math.random() * 2 - 1) * CPU_SKILL_JITTER;
  return Math.min(0.99, Math.max(0.05, baseSkill + jitter));
}

function rampedValue(base: number, floor: number, race: RaceInstance, now: number): number {
  const rampT = Math.min(1, (now - race.startedAt) / RACE_RAMP_MS);
  return base + (floor - base) * rampT;
}

/** Creates a fresh race from a starting lineup (an ordered list of identities, index 0 = 1st
 * place) — used both for the very first race and for cloning a new one at a split. `baseSkills`
 * is a Map from identityId to that identity's persistent base skill (rolled once at game start);
 * each racer here gets a fresh per-race jittered roll off of it. */
export function createRaceInstance(order: RacerIdentity[], baseSkills: Map<number, number>, now: number, phase: RacePhase): RaceInstance {
  const race: RaceInstance = {
    racers: order.map((identity, rank) => ({
      identityId: identity.id,
      jumpStartedAt: 0,
      cpuSkill: rollCpuSkill(baseSkills.get(identity.id) ?? CPU_BASE_SKILL_MIN),
      // Starts already in place — no slide-in animation on a fresh race/clone, only on later
      // rank changes.
      displaySlot: RACER_COUNT - 1 - rank,
    })),
    obstacle: null,
    nextObstacleAt: now + 600,
    startedAt: now,
    phase,
  };
  return race;
}

/** Rolls a fresh base skill for a CPU identity — called once at game start (see
 * createStampedeSession). */
export function rollBaseSkill(): number {
  return CPU_BASE_SKILL_MIN + Math.random() * (CPU_BASE_SKILL_MAX - CPU_BASE_SKILL_MIN);
}

/** Advances one race by dt. `humanJumpRequested` is edge-triggered (true only on the tick a click
 * routed to this race's band) — the human's own racer (identityId 0) only ever jumps from this,
 * never from the CPU skill roll below. One obstacle at a time, shared by the whole race: it sweeps
 * across every current rank in turn (see reachTimeForRank), resolving each racer individually at
 * the instant it reaches THEIR column. */
export function updateRace(race: RaceInstance, dt: number, now: number, humanJumpRequested: boolean): void {
  if (!race.obstacle && now >= race.nextObstacleAt) {
    const leadInMs = rampedValue(PHASE_BASE_LEAD_IN_MS[race.phase], RACE_RAMP_LEAD_IN_FLOOR_MS, race, now);
    const columnGapMs = rampedValue(PHASE_BASE_COLUMN_GAP_MS[race.phase], RACE_RAMP_COLUMN_GAP_FLOOR_MS, race, now);
    const obstacle: RaceObstacle = {
      spawnedAt: now,
      leadInMs,
      columnGapMs,
      resolvedRanks: new Array(RACER_COUNT).fill(false),
      order: [...race.racers],
    };
    race.obstacle = obstacle;

    // Pre-decide every CPU's jump for this wave up front, based on their FIXED (start-of-wave)
    // rank — avoids simulating frame-by-frame CPU reaction while still landing a plausible-looking
    // jump right as the sweep reaches their column. The human's own racer is left untouched here;
    // they jump only via a real click, below.
    race.racers.forEach((racer, rank) => {
      if (racer.identityId === 0) return;
      if (Math.random() < racer.cpuSkill) {
        const reachAt = reachTimeForRank(obstacle, rank);
        racer.jumpStartedAt = reachAt - JUMP_AIRTIME_MS * 0.6;
      } else {
        racer.jumpStartedAt = 0;
      }
    });
  }

  const human = race.racers.find((r) => r.identityId === 0);
  if (human && humanJumpRequested && !isAirborne(human, now)) {
    human.jumpStartedAt = now;
  }

  const obstacle = race.obstacle;
  if (obstacle) {
    // Resolve any rank the sweep has now reached (or passed) that hasn't been resolved yet — a
    // wave can reach several ranks within the same tick if frame time is coarse, so check all of
    // them, not just the "next" one.
    for (let rank = 0; rank < obstacle.order.length; rank++) {
      if (obstacle.resolvedRanks[rank]) continue;
      if (now < reachTimeForRank(obstacle, rank)) continue;
      obstacle.resolvedRanks[rank] = true;
      const racer = obstacle.order[rank]!;
      if (!isAirborne(racer, now)) {
        // Failed — sent to the back of the pack. This only touches the LIVE array (which decides
        // future rendering/next-wave ranks); the obstacle's own reach-time schedule for the
        // remaining not-yet-resolved ranks was fixed at spawn time and is unaffected.
        const idx = race.racers.indexOf(racer);
        if (idx !== -1) {
          race.racers.splice(idx, 1);
          race.racers.push(racer);
        }
      }
    }

    if (now - obstacle.spawnedAt >= totalSweepMs(obstacle)) {
      race.obstacle = null;
      race.nextObstacleAt = now + rampedValue(PHASE_BASE_SPAWN_MS[race.phase], RACE_RAMP_SPAWN_FLOOR_MS, race, now);
    }
  }

  // Slide every racer's drawn position toward their current rank's column, rather than snapping
  // instantly — runs every tick regardless of whether an obstacle is active, so a racer who just
  // moved up (someone ahead of them failed) keeps gliding into place even between waves.
  const maxStep = SLIDE_SPEED_SLOTS_PER_SEC * dt;
  race.racers.forEach((racer, rank) => {
    const target = RACER_COUNT - 1 - rank;
    const diff = target - racer.displaySlot;
    if (Math.abs(diff) <= maxStep) racer.displaySlot = target;
    else racer.displaySlot += Math.sign(diff) * maxStep;
  });
}
