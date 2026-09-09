import {
  CPU_BASE_SKILL_MAX,
  CPU_BASE_SKILL_MIN,
  CPU_SKILL_JITTER,
  JUMP_AIRTIME_MS,
  KNOCKOUT_FLY_SPEED_SLOTS_PER_SEC,
  KNOCKOUT_OFFSCREEN_SLOT,
  MULTI_OBSTACLE_CHANCE,
  MULTI_OBSTACLE_STAGGER_MAX_MS,
  MULTI_OBSTACLE_STAGGER_MIN_MS,
  PHASE_BASE_COLUMN_GAP_MS,
  PHASE_BASE_LEAD_IN_MS,
  PHASE_BASE_SPAWN_MS,
  RACE_RAMP_COLUMN_GAP_FLOOR_MS,
  RACE_RAMP_LEAD_IN_FLOOR_MS,
  RACE_RAMP_MS,
  RACE_RAMP_SPAWN_FLOOR_MS,
  RACER_COUNT,
  SLIDE_SPEED_SLOTS_PER_SEC,
  SPAWN_INTERVAL_JITTER,
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
  /** True from the instant this racer fails a jump until the whole wave finishes and rank
   * reordering actually happens (see updateRace) — while true, this racer's displaySlot targets
   * an off-screen position instead of their (still pre-failure) rank, and slides there fast. */
  knockedOutThisWave: boolean;
}

export function isAirborne(racer: RaceRacerState, now: number): boolean {
  return racer.jumpStartedAt > 0 && now >= racer.jumpStartedAt && now < racer.jumpStartedAt + JUMP_AIRTIME_MS;
}

export interface RaceObstacle {
  spawnedAt: number;
  /** Fixed at spawn time from the race's current shared pacing — every obstacle in a wave travels
   * at the same pace, so every rank's reach time (see reachTimeForRank) derives from these two. */
  leadInMs: number;
  columnGapMs: number;
  /** Which of the RACER_COUNT ranks have already been resolved against this obstacle — a rank
   * only ever resolves once per obstacle, at the instant the sweep reaches it. */
  resolvedRanks: boolean[];
  /** Snapshot of race.racers at the moment THIS obstacle spawned — resolution MUST read from
   * this, not the live (mutating) race.racers array: rank reordering is deferred to the end of
   * the whole wave (see updateRace), so this stays valid for every obstacle in the same wave. */
  order: RaceRacerState[];
}

/** Total time from spawn until this ONE obstacle has swept past every column (the last-place
 * racer's own reach time) — used both to know when it's done and to map its position for
 * rendering. */
export function totalSweepMs(obstacle: RaceObstacle): number {
  return obstacle.leadInMs + obstacle.columnGapMs * (RACER_COUNT - 1);
}

/** When (absolute timestamp) this obstacle's sweep reaches the racer at this rank — rank 0 (1st
 * place, rightmost column) is reached first, rank RACER_COUNT-1 (last place, leftmost) last. */
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
   * last place. Rendering just draws column i from racers[i]; a wave's worth of failures splice
   * those racers out and push them to the end, all at once, once the whole wave finishes — the
   * whole "rank" concept lives entirely in this ordering. */
  racers: RaceRacerState[];
  /** Normally 0 or 1 entries; rarely 2 (see MULTI_OBSTACLE_CHANCE) while a second obstacle joins
   * the current wave. */
  obstacles: RaceObstacle[];
  nextObstacleAt: number;
  /** Set when a wave's first obstacle rolls a second one — the timestamp it actually joins
   * `obstacles`, not created until then (so it never has a not-yet-arrived spawnedAt to reason
   * about). Null when no second obstacle is coming. */
  pendingSecondObstacleAt: number | null;
  /** True from the moment a wave's first obstacle spawns until that wave's rank reorder has been
   * applied — guards the reorder from re-running on every idle tick between waves, when
   * `obstacles` is ALSO empty. */
  waveResolutionPending: boolean;
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

/** The gap before this race's next wave spawns — jittered (see SPAWN_INTERVAL_JITTER) so two or
 * more races never settle into a perfectly fixed relative phase once both are fully ramped. */
function nextSpawnDelay(race: RaceInstance, now: number): number {
  const base = rampedValue(PHASE_BASE_SPAWN_MS[race.phase], RACE_RAMP_SPAWN_FLOOR_MS, race, now);
  const jitter = 1 + (Math.random() * 2 - 1) * SPAWN_INTERVAL_JITTER;
  return base * jitter;
}

/** Creates a fresh race from a starting lineup (an ordered list of identities, index 0 = 1st
 * place) — used both for the very first race and for cloning a new one at a split. `baseSkills`
 * is a Map from identityId to that identity's persistent base skill (rolled once at game start);
 * each racer here gets a fresh per-race jittered roll off of it. */
export function createRaceInstance(order: RacerIdentity[], baseSkills: Map<number, number>, now: number, phase: RacePhase): RaceInstance {
  return {
    racers: order.map((identity, rank) => ({
      identityId: identity.id,
      jumpStartedAt: 0,
      cpuSkill: rollCpuSkill(baseSkills.get(identity.id) ?? CPU_BASE_SKILL_MIN),
      // Starts already in place — no slide-in animation on a fresh race/clone, only on later
      // rank changes.
      displaySlot: RACER_COUNT - 1 - rank,
      knockedOutThisWave: false,
    })),
    obstacles: [],
    nextObstacleAt: now + 600,
    pendingSecondObstacleAt: null,
    waveResolutionPending: false,
    startedAt: now,
    phase,
  };
}

/** Rolls a fresh base skill for a CPU identity — called once at game start (see
 * createStampedeSession). */
export function rollBaseSkill(): number {
  return CPU_BASE_SKILL_MIN + Math.random() * (CPU_BASE_SKILL_MAX - CPU_BASE_SKILL_MIN);
}

function spawnObstacle(race: RaceInstance, now: number): RaceObstacle {
  const leadInMs = rampedValue(PHASE_BASE_LEAD_IN_MS[race.phase], RACE_RAMP_LEAD_IN_FLOOR_MS, race, now);
  const columnGapMs = rampedValue(PHASE_BASE_COLUMN_GAP_MS[race.phase], RACE_RAMP_COLUMN_GAP_FLOOR_MS, race, now);
  const obstacle: RaceObstacle = {
    spawnedAt: now,
    leadInMs,
    columnGapMs,
    resolvedRanks: new Array(RACER_COUNT).fill(false),
    order: [...race.racers],
  };
  // Pre-decide every CPU's jump for THIS obstacle up front, based on the wave's fixed starting
  // ranks — avoids simulating frame-by-frame CPU reaction while still landing a plausible-looking
  // jump right as the sweep reaches their column. Skips anyone already covered by a jump already
  // scheduled for an earlier obstacle in the same wave (common when a rare second obstacle is
  // staggered closely behind the first) rather than re-rolling and possibly cancelling a jump
  // that was already going to work.
  race.racers.forEach((racer, rank) => {
    if (racer.identityId === 0) return;
    const reachAt = reachTimeForRank(obstacle, rank);
    if (isAirborne(racer, reachAt)) return;
    if (Math.random() < racer.cpuSkill) {
      racer.jumpStartedAt = reachAt - JUMP_AIRTIME_MS * 0.6;
    }
  });
  return obstacle;
}

/** Advances one race by dt. `humanJumpRequested` is edge-triggered (true only on the tick a click
 * routed to this race's band) — the human's own racer (identityId 0) only ever jumps from this,
 * never from the CPU skill roll in spawnObstacle. Normally one obstacle at a time, shared by the
 * whole race (rarely two — see MULTI_OBSTACLE_CHANCE): each sweeps across every current rank in
 * turn (see reachTimeForRank), resolving each racer individually at the instant it reaches THEIR
 * column. `suppressSpawns` (true once a split is pending — see StampedeSession) stops any NEW
 * obstacle or pending second obstacle from starting, letting whatever's already in flight finish
 * and then leaving the race genuinely idle. */
export function updateRace(race: RaceInstance, dt: number, now: number, humanJumpRequested: boolean, suppressSpawns: boolean): void {
  if (suppressSpawns) {
    race.pendingSecondObstacleAt = null;
  }

  if (race.obstacles.length === 0 && !suppressSpawns && now >= race.nextObstacleAt) {
    race.waveResolutionPending = true;
    race.obstacles.push(spawnObstacle(race, now));
    if (Math.random() < MULTI_OBSTACLE_CHANCE) {
      race.pendingSecondObstacleAt = now + MULTI_OBSTACLE_STAGGER_MIN_MS + Math.random() * (MULTI_OBSTACLE_STAGGER_MAX_MS - MULTI_OBSTACLE_STAGGER_MIN_MS);
    }
  }
  if (race.pendingSecondObstacleAt !== null && !suppressSpawns && now >= race.pendingSecondObstacleAt) {
    race.obstacles.push(spawnObstacle(race, now));
    race.pendingSecondObstacleAt = null;
  }

  const human = race.racers.find((r) => r.identityId === 0);
  if (human && humanJumpRequested && !isAirborne(human, now)) {
    human.jumpStartedAt = now;
  }

  for (const obstacle of [...race.obstacles]) {
    // Resolve any rank the sweep has now reached (or passed) that hasn't been resolved yet — a
    // wave can reach several ranks within the same tick if frame time is coarse, so check all of
    // them, not just the "next" one.
    for (let rank = 0; rank < obstacle.order.length; rank++) {
      if (obstacle.resolvedRanks[rank]) continue;
      if (now < reachTimeForRank(obstacle, rank)) continue;
      obstacle.resolvedRanks[rank] = true;
      const racer = obstacle.order[rank]!;
      if (!isAirborne(racer, now)) racer.knockedOutThisWave = true;
    }

    if (now - obstacle.spawnedAt >= totalSweepMs(obstacle)) {
      const idx = race.obstacles.indexOf(obstacle);
      if (idx !== -1) race.obstacles.splice(idx, 1);
    }
  }

  // The wave is fully done once nothing (first obstacle, second obstacle, or a still-pending
  // second obstacle) is left outstanding — apply every failure from it as one batch: survivors
  // keep their relative order, failures go to the back in the order they were snapshotted.
  // Partitioning this way (rather than removing-and-re-appending each failure one at a time)
  // matters in the degenerate case where EVERY racer fails the same wave - doing it one at a time
  // is a no-op there (each removal-and-append just cycles the array back to where it started).
  if (race.waveResolutionPending && race.obstacles.length === 0 && race.pendingSecondObstacleAt === null) {
    race.racers = [...race.racers.filter((r) => !r.knockedOutThisWave), ...race.racers.filter((r) => r.knockedOutThisWave)];
    for (const r of race.racers) r.knockedOutThisWave = false;
    race.waveResolutionPending = false;
    race.nextObstacleAt = now + nextSpawnDelay(race, now);
  }

  // Slide every racer's drawn position toward their target, rather than snapping instantly —
  // runs every tick regardless of whether an obstacle is active, so a racer who just moved up
  // (someone ahead of them failed, and the wave has since fully resolved) keeps gliding into
  // place even between waves. A racer mid-wave-knockout targets a fixed off-screen slot instead
  // of their (still pre-reorder) rank, and gets there much faster — see KNOCKOUT_*.
  race.racers.forEach((racer, rank) => {
    const target = racer.knockedOutThisWave ? KNOCKOUT_OFFSCREEN_SLOT : RACER_COUNT - 1 - rank;
    const speed = racer.knockedOutThisWave ? KNOCKOUT_FLY_SPEED_SLOTS_PER_SEC : SLIDE_SPEED_SLOTS_PER_SEC;
    const maxStep = speed * dt;
    const diff = target - racer.displaySlot;
    if (Math.abs(diff) <= maxStep) racer.displaySlot = target;
    else racer.displaySlot += Math.sign(diff) * maxStep;
  });
}
