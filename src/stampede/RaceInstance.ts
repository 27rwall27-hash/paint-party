import {
  CPU_BASE_SKILL_MAX,
  CPU_BASE_SKILL_MIN,
  CPU_SKILL_JITTER,
  JUMP_AIRTIME_MS,
  PHASE_BASE_REACTION_MS,
  PHASE_BASE_SPAWN_MS,
  RACE_RAMP_MS,
  RACE_RAMP_REACTION_FLOOR_MS,
  RACE_RAMP_SPAWN_FLOOR_MS,
  SPAWN_INTERVAL_JITTER,
} from "./constants.ts";
import type { RacerIdentity } from "./identities.ts";

export type RacePhase = "SINGLE" | "TWO_WAY" | "THREE_WAY";

export interface RaceObstacle {
  spawnedAt: number;
  /** Fixed at spawn time from the race's current shared reaction time — every obstacle in a race
   * travels at the same pace, only WHEN each racer's next one spawns is independent (see
   * updateRace). */
  reactionMs: number;
}

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
  /** This racer's own current obstacle, independent of everyone else's — null between obstacles. */
  obstacle: RaceObstacle | null;
  nextObstacleAt: number;
}

export function isAirborne(racer: RaceRacerState, now: number): boolean {
  return racer.jumpStartedAt > 0 && now >= racer.jumpStartedAt && now < racer.jumpStartedAt + JUMP_AIRTIME_MS;
}

/** 0 (just spawned) to 1 (at the hit line, about to resolve) — purely a function of elapsed time,
 * so it's independent of column pixel geometry (render.ts maps it to a y position itself). */
export function obstacleProgress(obstacle: RaceObstacle, now: number): number {
  return Math.min(1, (now - obstacle.spawnedAt) / obstacle.reactionMs);
}

export interface RaceInstance {
  /** Always length RACER_COUNT. Array ORDER is current rank: index 0 = 1st place, last index =
   * last place. Rendering just draws column i from racers[i]; a failed jump splices that racer
   * out and pushes them to the end — the whole "rank" concept lives entirely in this ordering. */
  racers: RaceRacerState[];
  startedAt: number;
  phase: RacePhase;
}

function rollCpuSkill(baseSkill: number): number {
  const jitter = (Math.random() * 2 - 1) * CPU_SKILL_JITTER;
  return Math.min(0.99, Math.max(0.05, baseSkill + jitter));
}

function currentReactionMs(race: RaceInstance, now: number): number {
  const base = PHASE_BASE_REACTION_MS[race.phase];
  const rampT = Math.min(1, (now - race.startedAt) / RACE_RAMP_MS);
  return base + (RACE_RAMP_REACTION_FLOOR_MS - base) * rampT;
}

function nextSpawnDelay(race: RaceInstance, now: number): number {
  const base = PHASE_BASE_SPAWN_MS[race.phase];
  const rampT = Math.min(1, (now - race.startedAt) / RACE_RAMP_MS);
  const interval = base + (RACE_RAMP_SPAWN_FLOOR_MS - base) * rampT;
  const jitter = 1 + (Math.random() * 2 - 1) * SPAWN_INTERVAL_JITTER;
  return interval * jitter;
}

/** Creates a fresh race from a starting lineup (an ordered list of identities, index 0 = 1st
 * place) — used both for the very first race and for cloning a new one at a split. `baseSkills`
 * is a Map from identityId to that identity's persistent base skill (rolled once at game start);
 * each racer here gets a fresh per-race jittered roll off of it. Each racer's first obstacle spawn
 * is independently randomized within one spawn interval so the 8 columns desync from the start,
 * not just eventually. */
export function createRaceInstance(order: RacerIdentity[], baseSkills: Map<number, number>, now: number, phase: RacePhase): RaceInstance {
  const race: RaceInstance = { racers: [], startedAt: now, phase };
  race.racers = order.map((identity) => ({
    identityId: identity.id,
    jumpStartedAt: 0,
    cpuSkill: rollCpuSkill(baseSkills.get(identity.id) ?? CPU_BASE_SKILL_MIN),
    obstacle: null,
    nextObstacleAt: now + Math.random() * PHASE_BASE_SPAWN_MS[phase],
  }));
  return race;
}

/** Rolls a fresh base skill for a CPU identity — called once at game start (see
 * createStampedeSession). */
export function rollBaseSkill(): number {
  return CPU_BASE_SKILL_MIN + Math.random() * (CPU_BASE_SKILL_MAX - CPU_BASE_SKILL_MIN);
}

/** Advances one race by dt. `humanJumpRequested` is edge-triggered (true only on the tick a click
 * routed to this race's band) — the human's own racer (identityId 0) only ever jumps from this,
 * never from the CPU skill roll below. Each racer's obstacle spawns, travels, and resolves fully
 * independently of every other racer's — only the underlying pace (currentReactionMs) is shared. */
export function updateRace(race: RaceInstance, _dt: number, now: number, humanJumpRequested: boolean): void {
  for (const racer of [...race.racers]) {
    if (!racer.obstacle && now >= racer.nextObstacleAt) {
      const reactionMs = currentReactionMs(race, now);
      racer.obstacle = { spawnedAt: now, reactionMs };
      if (racer.identityId !== 0 && !isAirborne(racer, now) && Math.random() < racer.cpuSkill) {
        // Decide up-front whether this CPU clears it, and if so schedule the jump so it's
        // airborne right as the obstacle reaches the hit-line — avoids simulating frame-by-frame
        // CPU reaction while still giving a plausible-looking jump animation.
        const jumpDelayMs = Math.max(0, reactionMs - JUMP_AIRTIME_MS * 0.6);
        racer.jumpStartedAt = now + jumpDelayMs;
      }
    }

    if (racer.identityId === 0 && humanJumpRequested && !isAirborne(racer, now)) {
      racer.jumpStartedAt = now;
    }

    if (racer.obstacle && now - racer.obstacle.spawnedAt >= racer.obstacle.reactionMs) {
      if (!isAirborne(racer, now)) {
        // Failed — sent to the back of the pack. Everyone else's slot is untouched; only this
        // one racer's position changes, whenever THEIR obstacle happens to resolve.
        const idx = race.racers.indexOf(racer);
        if (idx !== -1) {
          race.racers.splice(idx, 1);
          race.racers.push(racer);
        }
      }
      racer.obstacle = null;
      racer.nextObstacleAt = now + nextSpawnDelay(race, now);
    }
  }
}
