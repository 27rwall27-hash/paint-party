import {
  CPU_BASE_SKILL_MAX,
  CPU_BASE_SKILL_MIN,
  CPU_SKILL_JITTER,
  JUMP_AIRTIME_MS,
  OBSTACLE_TRAVEL_PX,
  PHASE_BASE_SPAWN_MS,
  PHASE_BASE_SPEED,
  RACE_RAMP_MS,
  RACE_RAMP_SPAWN_FLOOR_MS,
  RACE_RAMP_SPEED_CEILING,
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
}

export function isAirborne(racer: RaceRacerState, now: number): boolean {
  return racer.jumpStartedAt > 0 && now >= racer.jumpStartedAt && now < racer.jumpStartedAt + JUMP_AIRTIME_MS;
}

export interface RaceObstacle {
  /** Distance remaining (px) until this obstacle reaches HIT_LINE_X. */
  distance: number;
}

export interface RaceInstance {
  /** Always length RACER_COUNT. Array ORDER is current rank: index 0 = 1st place, last index =
   * last place. Rendering just draws lane i from racers[i]; a failed jump splices a racer out and
   * pushes them to the end — the whole "rank" concept lives entirely in this ordering. */
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

/** Creates a fresh race from a starting lineup (an ordered list of identities, index 0 = 1st
 * place) — used both for the very first race and for cloning a new one at a split. `baseSkills`
 * is a Map from identityId to that identity's persistent base skill (rolled once at game start);
 * each racer here gets a fresh per-race jittered roll off of it. */
export function createRaceInstance(order: RacerIdentity[], baseSkills: Map<number, number>, now: number, phase: RacePhase): RaceInstance {
  const racers: RaceRacerState[] = order.map((identity) => ({
    identityId: identity.id,
    jumpStartedAt: 0,
    cpuSkill: rollCpuSkill(baseSkills.get(identity.id) ?? CPU_BASE_SKILL_MIN),
  }));
  return {
    racers,
    obstacle: null,
    nextObstacleAt: now + PHASE_BASE_SPAWN_MS[phase] * 0.5, // a shorter first gap so the opening obstacle doesn't feel like a dead pause
    startedAt: now,
    phase,
  };
}

/** Rolls a fresh base skill for a CPU identity — called once at game start (see
 * createStampedeSession). */
export function rollBaseSkill(): number {
  return CPU_BASE_SKILL_MIN + Math.random() * (CPU_BASE_SKILL_MAX - CPU_BASE_SKILL_MIN);
}

function currentSpawnIntervalMs(race: RaceInstance, now: number): number {
  const base = PHASE_BASE_SPAWN_MS[race.phase];
  const rampT = Math.min(1, (now - race.startedAt) / RACE_RAMP_MS);
  return base + (RACE_RAMP_SPAWN_FLOOR_MS - base) * rampT;
}

function currentScrollSpeed(race: RaceInstance, now: number): number {
  const base = PHASE_BASE_SPEED[race.phase];
  const rampT = Math.min(1, (now - race.startedAt) / RACE_RAMP_MS);
  return base + (RACE_RAMP_SPEED_CEILING - base) * rampT;
}

/** Advances one race by dt. `humanJumpRequested` is edge-triggered (true only on the tick a click
 * routed to this race's band) — the human's own racer (identityId 0) only ever jumps from this,
 * never from the CPU skill roll below. */
export function updateRace(race: RaceInstance, dt: number, now: number, humanJumpRequested: boolean): void {
  if (!race.obstacle && now >= race.nextObstacleAt) {
    const speed = currentScrollSpeed(race, now);
    const timeToHitLineMs = (OBSTACLE_TRAVEL_PX / speed) * 1000;
    race.obstacle = { distance: OBSTACLE_TRAVEL_PX };
    for (const r of race.racers) {
      if (r.identityId === 0) continue; // human decides for themselves, see below
      // Decide up-front whether this racer clears the obstacle, and if so schedule their jump so
      // it's airborne right as the obstacle reaches the hit-line — avoids simulating frame-by-frame
      // CPU reaction while still giving a plausible-looking jump animation. A racer already mid-
      // jump from a previous obstacle (shouldn't normally happen given the spawn gap, but possible
      // under a very short interval) just keeps that jump; only decide fresh once grounded.
      if (isAirborne(r, now)) continue;
      if (Math.random() < r.cpuSkill) {
        // Land the jump so it's airborne through the moment the obstacle reaches the hit-line —
        // start a bit before that, hold through it.
        const jumpDelayMs = Math.max(0, timeToHitLineMs - JUMP_AIRTIME_MS * 0.6);
        r.jumpStartedAt = now + jumpDelayMs;
      } else {
        r.jumpStartedAt = 0;
      }
    }
  }

  if (race.obstacle) {
    race.obstacle.distance -= currentScrollSpeed(race, now) * dt;
  }

  // Edge-triggered from a click (see main.ts) — jumping is only blocked while already mid-air;
  // jumping too early (before an obstacle is even close) just means being grounded again by the
  // time it matters, the same "mistimed jump" failure mode a real endless runner has.
  const human = race.racers.find((r) => r.identityId === 0);
  if (human && humanJumpRequested && !isAirborne(human, now)) {
    human.jumpStartedAt = now;
  }

  if (race.obstacle && race.obstacle.distance <= 0) {
    const survived: RaceRacerState[] = [];
    const failed: RaceRacerState[] = [];
    for (const r of race.racers) {
      if (isAirborne(r, now)) survived.push(r);
      else failed.push(r);
    }
    race.racers = [...survived, ...failed];
    race.obstacle = null;
    race.nextObstacleAt = now + currentSpawnIntervalMs(race, now);
  }
}
